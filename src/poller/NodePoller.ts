import type {
  NodeConfig,
  NodeState,
  GpuMetrics,
  SystemMetrics,
  LoadedModel,
  NodeStatus,
} from "../types/index.js";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "5000");
const POLL_TIMEOUT_MS = parseInt(process.env.POLL_TIMEOUT_MS ?? "3000");
const FAILURE_THRESHOLD = parseInt(process.env.NODE_FAILURE_THRESHOLD ?? "3");
const NVIDIA_METRICS_PORT = parseInt(process.env.NVIDIA_METRICS_PORT ?? "9835");
const NODE_EXPORTER_PORT = parseInt(process.env.NODE_EXPORTER_PORT ?? "9100");

function makeInitialState(config: NodeConfig): NodeState {
  return {
    config,
    status: "unknown",
    last_seen: 0,
    ping_ms: 0,
    gpu: null,
    system: null,
    queue_depth: 0,
    queue_depth_image: 0,
    queue_depth_video: 0,
    active_video_job: undefined,
    requests_total: 0,
    requests_ok: 0,
    requests_err: 0,
    p50_ms: 0,
    p95_ms: 0,
    score: 0,
  };
}

async function fetchWithTimeout(url: string, opts?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parsePrometheusMetric(text: string, metricName: string): number | null {
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith(metricName + " ") || line.startsWith(metricName + "{")) {
      const parts = line.split(" ");
      const val = parseFloat(parts[parts.length - 1]);
      if (!isNaN(val)) return val;
    }
  }
  return null;
}

function parsePrometheusMetricSum(text: string, prefix: string): number {
  let sum = 0;
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith(prefix) && !line.startsWith("#")) {
      const parts = line.split(" ");
      const val = parseFloat(parts[parts.length - 1]);
      if (!isNaN(val)) sum += val;
    }
  }
  return sum;
}

export class NodePoller {
  private states: Map<string, NodeState> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private failureCounts: Map<string, number> = new Map();
  private latencyHistory: Map<string, number[]> = new Map();
  // delta tracking for rate metrics
  private prevDiskRead: Map<string, number> = new Map();
  private prevDiskWrite: Map<string, number> = new Map();
  private prevNetRx: Map<string, number> = new Map();
  private prevNetTx: Map<string, number> = new Map();
  private prevPollTime: Map<string, number> = new Map();
  // SwarmUI session ids
  private swarmSessions: Map<string, string> = new Map();
  // Deforum extension check cache
  private deforumChecked: Map<string, boolean> = new Map();
  // Hosts with disk > 90% usage
  private diskPressureHosts: Set<string> = new Set();

  constructor(
    private fleet: NodeConfig[],
    private onUpdate: (state: NodeState) => void,
    private onStatusChange?: (id: string, status: NodeStatus, prev: NodeStatus) => void,
  ) {
    for (const node of fleet) {
      this.states.set(node.id, makeInitialState(node));
      this.failureCounts.set(node.id, 0);
      this.latencyHistory.set(node.id, []);
    }
  }

  start(): void {
    for (const node of this.fleet) {
      if (!node.enabled) continue;
      this.pollNode(node);
      const interval = setInterval(() => this.pollNode(node), POLL_INTERVAL_MS);
      this.intervals.set(node.id, interval);
    }
  }

  stop(): void {
    for (const interval of this.intervals.values()) clearInterval(interval);
    this.intervals.clear();
  }

  getState(id: string): NodeState | undefined {
    return this.states.get(id);
  }

  getAllStates(): NodeState[] {
    return Array.from(this.states.values());
  }

  incrementQueue(id: string, type: "llm" | "image" | "video"): void {
    const state = this.states.get(id);
    if (!state) return;
    if (type === "llm") state.queue_depth++;
    else if (type === "image") state.queue_depth_image++;
    else state.queue_depth_video++;
  }

  decrementQueue(id: string, type: "llm" | "image" | "video"): void {
    const state = this.states.get(id);
    if (!state) return;
    if (type === "llm") state.queue_depth = Math.max(0, state.queue_depth - 1);
    else if (type === "image") state.queue_depth_image = Math.max(0, state.queue_depth_image - 1);
    else state.queue_depth_video = Math.max(0, state.queue_depth_video - 1);
  }

