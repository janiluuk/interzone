import type { NodeState, TaskType } from "../types/index.js";

const TIER_BOOST = parseInt(process.env.TIER1_BOOST_SCORE ?? "20");

export function scoreNode(state: NodeState): number {
  if (state.status === "unreachable") return 0;

  let score = 0;

  // GPU free VRAM % — 0..35 pts
  if (state.gpu) {
    const total = state.gpu.memory_total_mb;
    const free = state.gpu.memory_free_mb;
    const vramFreePct = total > 0 ? (free / total) * 100 : 50;
    score += vramFreePct * 0.35;
  }

  // GPU utilization — inverted, 0..25 pts
  if (state.gpu) {
    score += (1 - state.gpu.utilization_pct / 100) * 25;
  }

  // Queue depth — inverted, 0..20 pts (depth 0 = 20pts, depth 5+ = 0pts)
  const queueScore = Math.max(0, 1 - state.queue_depth / 5) * 20;
  score += queueScore;

  // p50 latency — inverted, 0..10 pts (0ms=10, 5000ms+=0)
  const latencyScore = Math.max(0, 1 - state.p50_ms / 5000) * 10;
  score += latencyScore;

  // Tier — 0..10 pts
  const tierPts: Record<number, number> = { 1: 10, 2: 6, 3: 2 };
  score += tierPts[state.config.tier] ?? 2;

  // Caps and penalties
  if (state.status === "degraded") score = Math.min(score, 30);
  if (state.gpu?.temperature_c && state.gpu.temperature_c > 80) score -= 15;
  if (state.gpu && state.gpu.power_limit_w > 0) {
    if (state.gpu.power_draw_w / state.gpu.power_limit_w > 0.95) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

export function tierBoost(state: NodeState, task: TaskType): number {
  if (task === "parse_agreement" && state.config.tier === 1) return TIER_BOOST;
  return 0;
}
