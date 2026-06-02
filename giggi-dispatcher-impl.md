# Giggi Inference Dispatcher — Implementation Document
**Version**: 1.0  
**Project**: `giggi-dispatcher`  
**Target agent**: Code agent (Claude Code or equivalent)  
**Stack**: TypeScript, Node.js, Fastify, WebSocket, React dashboard

---

## 1. Project overview

The Giggi Inference Dispatcher is a standalone service that sits between the Giggi backend and the heterogeneous GPU inference fleet. It accepts OpenAI-compatible HTTP requests, selects the optimal inference node based on real-time capability and load data, proxies the request, and streams the response back. It also exposes a real-time monitoring dashboard showing per-node health, GPU metrics, routing decisions, and request throughput.

This is a **separate repository** (`giggi-dispatcher`), not part of the Giggi monorepo. It deploys as a single Docker container on `vimage` (192.168.2.100), which has no GPU but has 102GB RAM, stable uptime (72 days), and access to all LAN nodes.

---

## 2. Fleet reference

You can find the technical details from giggi_audit directory
The dispatcher must be pre-seeded with this node registry. All values are known-good from audit.

```typescript
// src/config/fleet.ts

export const FLEET: NodeConfig[] = [
  // ── vimage2 (192.168.2.101) — RTX 5060 Ti + RTX 3060 ────────────────────
  {
    id: "vimage2-5060ti",
    host: "192.168.2.101",
    label: "vimage2 / RTX 5060 Ti",
    backend: "localai",
    port: 8181,
    gpu: { name: "RTX 5060 Ti", arch: "blackwell", vram_gb: 16, cuda_cap: 13.0 },
    tier: 1,
    tags: ["5060ti", "blackwell", "large-model", "agreement-parse"],
    capabilities: ["llm"],
    enabled: true,
  },
  {
    id: "vimage2-ollama",
    host: "192.168.2.101",
    label: "vimage2 / Ollama (3060)",
    backend: "ollama",
    port: 11434,
    gpu: { name: "RTX 3060", arch: "ampere", vram_gb: 12, cuda_cap: 8.6 },
    tier: 2,
    tags: ["3060", "ampere", "classify"],
    capabilities: ["llm"],
    enabled: true,
  },
  {
    id: "vimage2-swarmui",
    host: "192.168.2.101",
    label: "vimage2 / SwarmUI",
    backend: "swarmui",
    port: 7801,
    gpu: { name: "RTX 5060 Ti", arch: "blackwell", vram_gb: 16, cuda_cap: 13.0 },
    tier: 1,
    tags: ["5060ti", "blackwell", "image-gen"],
    capabilities: ["txt2img", "img2img"],
    enabled: true,
  },

  // ── vimage3 (192.168.2.102) — RTX 4060 Ti + Tesla P4 ────────────────────
  {
    id: "vimage3-ollama",
    host: "192.168.2.102",
    label: "vimage3 / Ollama (4060Ti)",
    backend: "ollama",
    port: 11434,
    gpu: { name: "RTX 4060 Ti", arch: "ada", vram_gb: 16, cuda_cap: 8.9 },
    tier: 2,
    tags: ["4060ti", "ada", "classify"],
    capabilities: ["llm"],
    enabled: true,
  },
  {
    id: "vimage3-forge",
    host: "192.168.2.102",
    label: "vimage3 / SD-Forge",
    backend: "sd_forge",
    port: 7860,
    gpu: { name: "RTX 4060 Ti", arch: "ada", vram_gb: 16, cuda_cap: 8.9 },
    tier: 2,
    tags: ["4060ti", "ada", "image-gen", "forge"],
    capabilities: ["txt2img", "img2img"],
    enabled: true,
  },
  {
    id: "vimage3-deforum",
    host: "192.168.2.102",
    label: "vimage3 / Deforum",
    backend: "deforum",
    port: 7860,          // runs as Forge extension — same port, different API path
    gpu: { name: "RTX 4060 Ti", arch: "ada", vram_gb: 16, cuda_cap: 8.9 },
    tier: 2,
    tags: ["4060ti", "ada", "video-gen", "deforum"],
    capabilities: ["txt2video"],
    enabled: true,
  },

  // ── vimage4 (192.168.2.103) — Tesla P100 + GTX 1050 Ti ──────────────────
  {
    id: "vimage4-p100",
    host: "192.168.2.103",
    label: "vimage4 / Ollama (P100)",
    backend: "ollama",
    port: 11434,
    gpu: { name: "Tesla P100", arch: "pascal", vram_gb: 16, cuda_cap: 6.0 },
    tier: 1,
    tags: ["p100", "pascal", "large-model", "agreement-parse"],
    capabilities: ["llm"],
    enabled: true,
  },
  {
    id: "vimage4-forge",
    host: "192.168.2.103",
    label: "vimage4 / SD-Forge (P100)",
    backend: "sd_forge",
    port: 7860,
    gpu: { name: "Tesla P100", arch: "pascal", vram_gb: 16, cuda_cap: 6.0 },
    tier: 2,
    tags: ["p100", "pascal", "image-gen"],
    capabilities: ["txt2img", "img2img"],
    enabled: true,
  },

  // ── vimage5 (192.168.2.104) — RTX 3060 ──────────────────────────────────
  {
    id: "vimage5-ollama",
    host: "192.168.2.104",
    label: "vimage5 / Ollama (3060)",
    backend: "ollama",
    port: 11434,
    gpu: { name: "RTX 3060", arch: "ampere", vram_gb: 12, cuda_cap: 8.6 },
    tier: 2,
    tags: ["3060", "ampere", "classify"],
    capabilities: ["llm"],
    enabled: true,
  },
  {
    id: "vimage5-forge",
    host: "192.168.2.104",
    label: "vimage5 / SD-Forge",
    backend: "sd_forge",
    port: 7860,
    gpu: { name: "RTX 3060", arch: "ampere", vram_gb: 12, cuda_cap: 8.6 },
    tier: 2,
    tags: ["3060", "ampere", "image-gen"],
    capabilities: ["txt2img", "img2img"],
    enabled: true,
  },

  // ── win / 192.168.2.12 — RTX 4070 Ti ────────────────────────────────────
  {
    id: "win-4070ti",
    host: "192.168.2.12",
    label: "win / RTX 4070 Ti",
    backend: "ollama",
    port: 11434,
    gpu: { name: "RTX 4070 Ti", arch: "ada", vram_gb: 12, cuda_cap: 8.9 },
    tier: 1,
    tags: ["4070ti", "ada", "large-model", "agreement-parse"],
    capabilities: ["llm"],
    enabled: true,
  },

  // ── vimage (192.168.2.100) — CPU only ────────────────────────────────────
  {
    id: "vimage-cpu",
    host: "192.168.2.100",
    label: "vimage / CPU only",
    backend: "localai",
    port: 8080,
    gpu: null,
    tier: 3,
    tags: ["cpu-only", "fallback"],
    capabilities: ["llm"],
    enabled: false,
  },
];
```