  recordRequest(id: string, ok: boolean, latency_ms: number): void {
    const state = this.states.get(id);
    if (!state) return;
    state.requests_total++;
    if (ok) state.requests_ok++;
    else state.requests_err++;
    this.updateLatencyPercentiles(id, latency_ms);
  }

  setVideoJob(nodeId: string, jobId: string | undefined): void {
    const state = this.states.get(nodeId);
    if (!state) return;
    state.active_video_job = jobId;
    state.queue_depth_video = jobId ? 1 : 0;
  }

  getSwarmSession(nodeId: string): string | undefined {
    return this.swarmSessions.get(nodeId);
  }

  private async pollNode(node: NodeConfig): Promise<void> {
    const t0 = Date.now();
    const prev = this.states.get(node.id)!;
    const prevStatus = prev.status;

    try {
      let partial: Partial<NodeState>;

      if (node.backend === "ollama") {
        partial = await this.fetchOllamaMetrics(node);
      } else if (node.backend === "localai") {
        partial = await this.fetchLocalAIMetrics(node);
      } else if (node.backend === "sd_forge") {
        partial = await this.fetchForgeMetrics(node);
      } else if (node.backend === "swarmui") {
        partial = await this.fetchSwarmUIMetrics(node);
      } else if (node.backend === "deforum") {
        partial = await this.fetchDeforumMetrics(node);
      } else if (node.backend === "svd") {
        partial = await this.fetchSVDMetrics(node);
      } else if (node.backend === "ltx_video") {
        partial = await this.fetchLTXVideoMetrics(node);
      } else if (node.backend === "wan_video") {
        partial = await this.fetchWanVideoMetrics(node);
      } else if (node.backend === "animate_lcm") {
        partial = await this.fetchAnimateLCMMetrics(node);
      } else {
        partial = { status: "unknown" };
      }

      const ping_ms = Date.now() - t0;
      this.failureCounts.set(node.id, 0);

      // Fetch GPU + system metrics for non-SwarmUI nodes (SwarmUI provides its own)
      let gpu = partial.gpu ?? null;
      let system = partial.system ?? null;

      if (node.backend !== "swarmui" && node.gpu !== null) {
        gpu = (await this.fetchGpuMetrics(node.host)) ?? gpu;
      }
      if (node.backend !== "swarmui" && node.host !== "192.168.2.12") {
        system = (await this.fetchSystemMetrics(node.host)) ?? system;
      }

      const status = partial.status === "healthy" && this.diskPressureHosts.has(node.host)
        ? "degraded"
        : partial.status;

      const next: NodeState = {
        ...prev,
        ...partial,
        status: status ?? prev.status,
        ping_ms,
        last_seen: Date.now(),
        gpu,
        system,
      };

      this.states.set(node.id, next);
      this.onUpdate(next);

      if (prevStatus !== next.status && this.onStatusChange) {
        this.onStatusChange(node.id, next.status, prevStatus);
      }
    } catch {
      const failures = (this.failureCounts.get(node.id) ?? 0) + 1;
      this.failureCounts.set(node.id, failures);

      if (failures >= FAILURE_THRESHOLD) {
        const next: NodeState = { ...prev, status: "unreachable" };
        this.states.set(node.id, next);
        this.onUpdate(next);
        if (prevStatus !== "unreachable" && this.onStatusChange) {
          this.onStatusChange(node.id, "unreachable", prevStatus);
        }
      }
    }
  }

  private async fetchOllamaMetrics(node: NodeConfig): Promise<Partial<NodeState>> {
    const base = `http://${node.host}:${node.port}`;

    const healthRes = await fetchWithTimeout(`${base}/`);
    if (!healthRes.ok && healthRes.status !== 200) {
      return { status: "unreachable" };
    }

    const [tagsRes, psRes] = await Promise.allSettled([
      fetchWithTimeout(`${base}/api/tags`),
      fetchWithTimeout(`${base}/api/ps`),
    ]);

    const loaded_models: LoadedModel[] = [];

    if (psRes.status === "fulfilled" && psRes.value.ok) {
      const ps = await psRes.value.json() as { models?: Array<{ name: string; size: number; size_vram: number }> };
      for (const m of ps.models ?? []) {
        loaded_models.push({
          name: m.name,
          size_bytes: m.size,
          processor: m.size_vram > 0 ? "gpu" : "cpu",
        });
      }
    }

    // queue_depth for ollama is tracked via in-flight counter; ps only shows loaded models
    const queue_depth = this.states.get(node.id)?.queue_depth ?? 0;

    return {
      status: "healthy",
      gpu: this.states.get(node.id)?.gpu
        ? { ...this.states.get(node.id)!.gpu!, loaded_models }
        : null,
      queue_depth,
    };
  }

