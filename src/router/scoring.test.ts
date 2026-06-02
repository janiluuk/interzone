import { describe, it, expect } from "vitest";
import { scoreNode, tierBoost } from "./scoring.js";
import type { NodeState, NodeConfig } from "../types/index.js";

function makeState(
  { config: configOverride, ...stateOverrides }: Partial<Omit<NodeState, "config">> & { config?: Partial<NodeConfig> } = {},
): NodeState {
  const config: NodeConfig = {
    id: "test-node",
    host: "192.168.1.1",
    label: "Test Node",
    backend: "ollama",
    port: 11434,
    gpu: { name: "RTX 3060", arch: "ampere", vram_gb: 12, cuda_cap: 8.6 },
    tier: 2,
    tags: [],
    enabled: true,
    capabilities: ["llm"],
    ...configOverride,
  };

  return {
    config,
    status: "healthy",
    last_seen: Date.now(),
    ping_ms: 10,
    gpu: {
      utilization_pct: 0,
      memory_used_mb: 0,
      memory_total_mb: 12288,
      memory_free_mb: 12288,
      temperature_c: 50,
      power_draw_w: 50,
      power_limit_w: 170,
      loaded_models: [],
    },
    system: null,
    queue_depth: 0,
    queue_depth_image: 0,
    queue_depth_video: 0,
    requests_total: 0,
    requests_ok: 0,
    requests_err: 0,
    p50_ms: 0,
    p95_ms: 0,
    score: 0,
    ...stateOverrides,
  };
}

describe("scoreNode", () => {
  it("returns max score for idle healthy tier1 node", () => {
    const state = makeState({ config: { tier: 1 } as Partial<NodeConfig> });
    const score = scoreNode(state);
    // VRAM free 100% → 35, util 0% → 25, queue 0 → 20, latency 0 → 10, tier1 → 10 = 100
    expect(score).toBeCloseTo(100, 0);
  });

  it("caps degraded node at 30", () => {
    const state = makeState({ status: "degraded" });
    const score = scoreNode(state);
    expect(score).toBeLessThanOrEqual(30);
  });

  it("returns 0 for unreachable node", () => {
    const state = makeState({ status: "unreachable" });
    expect(scoreNode(state)).toBe(0);
  });

  it("subtracts 15 for overheated GPU", () => {
    const state = makeState();
    state.gpu!.temperature_c = 85;
    const hot = scoreNode(state);
    state.gpu!.temperature_c = 50;
    const cool = scoreNode(state);
    expect(cool - hot).toBeCloseTo(15, 0);
  });

  it("subtracts 10 for near-power-limit", () => {
    const state = makeState();
    state.gpu!.power_draw_w = 165;
    state.gpu!.power_limit_w = 170;
    const nearLimit = scoreNode(state);
    state.gpu!.power_draw_w = 50;
    const normal = scoreNode(state);
    expect(normal - nearLimit).toBeCloseTo(10, 0);
  });

  it("penalizes high queue depth", () => {
    const low = makeState({ queue_depth: 0 });
    const high = makeState({ queue_depth: 5 });
    expect(scoreNode(low)).toBeGreaterThan(scoreNode(high));
  });
});

describe("tierBoost", () => {
  it("boosts tier1 node for parse_agreement", () => {
    const state = makeState({ config: { tier: 1 } as Partial<NodeConfig> });
    expect(tierBoost(state, "parse_agreement")).toBeGreaterThan(0);
  });

  it("does not boost tier2 for parse_agreement", () => {
    const state = makeState({ config: { tier: 2 } as Partial<NodeConfig> });
    expect(tierBoost(state, "parse_agreement")).toBe(0);
  });

  it("does not boost for classify task", () => {
    const state = makeState({ config: { tier: 1 } as Partial<NodeConfig> });
    expect(tierBoost(state, "classify")).toBe(0);
  });
});