---

## 3. Repository structure

```
giggi-dispatcher/
├── src/
│   ├── config/
│   │   └── fleet.ts              # Node registry (above)
│   ├── types/
│   │   └── index.ts              # All shared TypeScript types
│   ├── poller/
│   │   └── NodePoller.ts         # Health + metrics polling loop
│   ├── router/
│   │   ├── Router.ts             # Routing decision engine
│   │   └── scoring.ts            # Scoring functions
│   ├── proxy/
│   │   └── Proxy.ts              # HTTP proxy + streaming
│   ├── api/
│   │   └── routes.ts             # Fastify routes (OpenAI compat + admin)
│   ├── ws/
│   │   └── DashboardBroadcaster.ts  # WebSocket state broadcaster
│   ├── dashboard/                # React SPA (Vite)
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── NodeCard.tsx       # Per-node gauge card
│   │   │   │   ├── GpuGauge.tsx       # Radial gauge component
│   │   │   │   ├── RouteLog.tsx       # Live routing decision feed
│   │   │   │   ├── ThroughputChart.tsx
│   │   │   │   └── FleetTopology.tsx  # Connection topology view
│   │   │   └── hooks/
│   │   │       └── useDispatcherWS.ts
│   │   └── vite.config.ts
│   └── server.ts                 # Entry point
├── docker-compose.yml
├── Dockerfile
└── package.json
```

---

## 4. Types

```typescript
// src/types/index.ts

export type NodeCapability = "llm" | "txt2img" | "img2img" | "txt2video" | "img2video";
export type BackendType = "ollama" | "localai" | "sd_forge" | "swarmui" | "deforum";
export type GpuArch = "blackwell" | "ada" | "ampere" | "pascal" | "volta" | null;
export type NodeTier = 1 | 2 | 3;
export type TaskType = "classify" | "parse_agreement" | "generic" | "txt2img" | "img2img" | "txt2video";
export type NodeStatus = "healthy" | "degraded" | "unreachable" | "unknown";

export interface GpuConfig {
  name: string;
  arch: GpuArch;
  vram_gb: number;
  cuda_cap: number;
}

export interface NodeConfig {
  id: string;
  host: string;
  label: string;
  backend: BackendType;
  port: number;
  gpu: GpuConfig | null;
  tier: NodeTier;
  tags: string[];
  enabled: boolean;
  capabilities: NodeCapability[];  // what task types this node can serve
}

export interface GpuMetrics {
  utilization_pct: number;       // 0-100
  memory_used_mb: number;
  memory_total_mb: number;
  memory_free_mb: number;
  temperature_c: number;
  power_draw_w: number;
  power_limit_w: number;
  loaded_models: LoadedModel[];
}

export interface LoadedModel {
  name: string;
  size_bytes: number;
  processor: "gpu" | "cpu";
  context_length?: number;
}

export interface SystemMetrics {
  cpu_pct: number;               // aggregate across all cores
  mem_used_gb: number;
  mem_total_gb: number;
  mem_pct: number;
  load_1m: number;
  load_5m: number;
  load_15m: number;
  disk_read_mb_s: number;        // rolling 5s average
  disk_write_mb_s: number;
  net_rx_mb_s: number;
  net_tx_mb_s: number;
}

export interface NodeState {
  config: NodeConfig;
  status: NodeStatus;
  last_seen: number;             // unix ms
  ping_ms: number;
  gpu: GpuMetrics | null;
  system: SystemMetrics | null;
  queue_depth: number;           // inferred active request count
  requests_total: number;        // lifetime counter
  requests_ok: number;
  requests_err: number;
  p50_ms: number;                // rolling latency percentiles
  p95_ms: number;
  score: number;                 // current routing score (0-100, higher = prefer)
}

export interface RoutingDecision {
  id: string;                    // uuid
  ts: number;                    // unix ms
  task_type: TaskType;
  selected_node: string;         // node id
  candidates: string[];          // all considered node ids
  reason: string;                // human-readable e.g. "tier1 lowest queue"
  latency_ms?: number;           // filled on completion
  success?: boolean;
}

export interface DispatcherStats {
  requests_total: number;
  requests_ok: number;
  requests_err: number;
  requests_queued: number;
  uptime_s: number;
  nodes: NodeState[];
  recent_decisions: RoutingDecision[];  // last 100
}
```

---

## 5. NodePoller

Polls every node on a configurable interval (default 5s). Uses the backend's native API to gather metrics. Falls back to a degraded state after 3 consecutive failures.