  private async fetchLocalAIMetrics(node: NodeConfig): Promise<Partial<NodeState>> {
    const base = `http://${node.host}:${node.port}`;

    const healthRes = await fetchWithTimeout(`${base}/healthz`);
    if (!healthRes.ok) return { status: "unreachable" };
    const health = await healthRes.json() as { status?: string };
    if (health.status !== "ok") return { status: "degraded" };

    let queue_depth = 0;
    try {
      const metricsRes = await fetchWithTimeout(`${base}/metrics`);
      if (metricsRes.ok) {
        const text = await metricsRes.text();
        const active = parsePrometheusMetric(text, "localai_active_requests");
        if (active !== null) queue_depth = Math.round(active);
      }
    } catch { /* metrics optional */ }

    return { status: "healthy", queue_depth };
  }

  private async fetchForgeMetrics(node: NodeConfig): Promise<Partial<NodeState>> {
    const base = `http://${node.host}:${node.port}`;

    let memRes: Response;
    try {
      memRes = await fetchWithTimeout(`${base}/sdapi/v1/memory`);
    } catch {
      return { status: "unreachable" };
    }

    if (memRes.status === 404) {
      // Forge running without --api
      return { status: "degraded" };
    }
    if (!memRes.ok) return { status: "unreachable" };

    const mem = await memRes.json() as {
      cuda?: { free: number; used: number; total: number };
    };

    let queue_depth_image = 0;
    let status: NodeStatus = "healthy";

    try {
      const progressRes = await fetchWithTimeout(`${base}/sdapi/v1/progress`);
      if (progressRes.ok) {
        const prog = await progressRes.json() as { progress?: number };
        if ((prog.progress ?? 0) > 0) {
          queue_depth_image = 1;
          status = "healthy"; // busy but healthy
        }
      }
    } catch { /* progress optional */ }

    // Check disk usage via node-exporter for degraded status
    const state = this.states.get(node.id)!;

    let gpu: GpuMetrics | null = state.gpu;
    if (mem.cuda) {
      const totalMb = mem.cuda.total / (1024 * 1024);
      const usedMb = mem.cuda.used / (1024 * 1024);
      const freeMb = mem.cuda.free / (1024 * 1024);
      gpu = {
        utilization_pct: state.gpu?.utilization_pct ?? 0,
        memory_used_mb: usedMb,
        memory_total_mb: totalMb,
        memory_free_mb: freeMb,
        temperature_c: state.gpu?.temperature_c ?? 0,
        power_draw_w: state.gpu?.power_draw_w ?? 0,
        power_limit_w: state.gpu?.power_limit_w ?? 0,
        loaded_models: state.gpu?.loaded_models ?? [],
      };
    }

    return { status, queue_depth_image, gpu };
  }

