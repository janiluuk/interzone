import { describe, it, expect, vi, beforeEach } from "vitest";
import { Router } from "./Router.js";
import type { NodePoller } from "../poller/NodePoller.js";
import type { NodeState, NodeConfig } from "../types/index.js";

function makeNodeState(id: string, overrides: Partial<NodeState> = {}): NodeState {
  const config: NodeConfig = {
    id,
    host: "192.168.1.1",
    label: id,
    backend: "ollama",
    port: 11434,
    gpu: { name: "RTX 3060", arch: "ampere", vram_gb: 12, cuda_cap: 8.6 },
    tier: 2,
    tags: [],
    enabled: true,
    capabilities: ["llm"],
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
      memory_free_mb: 10000,
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
    ...overrides,
  };
}

function makePoller(states: NodeState[]): NodePoller {
  return {
    getAllStates: () => states,
    getState: (id: string) => states.find((s) => s.config.id === id),
    incrementQueue: vi.fn(),
    decrementQueue: vi.fn(),
    recordRequest: vi.fn(),
    setVideoJob: vi.fn(),
    getSwarmSession: vi.fn(() => "session123"),
  } as unknown as NodePoller;
}

describe("Router.selectNode", () => {
  it("returns null when no nodes available", () => {
    const poller = makePoller([]);
    const router = new Router(poller);
    expect(router.selectNode("generic")).toBeNull();
  });

  it("selects the only healthy node", () => {
    const node = makeNodeState("node-a");
    const router = new Router(makePoller([node]));
    const result = router.selectNode("generic");
    expect(result?.node.id).toBe("node-a");
  });

  it("ignores unreachable nodes", () => {
    const dead = makeNodeState("dead", { status: "unreachable" });
    const alive = makeNodeState("alive");
    const router = new Router(makePoller([dead, alive]));
    const result = router.selectNode("generic");
    expect(result?.node.id).toBe("alive");
  });

  it("filters by capability — txt2img nodes only", () => {
    const llmNode = makeNodeState("llm-node");
    const imgNode = makeNodeState("img-node", {
      config: {
        ...llmNode.config,
        id: "img-node",
        backend: "sd_forge",
        capabilities: ["txt2img", "img2img"],
      },
    });
    const router = new Router(makePoller([llmNode, imgNode]));
    const result = router.selectNode("txt2img");
    expect(result?.node.id).toBe("img-node");
  });

  it("does not route to busy Forge node for image tasks", () => {
    const busy = makeNodeState("forge-busy", {
      config: {
        id: "forge-busy",
        host: "192.168.1.2",
        label: "forge-busy",
        backend: "sd_forge",
        port: 7860,
        gpu: null,
        tier: 2,
        tags: [],
        enabled: true,
        capabilities: ["txt2img", "img2img"],
      },
      queue_depth_image: 1,
    });
    const router = new Router(makePoller([busy]));
    expect(router.selectNode("txt2img")).toBeNull();
  });

  it("prefers tier1 for parse_agreement", () => {
    const tier1 = makeNodeState("tier1-node", {
      config: {
        id: "tier1-node",
        host: "192.168.1.1",
        label: "tier1",
        backend: "ollama",
        port: 11434,
        gpu: { name: "P100", arch: "pascal", vram_gb: 16, cuda_cap: 6.0 },
        tier: 1,
        tags: [],
        enabled: true,
        capabilities: ["llm"],
      },
    });
    const tier2 = makeNodeState("tier2-node");
    const router = new Router(makePoller([tier2, tier1]));
    const result = router.selectNode("parse_agreement");
    expect(result?.node.id).toBe("tier1-node");
  });
});