```typescript
// src/poller/NodePoller.ts

// Poll strategy per backend:
//
// OLLAMA:
//   Health:   GET http://{host}:{port}/        → 200 = alive
//   Models:   GET http://{host}:{port}/api/tags → list of available models
//   Running:  GET http://{host}:{port}/api/ps   → currently loaded models + VRAM
//   (No direct GPU metrics — use nvidia-smi via SSH or node-exporter)
//
// LOCALAI:
//   Health:   GET http://{host}:{port}/healthz  → {"status":"ok"}
//   Models:   GET http://{host}:{port}/v1/models
//   Metrics:  GET http://{host}:{port}/metrics  → Prometheus text format
//             Parse: localai_requests_total, localai_active_requests
//
// GPU METRICS (both backends):
//   Primary:  GET http://{host}:9835/metrics    → nvidia-metrics.service
//             (running on vimage2, vimage3, vimage4, vimage5 per audit)
//             Parse: DCGM_FI_DEV_GPU_UTIL, DCGM_FI_DEV_FB_USED, DCGM_FI_DEV_POWER_USAGE
//             Fallback: nvidia_gpu_duty_cycle, nvidia_gpu_memory_used_bytes (node-exporter gpu plugin)
//   Fallback: GET http://{host}:9100/metrics    → prom/node-exporter
//             Parse: node_cpu_seconds_total, node_memory_MemAvailable_bytes,
//                    node_disk_read_bytes_total, node_network_receive_bytes_total

class NodePoller {
  private states: Map<string, NodeState>;
  private intervals: Map<string, NodeJS.Timeout>;
  private onUpdate: (state: NodeState) => void;

  constructor(fleet: NodeConfig[], onUpdate: (state: NodeState) => void) {}

  start(): void {}           // starts polling all enabled nodes
  stop(): void {}            // clears all intervals
  getState(id: string): NodeState | undefined {}
  getAllStates(): NodeState[] {}

  private async pollNode(node: NodeConfig): Promise<void> {}
  private async fetchOllamaMetrics(node: NodeConfig): Promise<Partial<NodeState>> {}
  private async fetchLocalAIMetrics(node: NodeConfig): Promise<Partial<NodeState>> {}
  private async fetchGpuMetrics(host: string): Promise<GpuMetrics | null> {}
  private async fetchSystemMetrics(host: string): Promise<SystemMetrics | null> {}
  private inferQueueDepth(state: Partial<NodeState>): number {}
  private updateLatencyPercentiles(id: string, latency_ms: number): void {}
}
```

**Polling timeout**: 3000ms per request. Mark node `unreachable` after 3 consecutive failures. Resume polling — auto-recover when node responds again.

**Metrics derivation notes**:
- `queue_depth`: inferred as active loaded model count from `ollama ps` + recent request rate delta
- `disk_read_mb_s` / `disk_write_mb_s`: derived from node-exporter `node_disk_read_bytes_total` delta between polls
- `net_rx_mb_s` / `net_tx_mb_s`: derived from `node_network_receive_bytes_total` delta

---

## 6. Router

```typescript
// src/router/Router.ts

// Routing algorithm:
//
// 1. Filter: remove unreachable nodes, disabled nodes
// 2. Filter: remove nodes where GPU VRAM free < model_vram_requirement
//    (if model is known; skip filter if unknown)
// 3. Score remaining candidates (see scoring.ts)
// 4. Apply task_type preference:
//    - "parse_agreement" → boost tier 1 nodes by +20 score points
//    - "classify"        → no tier preference, pure score
//    - "generic"         → no preference
// 5. Select highest score
// 6. On tie: prefer lower queue_depth, then lower p50_ms
// 7. Emit RoutingDecision event

// Fallback chain:
//   tier1 available → use tier1
//   tier1 full/unreachable → fall to tier2
//   tier2 full/unreachable → fall to tier3 (CPU, if enabled)
//   all unreachable → return 503 with Retry-After header

class Router {
  constructor(private poller: NodePoller) {}

  selectNode(task: TaskType, modelHint?: string): { node: NodeConfig; decision: RoutingDecision } | null {}
  
  private score(state: NodeState): number {}   // see scoring.ts
  private tierBoost(state: NodeState, task: TaskType): number {}
}
```

```typescript
// src/router/scoring.ts

// Score function — returns 0-100
// Higher = more preferred
//
// Components (all weighted, sum to 100 max):
//
//   gpu_free_vram_pct  * 0.35   → more free VRAM = better
//   gpu_utilization    * 0.25   → inverted (100% util = 0 score contribution)
//   queue_depth        * 0.20   → inverted (depth 0 = full score, depth 5+ = 0)
//   p50_latency        * 0.10   → inverted (lower latency = better)
//   tier               * 0.10   → tier1=10pts, tier2=6pts, tier3=2pts
//
// Special cases:
//   node.status === "degraded"  → cap score at 30
//   node.gpu === null           → gpu components = 0 (CPU nodes score low naturally)
//   temperature_c > 80          → subtract 15 (thermal throttle risk)
//   power_draw / power_limit > 0.95 → subtract 10 (power limit risk)

export function scoreNode(state: NodeState): number {}
```

---

## 7. Proxy

```typescript
// src/proxy/Proxy.ts

// The proxy translates incoming OpenAI-format requests to backend-native format
// and streams responses back.
//
// Incoming format (OpenAI):
//   POST /v1/chat/completions
//   { model, messages, stream, temperature, max_tokens, ... }
//   Headers: X-Task-Type: classify | parse_agreement | generic  (optional, defaults to generic)
//            X-Model-Hint: <model name>                          (optional)
//
// Backend translation:
//   OLLAMA:   POST http://{host}:{port}/api/chat
//             { model, messages, stream, options: { temperature, num_predict } }
//             Response: newline-delimited JSON (stream) or single JSON
//
//   LOCALAI:  POST http://{host}:{port}/v1/chat/completions
//             (native OpenAI format — pass through directly)
//
// Streaming:
//   Both backends support SSE streaming.
//   Proxy must forward chunks as received without buffering.
//   On connection drop: abort upstream request, decrement queue_depth.
//
// Error handling:
//   502: upstream returned non-200
//   503: no nodes available
//   504: upstream timeout (default 60s for inference)
//   On 502/504: retry on next best node (max 1 retry, not for streaming mid-response)

class Proxy {
  constructor(private router: Router, private poller: NodePoller) {}

  async handle(req: FastifyRequest, reply: FastifyReply): Promise<void> {}

  private async proxyToOllama(node: NodeConfig, body: OpenAIChatRequest, stream: boolean): Promise<Response> {}
  private async proxyToLocalAI(node: NodeConfig, body: OpenAIChatRequest, stream: boolean): Promise<Response> {}
  private translateToOllamaFormat(body: OpenAIChatRequest): OllamaChatRequest {}
  private translateOllamaResponseToOpenAI(chunk: string): string {}
}
```