  private async fetchSwarmUIMetrics(node: NodeConfig): Promise<Partial<NodeState>> {
    const base = `http://${node.host}:${node.port}`;

    // Ensure we have a session
    let sessionId = this.swarmSessions.get(node.id);
    if (!sessionId) {
      sessionId = await this.acquireSwarmSession(node);
      if (!sessionId) return { status: "unreachable" };
    }

    const tryWithSessionRefresh = async <T>(fn: (sid: string) => Promise<T>): Promise<T | null> => {
      try {
        return await fn(sessionId!);
      } catch (e: unknown) {
        if (typeof e === "object" && e !== null && "error_id" in e && (e as { error_id: string }).error_id === "invalid_session_id") {
          sessionId = await this.acquireSwarmSession(node);
          if (!sessionId) return null;
          return fn(sessionId);
        }
        return null;
      }
    };

    const [statusData, resourceData] = await Promise.allSettled([
      tryWithSessionRefresh(async (sid) => {
        const r = await fetchWithTimeout(`${base}/API/GetServerStatus`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sid }),
        });
        const json = await r.json() as {
          error_id?: string;
          status?: { waiting_gens: number; live_gens: number };
          backend_status?: { status: string };
        };
        if (json.error_id === "invalid_session_id") throw { error_id: json.error_id };
        return json;
      }),
      tryWithSessionRefresh(async (sid) => {
        const r = await fetchWithTimeout(`${base}/API/GetServerResourceInfo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sid }),
        });
        const json = await r.json() as {
          error_id?: string;
          cpu?: { usage: number };
          system_ram?: { total: number; used: number; free: number };
          gpus?: Record<string, {
            temperature: number;
            utilization_gpu: number;
            utilization_memory: number;
            total_memory: number;
            free_memory: number;
            used_memory: number;
          }>;
        };
        if (json.error_id === "invalid_session_id") throw { error_id: json.error_id };
        return json;
      }),
    ]);

    let status: NodeStatus = "healthy";
    let queue_depth_image = 0;

    if (statusData.status === "fulfilled" && statusData.value) {
      const s = statusData.value;
      queue_depth_image = (s.status?.waiting_gens ?? 0) + (s.status?.live_gens ?? 0);
      const bkStatus = s.backend_status?.status;
      if (bkStatus === "errored" || bkStatus === "all_disabled") status = "degraded";
    } else {
      return { status: "unreachable" };
    }

    let gpu: GpuMetrics | null = null;
    let system: SystemMetrics | null = null;

    if (resourceData.status === "fulfilled" && resourceData.value) {
      const r = resourceData.value;
      const gpuInfo = r.gpus ? Object.values(r.gpus)[0] : undefined;
      if (gpuInfo) {
        gpu = {
          utilization_pct: gpuInfo.utilization_gpu,
          memory_used_mb: gpuInfo.used_memory,
          memory_total_mb: gpuInfo.total_memory,
          memory_free_mb: gpuInfo.free_memory,
          temperature_c: gpuInfo.temperature,
          power_draw_w: 0,
          power_limit_w: 0,
          loaded_models: [],
        };
      }
      if (r.system_ram) {
        const totalGb = r.system_ram.total / 1024;
        const usedGb = r.system_ram.used / 1024;
        system = {
          cpu_pct: (r.cpu?.usage ?? 0) * 100,
          mem_used_gb: usedGb,
          mem_total_gb: totalGb,
          mem_pct: totalGb > 0 ? (usedGb / totalGb) * 100 : 0,
          load_1m: 0,
          load_5m: 0,
          load_15m: 0,
          disk_read_mb_s: 0,
          disk_write_mb_s: 0,
          net_rx_mb_s: 0,
          net_tx_mb_s: 0,
        };
      }
    }

    return { status, queue_depth_image, gpu, system };
  }

  private async acquireSwarmSession(node: NodeConfig): Promise<string | undefined> {
    try {
      const r = await fetchWithTimeout(`http://${node.host}:${node.port}/API/GetNewSession`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await r.json() as { session_id?: string };
      if (json.session_id) {
        this.swarmSessions.set(node.id, json.session_id);
        return json.session_id;
      }
    } catch { /* ignore */ }
    return undefined;
  }

  private async fetchDeforumMetrics(node: NodeConfig): Promise<Partial<NodeState>> {
    const base = `http://${node.host}:${node.port}`;

    // Deforum uses Forge's health endpoint
    let healthRes: Response;
    try {
      healthRes = await fetchWithTimeout(`${base}/sdapi/v1/memory`);
    } catch {
      return { status: "unreachable" };
    }
    if (!healthRes.ok) return { status: "unreachable" };

    // Check extension availability (cached)
    if (!this.deforumChecked.has(node.id)) {
      try {
        const extRes = await fetchWithTimeout(`${base}/sdapi/v1/extensions`);
        if (extRes.ok) {
          const exts = await extRes.json() as Array<{ name: string; enabled: boolean }>;
          const hasDeforum = exts.some((e) => e.name.toLowerCase().includes("deforum") && e.enabled);
          this.deforumChecked.set(node.id, hasDeforum);
        }
      } catch { /* cache false */ }
    }

    const state = this.states.get(node.id)!;
    let queue_depth_video = state.queue_depth_video;
    let active_video_job = state.active_video_job;

    // Poll active job if any
    if (active_video_job) {
      try {
        const jobRes = await fetchWithTimeout(`${base}/deforum_api/batches/${active_video_job}`);
        if (jobRes.ok) {
          const job = await jobRes.json() as { status: string };
          if (job.status === "SUCCEEDED" || job.status === "FAILED") {
            active_video_job = undefined;
            queue_depth_video = 0;
          }
        }
      } catch { /* ignore */ }
    }

    return { status: "healthy", queue_depth_video, active_video_job };
  }

  private async fetchGpuMetrics(host: string): Promise<GpuMetrics | null> {
    try {
      const r = await fetchWithTimeout(`http://${host}:${NVIDIA_METRICS_PORT}/metrics`);
      if (!r.ok) return null;
      const text = await r.text();

      const util = parsePrometheusMetric(text, "DCGM_FI_DEV_GPU_UTIL")
        ?? parsePrometheusMetric(text, "nvidia_gpu_duty_cycle");
      const memUsed = parsePrometheusMetric(text, "DCGM_FI_DEV_FB_USED")
        ?? parsePrometheusMetric(text, "nvidia_gpu_memory_used_bytes");
      const powerDraw = parsePrometheusMetric(text, "DCGM_FI_DEV_POWER_USAGE");

      if (util === null || memUsed === null) return null;

      // DCGM reports MiB; node-exporter reports bytes
      const memUsedMb = memUsed > 1_000_000 ? memUsed / (1024 * 1024) : memUsed;

      return {
        utilization_pct: util,
        memory_used_mb: memUsedMb,
        memory_total_mb: 0, // filled by Forge memory API when available
        memory_free_mb: 0,
        temperature_c: 0,
        power_draw_w: powerDraw ?? 0,
        power_limit_w: 0,
        loaded_models: [],
      };
    } catch {
      return null;
    }
  }

  private async fetchSystemMetrics(host: string): Promise<SystemMetrics | null> {
    try {
      const r = await fetchWithTimeout(`http://${host}:${NODE_EXPORTER_PORT}/metrics`);
      if (!r.ok) return null;
      const text = await r.text();

      const now = Date.now();
      const prevTime = this.prevPollTime.get(host) ?? now;
      const deltaS = Math.max(1, (now - prevTime) / 1000);
      this.prevPollTime.set(host, now);

      // CPU: 1 - (idle / total)
      const cpuIdleSum = parsePrometheusMetricSum(text, 'node_cpu_seconds_total{mode="idle"}');
      const cpuTotalSum = parsePrometheusMetricSum(text, "node_cpu_seconds_total");
      const cpu_pct = cpuTotalSum > 0 ? (1 - cpuIdleSum / cpuTotalSum) * 100 : 0;

      // Memory
      const memTotal = parsePrometheusMetric(text, "node_memory_MemTotal_bytes") ?? 0;
      const memAvail = parsePrometheusMetric(text, "node_memory_MemAvailable_bytes") ?? 0;
      const memUsed = memTotal - memAvail;
      const mem_total_gb = memTotal / (1024 ** 3);
      const mem_used_gb = memUsed / (1024 ** 3);

      // Load averages
      const load_1m = parsePrometheusMetric(text, "node_load1") ?? 0;
      const load_5m = parsePrometheusMetric(text, "node_load5") ?? 0;
      const load_15m = parsePrometheusMetric(text, "node_load15") ?? 0;

      // Disk I/O deltas
      const diskReadNow = parsePrometheusMetricSum(text, "node_disk_read_bytes_total");
      const diskWriteNow = parsePrometheusMetricSum(text, "node_disk_written_bytes_total");
      const prevDiskRead = this.prevDiskRead.get(host) ?? diskReadNow;
      const prevDiskWrite = this.prevDiskWrite.get(host) ?? diskWriteNow;
      this.prevDiskRead.set(host, diskReadNow);
      this.prevDiskWrite.set(host, diskWriteNow);
      const disk_read_mb_s = Math.max(0, (diskReadNow - prevDiskRead) / deltaS / (1024 * 1024));
      const disk_write_mb_s = Math.max(0, (diskWriteNow - prevDiskWrite) / deltaS / (1024 * 1024));

      // Network I/O deltas
      const netRxNow = parsePrometheusMetricSum(text, "node_network_receive_bytes_total");
      const netTxNow = parsePrometheusMetricSum(text, "node_network_transmit_bytes_total");
      const prevNetRx = this.prevNetRx.get(host) ?? netRxNow;
      const prevNetTx = this.prevNetTx.get(host) ?? netTxNow;
      this.prevNetRx.set(host, netRxNow);
      this.prevNetTx.set(host, netTxNow);
      const net_rx_mb_s = Math.max(0, (netRxNow - prevNetRx) / deltaS / (1024 * 1024));
      const net_tx_mb_s = Math.max(0, (netTxNow - prevNetTx) / deltaS / (1024 * 1024));

      // Disk pressure check
      const diskAvail = parsePrometheusMetric(text, "node_filesystem_avail_bytes");
      const diskTotal = parsePrometheusMetric(text, "node_filesystem_size_bytes");
      if (diskAvail !== null && diskTotal !== null && diskTotal > 0) {
        const usedPct = (1 - diskAvail / diskTotal) * 100;
        if (usedPct > 90) {
          this.diskPressureHosts.add(host);
        } else {
          this.diskPressureHosts.delete(host);
        }
      }

      return {
        cpu_pct,
        mem_used_gb,
        mem_total_gb,
        mem_pct: mem_total_gb > 0 ? (mem_used_gb / mem_total_gb) * 100 : 0,
        load_1m,
        load_5m,
        load_15m,
        disk_read_mb_s,
        disk_write_mb_s,
        net_rx_mb_s,
        net_tx_mb_s,
      };
    } catch {
      return null;
    }
  }

  // ── New video backend health checks ──────────────────────────────────────

  private async fetchSVDMetrics(node: NodeConfig): Promise<Partial<NodeState>> {
    try {
      const res = await fetchWithTimeout(`http://${node.host}:${node.port}/health`);
      if (!res.ok) return { status: "unreachable" };
      const state = this.states.get(node.id)!;
      return { status: "healthy", queue_depth_video: state.queue_depth_video, active_video_job: state.active_video_job };
    } catch {
      return { status: "unreachable" };
    }
  }

  private async fetchLTXVideoMetrics(node: NodeConfig): Promise<Partial<NodeState>> {
    try {
      const res = await fetchWithTimeout(`http://${node.host}:${node.port}/health`);
      if (!res.ok) return { status: "unreachable" };
      const state = this.states.get(node.id)!;
      return { status: "healthy", queue_depth_video: state.queue_depth_video, active_video_job: state.active_video_job };
    } catch {
      return { status: "unreachable" };
    }
  }

  private async fetchWanVideoMetrics(node: NodeConfig): Promise<Partial<NodeState>> {
    try {
      const res = await fetchWithTimeout(`http://${node.host}:${node.port}/health`);
      if (!res.ok) return { status: "unreachable" };
      const state = this.states.get(node.id)!;
      return { status: "healthy", queue_depth_video: state.queue_depth_video, active_video_job: state.active_video_job };
    } catch {
      return { status: "unreachable" };
    }
  }

  private async fetchAnimateLCMMetrics(node: NodeConfig): Promise<Partial<NodeState>> {
    // AnimateLCM runs inside a Forge instance — reuse the Forge health check
    const forgePartial = await this.fetchForgeMetrics(node);
    const state = this.states.get(node.id)!;
    return { ...forgePartial, queue_depth_video: state.queue_depth_video, active_video_job: state.active_video_job };
  }

  private updateLatencyPercentiles(id: string, latency_ms: number): void {
    const hist = this.latencyHistory.get(id) ?? [];
    hist.push(latency_ms);
    if (hist.length > 200) hist.shift();
    this.latencyHistory.set(id, hist);

    const sorted = [...hist].sort((a, b) => a - b);
    const state = this.states.get(id);
    if (!state) return;
    state.p50_ms = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    state.p95_ms = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  }
}
