# Interzone Dispatcher

A self-hosted inference router and load balancer for LAN GPU clusters. It sits in front of multiple local AI inference nodes and routes each request to the best available GPU based on real-time health metrics — VRAM headroom, GPU utilisation, queue depth, and response latency.

## Use case

If you run several machines with consumer GPUs (e.g. a mix of RTX 3060s, 4060 Tis, and a Tesla P100) and want a single endpoint for all your local inference work, Interzone acts as the dispatch layer. Clients talk to one URL; Interzone picks the right node per request.

Typical setup:

- **LLM inference** via [Ollama](https://ollama.com) or [LocalAI](https://localai.io) across multiple nodes
- **Image generation** via [Stable Diffusion Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge) or [SwarmUI](https://github.com/mcmonkeyprojects/SwarmUI)
- **Video generation** via [Deforum](https://github.com/deforum-art/sd-webui-deforum) on a dedicated node

Interzone is not a cloud gateway — it is designed for a trusted home or lab LAN where you own every machine.

## How routing works

Each node gets a score (0–100) computed every poll cycle from:

| Factor | Weight |
|--------|--------|
| GPU VRAM free % | 35 pts |
| GPU compute utilisation (inverted) | 25 pts |
| Queue depth (inverted, 0–5 req) | 20 pts |
| p50 response latency (inverted) | 10 pts |
| Node tier | 10 pts |

Penalties are applied for GPU temperature above 80 °C (−15) and power draw above 95 % of TDP (−10). A node at status `degraded` (disk >90 %, partial failure) is capped at 30. An `unreachable` node scores 0 and is excluded from selection.

Task routing adds a tier boost for high-priority task types (e.g. `parse_agreement` is always sent to Tier 1 nodes when available).

## Supported backends

| Backend | Task types | Protocol |
|---------|-----------|----------|
| Ollama | LLM chat | `/api/chat` (NDJSON), translated to OpenAI SSE |
| LocalAI | LLM chat | `/v1/chat/completions` (OpenAI-compatible) |
| Stable Diffusion Forge | txt2img, img2img | `/sdapi/v1/txt2img`, `/sdapi/v1/img2img` |
| SwarmUI | txt2img | `/API/GenerateText2Image` |
| Deforum | txt2video | `/deforum_api/batches` (async) |

## API

The dispatcher exposes an OpenAI-compatible surface plus admin and media endpoints:

```
POST /v1/chat/completions       — LLM inference (streaming and non-streaming)
GET  /v1/models                 — List models available across the fleet
POST /v1/images/generations     — txt2img
POST /v1/images/edits           — img2img
POST /v1/video/generations      — Submit a Deforum video job (returns job_id)
GET  /v1/video/generations/:id  — Poll video job status

GET  /admin/nodes               — All node states with metrics
GET  /admin/nodes/:id           — Single node
PUT  /admin/nodes/:id/enable    — Enable or disable a node
POST /admin/nodes/:id/drain     — Drain (disable + mark draining)
GET  /admin/stats               — Aggregated request counters + recent decisions
GET  /admin/decisions           — Last 100 routing decisions

GET  /healthz                   — Health check
GET  /metrics                   — Prometheus metrics
GET  /ws/dashboard              — WebSocket: live state snapshots + routing events
```

Request headers for LLM requests:

- `X-Task-Type`: `classify` | `parse_agreement` | `generic` (default: `generic`)
- `X-Model-Hint`: model name prefix to prefer nodes that have the model loaded
- `X-Backend-Prefer`: force a specific backend type (`ollama`, `localai`, etc.)

## Dashboard

A React dashboard is served at `/dashboard`. It shows:

- **Fleet topology** — animated canvas with live node status and packet traces
- **Node cards** — per-node GPU gauges (compute, VRAM), system CPU/RAM bars, queue depth, p50/p95 latency, and request counters
- **Throughput chart** — 2-minute rolling req/s per node
- **Route log** — last 100 routing decisions with task type, selected node, reason, and latency

## Running

### Docker (recommended)

```bash
docker compose up -d
```

The dispatcher listens on port `4242`. Edit `docker-compose.yml` to set your node IPs or configure the fleet in `src/config/fleet.ts`.

### Local dev

```bash
npm install
npm run dev          # tsc watch + vite dev server + nodemon
```

The Vite dev server on `:5173` proxies API and WebSocket calls to the dispatcher on `:4242`.

### Production build

```bash
npm run build        # compiles server to dist/ and dashboard to dist/dashboard/
npm start
```

## Configuration

All options are environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4242` | Dispatcher listen port |
| `POLL_INTERVAL_MS` | `5000` | How often each node is polled |
| `POLL_TIMEOUT_MS` | `3000` | Per-poll HTTP timeout |
| `NODE_FAILURE_THRESHOLD` | `3` | Consecutive failures before `unreachable` |
| `WS_BROADCAST_INTERVAL_MS` | `2000` | Dashboard WebSocket push interval |
| `DISABLED_NODES` | `vimage-cpu` | Comma-separated node IDs to disable on startup |
| `INFERENCE_TIMEOUT_MS` | `60000` | Upstream inference request timeout |
| `MIN_VRAM_FREE_MB` | `2048` | Minimum free VRAM required when a model hint is given |
| `NVIDIA_METRICS_PORT` | `9835` | Port for DCGM or nvidia-exporter on each node |
| `NODE_EXPORTER_PORT` | `9100` | Port for Prometheus node-exporter on each node |
| `TIER1_BOOST_SCORE` | `20` | Extra score added for Tier 1 nodes on `parse_agreement` tasks |

## Fleet configuration

Edit `src/config/fleet.ts` to describe your machines. Each node needs an `id`, `host`, `backend`, `port`, `tier`, and `capabilities`. GPU metadata is used for VRAM-based filtering and display only — actual VRAM metrics are pulled from the exporters at runtime.

Node tiers control routing priority: Tier 1 nodes are preferred for demanding tasks, Tier 3 is fallback (CPU-only, etc.).