---

## 8. API routes

```typescript
// src/api/routes.ts

// ── Inference (OpenAI-compatible) ──────────────────────────────────────────

POST   /v1/chat/completions          // main inference endpoint
GET    /v1/models                    // union of all models across all nodes

// ── Admin ──────────────────────────────────────────────────────────────────

GET    /admin/nodes                  // all NodeState[]
GET    /admin/nodes/:id              // single NodeState
PUT    /admin/nodes/:id/enable       // { enabled: boolean }
GET    /admin/stats                  // DispatcherStats
GET    /admin/decisions              // last 100 RoutingDecision[]
POST   /admin/nodes/:id/drain        // stop sending new requests, wait for active to finish
DELETE /admin/nodes/:id/drain        // cancel drain

// ── Health ──────────────────────────────────────────────────────────────────

GET    /healthz                      // { status: "ok", uptime_s, nodes_healthy, nodes_total }

// ── WebSocket ───────────────────────────────────────────────────────────────

WS     /ws/dashboard                 // streams DispatcherStats at configurable interval (default 2s)
                                     // also pushes RoutingDecision events in real time
```

**WebSocket message types:**
```typescript
type WSMessage =
  | { type: "state_snapshot"; data: DispatcherStats }    // full state, sent on connect + every 2s
  | { type: "routing_decision"; data: RoutingDecision }  // emitted per request
  | { type: "node_status_change"; data: { id: string; status: NodeStatus; prev: NodeStatus } }
```

---

## 9. Dashboard

React SPA served statically from the Fastify server at `/dashboard`. Built with Vite. No external CSS framework — custom CSS only using design tokens from the skill.

### Design direction

**Aesthetic**: Dark industrial control room. Think submarine sonar display meets server room ops console. Monospace data, high-contrast status indicators, radial gauges with analog feel, subtle grid lines on dark background. Color palette: near-black background (`#0a0c0f`), cyan accent (`#00e5c8`), amber warning (`#f5a623`), red alert (`#ff3b47`), muted steel for inactive.

### Components

#### `NodeCard.tsx`
One card per node. Displays:
- Node label + backend badge (OLLAMA / LOCALAI)
- Status dot (animated pulse when healthy, static when degraded/unreachable)
- Tier badge (T1 / T2 / T3)
- GPU row:
  - `GpuGauge` for VRAM utilization (radial, 0-100%)
  - `GpuGauge` for GPU compute utilization (radial, 0-100%)
  - Temperature reading (color: green <70°C, amber 70-80°C, red >80°C)
  - Power draw / limit (W)
- System row:
  - CPU % bar (thin horizontal bar, fills left to right)
  - RAM % bar
  - Disk I/O (read/write MB/s, two tiny sparklines)
  - Net I/O (rx/tx MB/s)
- Routing score (large number, prominent, e.g. `87`)
- Queue depth (requests currently in flight)
- Latency row: p50 / p95 in ms
- Request counters: total / ok / err (err in red if >0)
- Loaded models list (names, truncated, with VRAM pill)

#### `GpuGauge.tsx`
SVG radial gauge. Parameters: `value` (0-100), `label`, `colorStops` (green→amber→red at configurable thresholds). Animated fill using SVG stroke-dashoffset. Shows value as large text in center.

Implementation notes:
- Use `stroke-dasharray` + `stroke-dashoffset` on a circle path for fill
- Animate with CSS `transition: stroke-dashoffset 0.4s ease`
- Three arc segments (green zone, amber zone, red zone) as background
- Single foreground arc that grows with value

#### `RouteLog.tsx`
Scrolling feed of routing decisions, newest at top. Each entry:
- Timestamp (relative: "2s ago")
- Task type badge (`CLASSIFY` / `AGREEMENT`)
- Arrow graphic: source → selected node
- Reason string
- Latency (once resolved)
- Color-coded: green = ok, red = error

Auto-scrolls to newest. Pause on hover. Max 100 entries (ring buffer).

#### `ThroughputChart.tsx`
Time-series line chart showing requests/s across the fleet. Uses `recharts` LineChart. One line per active node, color-coded. X-axis: last 2 minutes at 2s resolution. Y-axis: req/s.

#### `FleetTopology.tsx`
Simple visual showing dispatcher in center, nodes arranged in a semi-circle around it. Lines between dispatcher and each node, color-coded by status (cyan=healthy, amber=degraded, red=unreachable). Animates a dot traveling along the line on each routing decision (triggered by WS `routing_decision` event). Shows node tier as ring around node icon.

#### `App.tsx` layout
```
┌─────────────────────────────────────────────────────────────┐
│  GIGGI DISPATCHER  [uptime]  [total req]  [errors]  [HEALTH]│  ← header bar
├──────────────────────────┬──────────────────────────────────┤
│                          │                                  │
│   FleetTopology          │   ThroughputChart                │
│   (connection diagram)   │   (requests/s over time)         │
│                          │                                  │
├──────────────────────────┴──────────────────────────────────┤
│  NODE CARDS (responsive grid, min 320px per card)           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ vimage2  │ │ vimage3  │ │ vimage4  │ │ vimage5  │  ...  │
│  │ 5060Ti   │ │ 4060Ti   │ │  P100    │ │  3060    │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├─────────────────────────────────────────────────────────────┤
│  RouteLog (scrolling feed, last 100 decisions)              │
└─────────────────────────────────────────────────────────────┘
```

#### `useDispatcherWS.ts`
```typescript
// Custom hook
// Connects to ws://host/ws/dashboard
// Manages reconnection with exponential backoff (1s, 2s, 4s, max 30s)
// Returns: { state: DispatcherStats | null, decisions: RoutingDecision[], connected: boolean }
// Updates state on every "state_snapshot" message
// Appends to decisions ring buffer (max 100) on "routing_decision" messages
```

---

## 10. Configuration

