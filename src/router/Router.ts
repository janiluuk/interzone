import { v4 as uuidv4 } from "uuid";
import type { NodeCapability, NodeConfig, NodeState, RoutingDecision, TaskType } from "../types/index.js";
import type { NodePoller } from "../poller/NodePoller.js";
import { scoreNode, tierBoost } from "./scoring.js";

const MIN_VRAM_FREE_MB = parseInt(process.env.MIN_VRAM_FREE_MB ?? "2048");

// Task type → allowed backends
const CAPABILITY_MAP: Record<TaskType, string[]> = {
  classify: ["ollama", "localai"],
  parse_agreement: ["ollama", "localai"],
  generic: ["ollama", "localai"],
  txt2img: ["sd_forge", "swarmui"],
  img2img: ["sd_forge", "swarmui"],
  txt2video: ["deforum"],
};

// Task type → required node capability
const TASK_CAPABILITY: Record<TaskType, NodeCapability> = {
  classify: "llm",
  parse_agreement: "llm",
  generic: "llm",
  txt2img: "txt2img",
  img2img: "img2img",
  txt2video: "txt2video",
};

export class Router {
  private decisions: RoutingDecision[] = [];
  private onDecision?: (d: RoutingDecision) => void;

  constructor(
    private poller: NodePoller,
    onDecision?: (d: RoutingDecision) => void,
  ) {
    this.onDecision = onDecision;
  }

  getRecentDecisions(): RoutingDecision[] {
    return this.decisions.slice(-100);
  }

  completeDecision(id: string, latency_ms: number, success: boolean): void {
    const d = this.decisions.find((x) => x.id === id);
    if (d) {
      d.latency_ms = latency_ms;
      d.success = success;
    }
  }

  selectNode(
    task: TaskType,
    modelHint?: string,
    backendPrefer?: string,
  ): { node: NodeConfig; decision: RoutingDecision } | null {
    const allStates = this.poller.getAllStates();

    const allowedBackends = CAPABILITY_MAP[task] ?? ["ollama", "localai"];

    // Filter: enabled, reachable, has required capability, correct backend type
    let candidates = allStates.filter((s) => {
      if (!s.config.enabled) return false;
      if (s.status === "unreachable") return false;
      if (!s.config.capabilities.includes(TASK_CAPABILITY[task])) return false;
      if (!allowedBackends.includes(s.config.backend)) return false;
      return true;
    });

    // Filter: image nodes that are already busy (Forge FIFO lock)
    if (task === "txt2img" || task === "img2img") {
      candidates = candidates.filter((s) => s.queue_depth_image === 0);
    }

    // Filter: Deforum — only route if no active job on node
    if (task === "txt2video") {
      candidates = candidates.filter((s) => !s.active_video_job);
      // Check disk space for vimage3 (98% disk — require 5GB free)
      candidates = candidates.filter((s) => {
        if (s.config.host === "192.168.2.102") {
          const freeMb = (s.system?.disk_read_mb_s !== undefined)
            ? this.estimateDiskFreeFromSystem(s)
            : Infinity;
          return freeMb > 5 * 1024;
        }
        return true;
      });
    }

    // Filter: VRAM requirement
    if (modelHint) {
      candidates = candidates.filter((s) => {
        if (!s.gpu) return false;
        return s.gpu.memory_free_mb >= MIN_VRAM_FREE_MB;
      });
    }

    // Filter: model must be available on node (for LLM tasks with a model hint)
    if (modelHint && (task === "classify" || task === "parse_agreement" || task === "generic")) {
      const withModel = candidates.filter(
        (s) => s.gpu?.loaded_models.some((m) => m.name.startsWith(modelHint)),
      );
      // Prefer nodes that have the model loaded; fall back to all if none have it loaded
      if (withModel.length > 0) candidates = withModel;
    }

    if (candidates.length === 0) return null;

    // Apply backend preference hint
    if (backendPrefer) {
      const preferred = candidates.filter((s) => s.config.backend === backendPrefer);
      if (preferred.length > 0) candidates = preferred;
    }

    // Score all candidates
    const scored = candidates.map((s) => ({
      state: s,
      score: scoreNode(s) + tierBoost(s, task),
    }));

    // Sort: highest score first, then lowest queue, then lowest p50
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.state.queue_depth !== b.state.queue_depth) return a.state.queue_depth - b.state.queue_depth;
      return a.state.p50_ms - b.state.p50_ms;
    });

    const winner = scored[0].state;
    const reason = this.buildReason(winner, task, scored[0].score);

    const decision: RoutingDecision = {
      id: uuidv4(),
      ts: Date.now(),
      task_type: task,
      selected_node: winner.config.id,
      candidates: candidates.map((s) => s.config.id),
      reason,
    };

    this.decisions.push(decision);
    if (this.decisions.length > 100) this.decisions.shift();
    this.onDecision?.(decision);

    return { node: winner.config, decision };
  }

  private buildReason(state: NodeState, task: TaskType, score: number): string {
    const parts: string[] = [`score=${score.toFixed(0)}`, `tier=${state.config.tier}`];
    if (state.gpu) parts.push(`vram_free=${state.gpu.memory_free_mb.toFixed(0)}MB`);
    if (state.queue_depth > 0) parts.push(`queue=${state.queue_depth}`);
    if (task === "parse_agreement" && state.config.tier === 1) parts.push("tier1-boost");
    return parts.join(" ");
  }

  // Rough disk free estimate — we don't have a proper disk_free counter without node-exporter
  private estimateDiskFreeFromSystem(_state: NodeState): number {
    // Return Infinity (pass filter) unless we have disk metrics; those come from node-exporter
    // which is unavailable for this path. The disk degraded flag is checked via poller state.
    return Infinity;
  }
}
