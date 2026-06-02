export type NodeCapability = "llm" | "txt2img" | "img2img" | "txt2video" | "img2video";
export type BackendType = "ollama" | "localai" | "sd_forge" | "swarmui" | "deforum" | "svd" | "ltx_video" | "wan_video" | "animate_lcm";
export type GpuArch = "blackwell" | "ada" | "ampere" | "pascal" | "volta" | null;
export type NodeTier = 1 | 2 | 3;
export type TaskType = "classify" | "parse_agreement" | "generic" | "txt2img" | "img2img" | "txt2video" | "img2video";
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
  capabilities: NodeCapability[];
}

export interface GpuMetrics {
  utilization_pct: number;
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
  cpu_pct: number;
  mem_used_gb: number;
  mem_total_gb: number;
  mem_pct: number;
  load_1m: number;
  load_5m: number;
  load_15m: number;
  disk_read_mb_s: number;
  disk_write_mb_s: number;
  net_rx_mb_s: number;
  net_tx_mb_s: number;
}

export interface NodeState {
  config: NodeConfig;
  status: NodeStatus;
  last_seen: number;
  ping_ms: number;
  gpu: GpuMetrics | null;
  system: SystemMetrics | null;
  queue_depth: number;
  queue_depth_image: number;
  queue_depth_video: number;
  active_video_job?: string;
  requests_total: number;
  requests_ok: number;
  requests_err: number;
  p50_ms: number;
  p95_ms: number;
  score: number;
}

export interface RoutingDecision {
  id: string;
  ts: number;
  task_type: TaskType;
  selected_node: string;
  candidates: string[];
  reason: string;
  latency_ms?: number;
  success?: boolean;
}

export interface DispatcherStats {
  requests_total: number;
  requests_ok: number;
  requests_err: number;
  requests_queued: number;
  uptime_s: number;
  nodes: NodeState[];
  recent_decisions: RoutingDecision[];
  video_stats: VideoBackendStats[];
}

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

export interface OllamaChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  stream: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
    top_p?: number;
  };
}

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
  init_image?: string;
  denoising_strength?: number;
}

export interface VideoGenRequest {
  // Unified fields (all backends)
  prompt?: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  num_frames?: number;
  fps?: number;
  seed?: number;
  steps?: number;
  cfg_scale?: number;
  model?: string;
  // img2video backends (SVD, LTX I2V, Wan I2V)
  image?: string;              // base64-encoded input image
  motion_bucket_id?: number;   // SVD: controls motion intensity (0–255, default 127)
  augmentation_level?: number; // SVD: noise augmentation (0.0–1.0, default 0.0)
  // Deforum legacy fields
  animation_mode?: "2D" | "3D";
  max_frames?: number;
  prompts?: Record<string, string>;
}

export interface VideoGenJob {
  job_id: string;
  node_id: string;
  backend_batch_id: string;
  status: "pending" | "running" | "succeeded" | "failed";
  frames_done: number;
  total_frames: number;
  outdir?: string;       // Deforum: filesystem path where frames are written
  output_b64?: string;   // SVD / LTX / Wan / AnimateLCM: base64-encoded video or GIF
  submitted_at: number;
  updated_at: number;
  duration_ms?: number;  // wall-clock time from submission to completion
  error?: string;
}

export interface VideoBackendStats {
  backend: string;
  jobs_total: number;
  jobs_ok: number;
  jobs_failed: number;
  duration_avg_ms: number;
  duration_min_ms: number;
  duration_max_ms: number;
  last_updated: number;
}

export type WSMessage =
  | { type: "state_snapshot"; data: DispatcherStats }
  | { type: "routing_decision"; data: RoutingDecision }
  | { type: "node_status_change"; data: { id: string; status: NodeStatus; prev: NodeStatus } };