All runtime config via environment variables:

```env
# Server
PORT=4242
HOST=0.0.0.0
DASHBOARD_PATH=/dashboard

# Polling
POLL_INTERVAL_MS=5000
POLL_TIMEOUT_MS=3000
NODE_FAILURE_THRESHOLD=3          # consecutive failures before marking unreachable

# Routing
TIER1_BOOST_SCORE=20              # extra score for tier1 on parse_agreement tasks
MIN_VRAM_FREE_MB=2048             # refuse node if less VRAM free than this
INFERENCE_TIMEOUT_MS=60000

# WebSocket
WS_BROADCAST_INTERVAL_MS=2000

# Node toggle overrides (comma-separated node ids to force-disable)
DISABLED_NODES=vimage-cpu

# Metrics ports (per-host overrides possible via fleet.ts)
NVIDIA_METRICS_PORT=9835
NODE_EXPORTER_PORT=9100
LOCALAI_METRICS_PORT=8080         # /metrics path on LocalAI port
```

---

## 11. Docker setup

```yaml
# docker-compose.yml
version: "3.9"
services:
  dispatcher:
    build: .
    restart: unless-stopped
    ports:
      - "4242:4242"
    environment:
      - PORT=4242
      - POLL_INTERVAL_MS=5000
    extra_hosts:
      # LAN nodes must be reachable by hostname or IP
      - "vimage2:192.168.2.101"
      - "vimage3:192.168.2.102"
      - "vimage4:192.168.2.103"
      - "vimage5:192.168.2.104"
      - "win-node:192.168.2.12"
    networks:
      - dispatcher_net

networks:
  dispatcher_net:
    driver: bridge
```

```dockerfile
# Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build          # builds both server (tsc) and dashboard (vite)

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 4242
CMD ["node", "dist/server.js"]
```

**Build scripts in package.json:**
```json
{
  "scripts": {
    "build": "npm run build:server && npm run build:dashboard",
    "build:server": "tsc -p tsconfig.server.json",
    "build:dashboard": "vite build --config src/dashboard/vite.config.ts",
    "dev": "concurrently \"tsc -w -p tsconfig.server.json\" \"vite src/dashboard\" \"nodemon dist/server.js\"",
    "test": "vitest run"
  }
}
```

---

## 12. Giggi integration

The Giggi backend calls the dispatcher exactly like it would call Ollama or any OpenAI-compatible endpoint. The only addition is the optional task type header.

```typescript
// In Giggi backend — classifier call
const response = await fetch("http://vimage:4242/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Task-Type": "classify",
  },
  body: JSON.stringify({
    model: "qwen2.5:7b",
    messages: [{ role: "user", content: classifierPrompt }],
    stream: false,
  }),
});

// In Giggi backend — agreement parser call
const response = await fetch("http://vimage:4242/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Task-Type": "parse_agreement",
  },
  body: JSON.stringify({
    model: "qwen2.5:14b",
    messages: [{ role: "user", content: agreementParsePrompt }],
    stream: false,
  }),
});
```

---

## 13. Backend integration reference

Each backend has a distinct API contract. The proxy layer must handle all five. This section defines exactly how to communicate with each one for health polling, metrics, and request dispatch.

---

### 13.1 Ollama

**Requires**: Ollama running as service or Docker container. No special flags needed.

```
Health:     GET  http://{host}:{port}/
            → 200 plain text "Ollama is running"

Models:     GET  http://{host}:{port}/api/tags
            → { models: [{ name, size, digest, modified_at }] }

Running:    GET  http://{host}:{port}/api/ps
            → { models: [{ name, size, digest, size_vram, expires_at }] }
            Use size_vram to determine actual VRAM consumed per loaded model.

Inference:  POST http://{host}:{port}/api/chat
            Body: {
              model: string,
              messages: [{ role, content }],
              stream: boolean,
              options: { temperature?, num_predict?, top_p? }
            }
            Stream response: newline-delimited JSON, each line:
            { model, created_at, message: { role, content }, done }
            Final line has done: true and includes eval stats.

Translate:  Incoming OpenAI → Ollama:
            messages[]      → messages[]          (same shape)
            max_tokens      → options.num_predict
            temperature     → options.temperature
            stream          → stream

            Ollama stream → OpenAI SSE:
            Each chunk: { model, message.content } →
            data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"..."}}]}
            Final chunk: data: [DONE]
```

**Queue depth inference**: `ollama ps` returns only loaded models, not active requests. Infer queue from recent request rate delta tracked internally by the poller — increment counter on dispatch, decrement on completion.

---

### 13.2 LocalAI

**Requires**: LocalAI running with GPU support. Your fleet uses `quay.io/go-skynet/local-ai:master-gpu-nvidia-cuda-12` on port 8181 (vimage2).

```
Health:     GET  http://{host}:{port}/healthz
            → { status: "ok" }

Models:     GET  http://{host}:{port}/v1/models
            → { object: "list", data: [{ id, object, created, owned_by }] }

Metrics:    GET  http://{host}:{port}/metrics
            → Prometheus text format. Key metrics to parse:
              localai_active_requests           (gauge — current in-flight)
              localai_requests_total            (counter by model, status)
              go_goroutines                     (sanity check)

Inference:  POST http://{host}:{port}/v1/chat/completions
            → Native OpenAI format. Pass through directly — no translation needed.
            Stream: standard SSE (text/event-stream)
            Non-stream: standard OpenAI JSON response

Notes:
- LocalAI is OpenAI-compatible natively, so the proxy can pass requests through
  with zero translation for both request and response formats.
- localai_active_requests is the most reliable queue depth signal available.
- The --api flag is not required; LocalAI exposes its API by default.
```

---

### 13.3 SD-Forge (Stable Diffusion WebUI Forge)

**Requires**: Forge launched with `--api` flag. Without it, `/sdapi/v1/*` routes are unavailable. Check your containers — add `--api` to COMMANDLINE_ARGS in the webui-user config or Docker CMD if not already set.

**Task types served**: `txt2img`, `img2img`

```
Health:     GET  http://{host}:{port}/sdapi/v1/memory
            → { ram: { free, used, total }, cuda: { free, used, total } }
            Use cuda.free and cuda.total for VRAM metrics (more accurate than nvidia-smi
            for models currently loaded by Forge).

Models:     GET  http://{host}:{port}/sdapi/v1/sd-models
            → [{ title, model_name, hash, sha256, filename, config }]

Current:    GET  http://{host}:{port}/sdapi/v1/options
            → { sd_model_checkpoint: "model name here", ... }
            Use sd_model_checkpoint to know what's loaded.

Progress:   GET  http://{host}:{port}/sdapi/v1/progress
            → { progress: 0.0-1.0, eta_relative: float, state: { job, job_count,
               job_timestamp, job_no }, current_image: base64|null }
            Poll this to track active generation and infer queue depth.
            If progress > 0 and < 1: node is busy.

txt2img:    POST http://{host}:{port}/sdapi/v1/txt2img
            Body (minimal): {
              prompt: string,
              negative_prompt?: string,
              width?: number,          // default 512
              height?: number,         // default 512
              steps?: number,          // default 20
              cfg_scale?: number,      // default 7
              seed?: number,           // -1 for random
              sampler_name?: string,   // "DPM++ 2M", "Euler a", etc.
              batch_size?: number,
              n_iter?: number,
              save_images?: boolean,
              send_images?: boolean    // true = include base64 in response
            }
            Response: {
              images: string[],        // base64-encoded PNG(s)
              parameters: {...},
              info: string             // JSON string with generation metadata
            }
            Note: Forge uses a FIFO lock — only one generation runs at a time.
            Queue depth = 1 if progress > 0, else 0.

img2img:    POST http://{host}:{port}/sdapi/v1/img2img
            Same as txt2img plus:
            { init_images: [base64string], denoising_strength: 0.0-1.0 }

Interrupt:  POST http://{host}:{port}/sdapi/v1/interrupt
            → Cancels current generation. No body required.

Translate (incoming dispatcher request → Forge):
  X-Task-Type: txt2img header maps to sdapi/v1/txt2img
  Request body should use a defined ImageGenRequest type (see types below)
  Response images are base64 — dispatcher returns them as-is or uploads to shared storage
```

**Important**: Forge's single-generation FIFO lock means you should never route two image requests to the same Forge instance simultaneously. The poller must check `/sdapi/v1/progress` and mark the node `busy` (queue_depth=1) before routing. If `progress > 0`, reject routing to that instance.

---

### 13.4 SwarmUI

**Requires**: SwarmUI running (default port 7801). No special launch flags needed — API is enabled by default.

**Task types served**: `txt2img`, `img2img`

SwarmUI uses its own API. The majority of routes take POST requests sent to `(server)/API/(route)` containing JSON inputs and returning JSON outputs. Some routes designated with a WS suffix take WebSocket connections for progress streaming. All routes except `GetNewSession` require a `session_id` in the JSON body.

```
Session:    POST http://{host}:{port}/API/GetNewSession
            Body: {}
            → { session_id: string, ... }
            Session IDs expire. Store one per node, refresh on invalid_session_id error.
            The poller should maintain a live session_id per SwarmUI node.

Health:     POST http://{host}:{port}/API/GetServerStatus
            Body: { session_id }
            → {
                status: {
                  waiting_gens: number,
                  loading_models: number,
                  waiting_backends: number,
                  live_gens: number
                },
                backend_status: {
                  status: "idle"|"running"|"loading"|"errored"|"all_disabled",
                  any_loading: boolean
                }
              }
            Use waiting_gens + live_gens as queue_depth.
            Use backend_status.status for node health.

GPU info:   POST http://{host}:{port}/API/GetServerResourceInfo
            Body: { session_id }
            → {
                cpu: { usage: float, cores: int },
                system_ram: { total, used, free },
                gpus: {
                  "0": { id, name, temperature, utilization_gpu,
                         utilization_memory, total_memory, free_memory, used_memory }
                }
              }
            This is the richest GPU metrics source across all backends.
            Prefer this over nvidia-smi polling for SwarmUI nodes.

Models:     POST http://{host}:{port}/API/ListModels
            Body: { session_id, path: "Stable-Diffusion", depth: 2 }
            → { files: [{ name, title, ... }] }

txt2img:    POST http://{host}:{port}/API/GenerateText2Image
            Body: {
              session_id,
              prompt: string,
              negativeprompt?: string,
              width?: number,
              height?: number,
              steps?: number,
              cfgscale?: number,
              seed?: number,
              model?: string,          // e.g. "Flux/flux1-dev-fp8"
              images?: number,         // batch count
              donotsave?: boolean,
              aspectratio?: string     // "Custom" or preset like "16:9"
            }
            Response: { images: string[], error?: string }
            Images are URLs (served by SwarmUI), not base64.

Streaming:  WS   ws://{host}:{port}/API/GenerateText2ImageWS
            Same body as POST version.
            Server sends progress messages: { gen_progress: { ... }, preview?: base64 }
            Final message includes image URLs.
            Use WS variant for live progress display in the dashboard.

Cancel:     POST http://{host}:{port}/API/InterruptAll
            Body: { session_id }

Error handling:
  If response contains error_id === "invalid_session_id":
    → Recall GetNewSession, store new session_id, retry request once.
  If backend_status.status === "errored":
    → Mark node degraded, stop routing until status recovers.
```

---

### 13.5 Deforum

**Architecture note**: Deforum is not a standalone service — it runs as an extension inside SD-WebUI / SD-Forge. On your fleet, vimage3's Forge instance (port 7860) has Deforum installed. Deforum does not have its own dedicated API; it extends Forge's `/sdapi/` surface.

**Task types served**: `txt2video`

```
Health:     Same as SD-Forge — GET http://{host}:{port}/sdapi/v1/memory
            If Forge is healthy, Deforum is available (assuming extension is loaded).

Check ext:  GET  http://{host}:{port}/sdapi/v1/extensions
            → [{ name, version, enabled, ... }]
            Verify "deforum" appears in the list and enabled: true before routing.
            Cache result — extensions don't change at runtime.

Submit job: POST http://{host}:{port}/deforum_api/batches
            Body: {
              deforum_settings: {
                animation_mode: "2D" | "3D" | "Video Input" | "Interpolation",
                max_frames: number,
                W: number,
                H: number,
                seed: number,            // -1 for random
                sampler: string,
                steps: number,
                scale: number,
                prompts: {               // frame-keyed prompt schedule
                  "0": "prompt text for frame 0",
                  "60": "prompt text for frame 60",
                },
                // ... full Deforum settings object (large, see Deforum docs)
              }
            }
            → { batch_id: string, outdir: string }

Poll job:   GET  http://{host}:{port}/deforum_api/batches/{batch_id}
            → {
                status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED",
                frames_done: number,
                total_frames: number,
                outdir: string,
                error?: string
              }
            Poll every 2-5s until status === "SUCCEEDED" | "FAILED".

Cancel:     DELETE http://{host}:{port}/deforum_api/batches/{batch_id}

Notes:
- Deforum jobs are long-running (minutes, not seconds). The dispatcher must handle
  async job lifecycle — submit, poll, return result — not the synchronous
  request-response pattern used for LLM inference.
- Only one Deforum job should run per GPU at a time (shares VRAM with Forge).
- When Deforum is running, mark the Forge instance on the same node as busy
  (queue_depth=1) to prevent concurrent SD image requests on the same GPU.
- Deforum output is a folder of frames on the server. The dispatcher should
  return the outdir path and/or batch_id to the caller — not stream frames.
- The deforum_api extension must be installed separately from base Deforum.
  If /deforum_api/batches returns 404, fall back to treating as unsupported.
```

**Alternative (no deforum_api extension)**: If the batch API extension isn't available, Deforum can be triggered via Forge's script runner:
```
POST http://{host}:{port}/sdapi/v1/txt2img
Body: {
  script_name: "deforum",
  script_args: [ ...deforum_args_array... ]
}
```
This is synchronous and blocks until completion — only viable for short animations. The dispatcher should prefer the async batch API where available.

---

### 13.6 Incoming request routing by task type

The dispatcher exposes additional endpoints beyond `/v1/chat/completions` to handle image and video generation:

```
// Updated src/api/routes.ts additions

POST   /v1/images/generations         // txt2img — routes to sd_forge or swarmui
POST   /v1/images/edits               // img2img — routes to sd_forge or swarmui
POST   /v1/video/generations          // txt2video — routes to deforum
GET    /v1/video/generations/:job_id  // poll Deforum job status
```

Request headers for capability routing:
```
X-Task-Type: txt2img | img2img | txt2video | classify | parse_agreement | generic
X-Backend-Prefer: swarmui | sd_forge | ollama | localai  (optional hint)
X-Model-Hint: <model name>                               (optional)
```

Routing matrix:

| X-Task-Type | Eligible backends | Tier preference |
|---|---|---|
| `classify` | ollama, localai | tier1 > tier2 |
| `parse_agreement` | ollama, localai | tier1 strongly preferred |
| `generic` | ollama, localai | any |
| `txt2img` | sd_forge, swarmui | highest score, not busy |
| `img2img` | sd_forge, swarmui | highest score, not busy |
| `txt2video` | deforum | any available, async |

If `X-Backend-Prefer` is set and a healthy node with that backend exists with matching capability, use it. Otherwise fall back to score-based selection.

---

### 13.7 Extended types for image/video tasks

```typescript
// Add to src/types/index.ts

export interface ImageGenRequest {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg_scale?: number;
  seed?: number;
  sampler?: string;
  model?: string;
  batch_size?: number;
  init_image?: string;           // base64 — triggers img2img
  denoising_strength?: number;   // for img2img
}

export interface VideoGenRequest {
  animation_mode?: "2D" | "3D";
  max_frames: number;
  width?: number;
  height?: number;
  prompts: Record<string, string>;  // frame number → prompt
  seed?: number;
  steps?: number;
  cfg_scale?: number;
  model?: string;
}

export interface VideoGenJob {
  job_id: string;
  node_id: string;
  backend_batch_id: string;
  status: "pending" | "running" | "succeeded" | "failed";
  frames_done: number;
  total_frames: number;
  outdir: string;
  submitted_at: number;
  updated_at: number;
  error?: string;
}

// Extended NodeState — add to existing interface
// queue_depth_image: number;   // separate counter for image gen queue
// queue_depth_video: number;   // separate counter for video gen queue (usually 0 or 1)
// active_video_job?: string;   // job_id if Deforum running
```

---

## 14. Known constraints and edge cases

**vimage3 /data at 98%**: The poller should emit a `node_status_change` event with status `degraded` when disk usage on any mounted path exceeds 90%. This is observable via node-exporter `node_filesystem_avail_bytes`.

**vimage2 model loading time**: Ollama on vimage2 has `qwen3.6` (23GB) available but not loaded at poll time. First request to this model will incur cold-load latency (potentially 30-60s). The router should track loaded models from `ollama ps` and prefer nodes where the target model is already warm.

**vimage3 forge contention**: RTX 4060 Ti is frequently at 100% utilization from stable diffusion forge. The score function will naturally deprioritize it, but the poller should also check if GPU processes include `python` (forge/SD) and flag the node as `degraded` for inference routing when forge is active.

**Windows node (192.168.2.12)**: No SSH, no prometheus exporters. The poller can only get data from Ollama API (`:11434/api/ps`, `/api/tags`). System metrics (CPU/RAM) will be `null` for this node. The dashboard NodeCard should gracefully display "n/a" for system metrics on this node.

**vimage-cpu LocalAI on 8080**: This node runs LocalAI but is CPU-only. `enabled: false` by default. If enabled as fallback, expect 10-30s response times. Do not route streaming requests to it.

**Ollama model mismatch**: Different nodes have different models. The `GET /v1/models` union endpoint should list all models across all nodes and include which nodes have each model. The router must verify the requested model exists on a candidate node before scoring it.

**SD-Forge --api flag**: Forge containers on vimage3, vimage4, vimage5 must be launched with `--api` in COMMANDLINE_ARGS. Without it, `/sdapi/v1/*` routes return 404. The poller should detect this by checking for 404 on `/sdapi/v1/memory` and marking the node's `txt2img` capability as unavailable rather than the whole node as unreachable.

**Forge FIFO lock**: Forge processes one generation at a time. Never route two image requests to the same Forge instance simultaneously. The poller must poll `/sdapi/v1/progress` on every tick and set `queue_depth_image = 1` when `progress > 0`. The router must treat `queue_depth_image >= 1` as a hard block for new image requests — not just a score penalty.

**Deforum vs Forge VRAM sharing**: Deforum runs inside Forge and shares the same GPU. When a Deforum job is active (`active_video_job` is set), the corresponding Forge node must also be marked busy for image routing. The poller detects this by checking `/deforum_api/batches/{active_job_id}` status, or by observing GPU utilization staying high with no SD progress reported.

**SwarmUI session expiry**: Session IDs returned by `GetNewSession` can expire. Always handle `error_id === "invalid_session_id"` in every SwarmUI API call and re-acquire a session transparently. The poller should pre-emptively refresh the session on its health poll cycle rather than only on error.

**SwarmUI GPU metrics goldmine**: SwarmUI's `/API/GetServerResourceInfo` returns per-GPU temperature, utilization, and VRAM — structured JSON, no Prometheus scraping needed. For SwarmUI nodes, prefer this over node-exporter for GPU metrics. It also returns CPU and system RAM, so SwarmUI nodes can provide full system metrics without any additional exporters.

**Deforum job lifecycle**: Deforum jobs run for minutes. The dispatcher must maintain a `VideoGenJob` registry in memory (or Redis if you want persistence across restarts). The `/v1/video/generations/:job_id` poll endpoint proxies back to the Deforum node's batch API. Job results (frame output directory) must be accessible — ensure the Deforum output path is on a shared mount or return a node-local path the caller can fetch via file browser or similar.

**vimage3 disk pressure impact on Deforum**: vimage3's `/data` NVMe is at 98% capacity. Deforum writes frame sequences to disk — a 300-frame job at 512×512 can easily produce 500MB+. Before routing any Deforum job to vimage3, the poller must verify available disk space on the output path exceeds a configurable threshold (default: 5GB free).

---

## 15. Observability

The dispatcher itself should expose Prometheus metrics at `GET /metrics`:

```
# Requests
dispatcher_requests_total{task_type, node_id, status}
dispatcher_request_duration_ms{task_type, node_id, quantile}
dispatcher_queue_depth_total

# Routing
dispatcher_routing_decisions_total{task_type, selected_node, tier}
dispatcher_routing_fallbacks_total{from_tier, to_tier}
dispatcher_no_nodes_available_total

# Per-node (mirrored from polled data for Prometheus scraping)
dispatcher_node_score{node_id}
dispatcher_node_gpu_utilization_pct{node_id}
dispatcher_node_gpu_vram_free_mb{node_id}
dispatcher_node_queue_depth{node_id}
dispatcher_node_p50_ms{node_id}
dispatcher_node_status{node_id, status}   # gauge: 1=healthy, 0.5=degraded, 0=unreachable
```

These metrics integrate directly with the existing Prometheus stack on vimage6 (`monitoring-prometheus`) and Grafana (`monitoring-grafana`). Add the dispatcher as a scrape target in `prometheus.yml` on vimage6:

```yaml
# Add to prometheus.yml scrape_configs on vimage6
- job_name: "giggi-dispatcher"
  static_configs:
    - targets: ["192.168.2.100:4242"]
  metrics_path: /metrics
  scrape_interval: 5s
```

---

## 16. Implementation order for agent

Implement in this sequence to get a working system as fast as possible:

1. **Types** (`src/types/index.ts`) — including `NodeCapability`, `ImageGenRequest`, `VideoGenRequest`, `VideoGenJob`
2. **Fleet config** (`src/config/fleet.ts`) — all nodes with capabilities
3. **NodePoller — Ollama** — health, models, ps, queue depth inference
4. **NodePoller — LocalAI** — health, models, `/metrics` Prometheus parse
5. **NodePoller — SD-Forge** — health via `/sdapi/v1/memory`, progress polling, busy detection
6. **NodePoller — SwarmUI** — session management, `GetServerStatus`, `GetServerResourceInfo`
7. **NodePoller — Deforum** — extension check, job status polling
8. **Scoring function** — extend to handle capability filtering by task type
9. **Router** — capability-aware routing, Forge busy-lock, SwarmUI session-aware dispatch
10. **Proxy — LLM backends** — Ollama + LocalAI request/response translation and streaming
11. **Proxy — Image backends** — SD-Forge txt2img/img2img, SwarmUI GenerateText2Image
12. **Proxy — Video backend** — Deforum async job submit + poll lifecycle
13. **Fastify server** + all routes (LLM + image + video + admin)
14. **WebSocket broadcaster** — extend `NodeState` to include image/video queue depths
15. **Dashboard** — add capability badges, Deforum job tracker panel, image queue indicators
16. **Docker build**
17. **Prometheus metrics** — add image/video-specific counters

Tests to write alongside each module (vitest):
- `scoring.test.ts` — capability filtering, image/LLM task type routing
- `router.test.ts` — Forge busy-lock, SwarmUI fallback, Deforum disk check
- `proxy.test.ts` — format translation for all 5 backends
- `poller.test.ts` — session refresh, failure threshold, busy detection
- `video-lifecycle.test.ts` — async job submit, poll, timeout, cancel

---

## 17. Deployment on vimage

```bash
# On vimage (192.168.2.100)
cd /opt
git clone git@git.dudeisland.eu:janiluuk/giggi-dispatcher.git
cd giggi-dispatcher
docker compose up -d

# Dashboard available at:
http://192.168.2.100:4242/dashboard

# API available at:
http://192.168.2.100:4242/v1/chat/completions
```

---

*End of implementation document.*
