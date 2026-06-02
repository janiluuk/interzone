import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from "prom-client";
import type { Proxy } from "../proxy/Proxy.js";
import type { NodePoller } from "../poller/NodePoller.js";
import type { Router } from "../router/Router.js";
import type { DashboardBroadcaster } from "../ws/DashboardBroadcaster.js";
import type { NodeState } from "../types/index.js";

const startTime = Date.now();

export function buildMetrics() {
  const register = new Registry();
  collectDefaultMetrics({ register });

  const requestsTotal = new Counter({
    name: "dispatcher_requests_total",
    help: "Total requests",
    labelNames: ["task_type", "node_id", "status"],
    registers: [register],
  });

  const requestDuration = new Histogram({
    name: "dispatcher_request_duration_ms",
    help: "Request duration in milliseconds",
    labelNames: ["task_type", "node_id"],
    buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
    registers: [register],
  });

  const queueDepth = new Gauge({
    name: "dispatcher_queue_depth_total",
    help: "Current total queue depth",
    registers: [register],
  });

  const routingDecisions = new Counter({
    name: "dispatcher_routing_decisions_total",
    help: "Routing decisions made",
    labelNames: ["task_type", "selected_node", "tier"],
    registers: [register],
  });

  const noNodesAvailable = new Counter({
    name: "dispatcher_no_nodes_available_total",
    help: "Times no node was available to serve a request",
    registers: [register],
  });

  const nodeScore = new Gauge({
    name: "dispatcher_node_score",
    help: "Current routing score per node",
    labelNames: ["node_id"],
    registers: [register],
  });

  const nodeGpuUtil = new Gauge({
    name: "dispatcher_node_gpu_utilization_pct",
    help: "GPU utilization percent per node",
    labelNames: ["node_id"],
    registers: [register],
  });

  const nodeVramFree = new Gauge({
    name: "dispatcher_node_gpu_vram_free_mb",
    help: "GPU VRAM free MB per node",
    labelNames: ["node_id"],
    registers: [register],
  });

  const nodeQueueDepth = new Gauge({
    name: "dispatcher_node_queue_depth",
    help: "Queue depth per node",
    labelNames: ["node_id"],
    registers: [register],
  });

  const nodeP50 = new Gauge({
    name: "dispatcher_node_p50_ms",
    help: "p50 latency per node",
    labelNames: ["node_id"],
    registers: [register],
  });

  const nodeStatus = new Gauge({
    name: "dispatcher_node_status",
    help: "Node status (1=healthy, 0.5=degraded, 0=unreachable)",
    labelNames: ["node_id", "status"],
    registers: [register],
  });

  return {
    register,
    requestsTotal,
    requestDuration,
    queueDepth,
    routingDecisions,
    noNodesAvailable,
    nodeScore,
    nodeGpuUtil,
    nodeVramFree,
    nodeQueueDepth,
    nodeP50,
    nodeStatus,
  };
}

export type Metrics = ReturnType<typeof buildMetrics>;

function statusToGaugeValue(status: string): number {
  if (status === "healthy") return 1;
  if (status === "degraded") return 0.5;
  return 0;
}

export async function registerRoutes(
  app: FastifyInstance,
  proxy: Proxy,
  poller: NodePoller,
  router: Router,
  broadcaster: DashboardBroadcaster,
  metrics: Metrics,
): Promise<void> {

  // ── Metrics update helper ─────────────────────────────────────────────────
  function refreshNodeMetrics(states: NodeState[]): void {
    let totalQueue = 0;
    for (const s of states) {
      const id = s.config.id;
      metrics.nodeScore.set({ node_id: id }, s.score);
      metrics.nodeGpuUtil.set({ node_id: id }, s.gpu?.utilization_pct ?? 0);
      metrics.nodeVramFree.set({ node_id: id }, s.gpu?.memory_free_mb ?? 0);
      metrics.nodeQueueDepth.set({ node_id: id }, s.queue_depth);
      metrics.nodeP50.set({ node_id: id }, s.p50_ms);
      metrics.nodeStatus.set({ node_id: id, status: s.status }, statusToGaugeValue(s.status));
      totalQueue += s.queue_depth + s.queue_depth_image + s.queue_depth_video;
    }
    metrics.queueDepth.set(totalQueue);
  }

  // ── Inference ─────────────────────────────────────────────────────────────

  app.post("/v1/chat/completions", async (req, reply) => {
    await proxy.handleChat(req, reply);
  });

  app.get("/v1/models", async (_req, reply) => {
    const states = poller.getAllStates().filter((s) => s.status !== "unreachable");
    const modelSet = new Map<string, string[]>();

    for (const s of states) {
      for (const m of s.gpu?.loaded_models ?? []) {
        if (!modelSet.has(m.name)) modelSet.set(m.name, []);
        modelSet.get(m.name)!.push(s.config.id);
      }
    }

    const data = Array.from(modelSet.entries()).map(([id, nodes]) => ({
      id,
      object: "model",
      created: 0,
      owned_by: "fleet",
      nodes,
    }));

    return reply.send({ object: "list", data });
  });

  // ── Image / Video ─────────────────────────────────────────────────────────

  app.post("/v1/images/generations", async (req, reply) => {
    await proxy.handleImageGen(req, reply);
  });

  app.post("/v1/images/edits", async (req, reply) => {
    (req.body as Record<string, unknown>)["init_image"] = (req.body as Record<string, unknown>)["image"];
    await proxy.handleImageGen(req, reply);
  });

  app.post("/v1/video/generations", async (req, reply) => {
    await proxy.handleVideoGen(req, reply);
  });

  app.get("/v1/video/generations/:job_id", async (req, reply) => {
    await proxy.handleVideoJobStatus(req as FastifyRequest<{ Params: { job_id: string } }>, reply);
  });

  // ── Admin ─────────────────────────────────────────────────────────────────

  app.get("/admin/nodes", async (_req, reply) => {
    const states = poller.getAllStates();
    refreshNodeMetrics(states);
    return reply.send(states);
  });

  app.get("/admin/nodes/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const state = poller.getState(req.params.id);
    if (!state) return reply.status(404).send({ error: "node not found" });
    return reply.send(state);
  });

  app.put("/admin/nodes/:id/enable", async (
    req: FastifyRequest<{ Params: { id: string }; Body: { enabled: boolean } }>,
    reply,
  ) => {
    const state = poller.getState(req.params.id);
    if (!state) return reply.status(404).send({ error: "node not found" });
    state.config.enabled = req.body.enabled;
    return reply.send({ ok: true, id: req.params.id, enabled: req.body.enabled });
  });

  const draining = new Set<string>();

  app.post("/admin/nodes/:id/drain", async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => {
    const state = poller.getState(req.params.id);
    if (!state) return reply.status(404).send({ error: "node not found" });
    draining.add(req.params.id);
    state.config.enabled = false;
    return reply.send({ ok: true, draining: true });
  });

  app.delete("/admin/nodes/:id/drain", async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => {
    draining.delete(req.params.id);
    const state = poller.getState(req.params.id);
    if (state) state.config.enabled = true;
    return reply.send({ ok: true, draining: false });
  });

  app.get("/admin/stats", async (_req, reply) => {
    const states = poller.getAllStates();
    const decisions = router.getRecentDecisions();
    const total = states.reduce((a, s) => a + s.requests_total, 0);
    const ok = states.reduce((a, s) => a + s.requests_ok, 0);
    const err = states.reduce((a, s) => a + s.requests_err, 0);
    const queued = states.reduce((a, s) => a + s.queue_depth + s.queue_depth_image + s.queue_depth_video, 0);
    return reply.send({
      requests_total: total,
      requests_ok: ok,
      requests_err: err,
      requests_queued: queued,
      uptime_s: Math.floor((Date.now() - startTime) / 1000),
      nodes: states,
      recent_decisions: decisions,
      video_stats: proxy.getVideoBackendStats(),
    });
  });

  app.get("/admin/decisions", async (_req, reply) => {
    return reply.send(router.getRecentDecisions());
  });

  // ── Health ────────────────────────────────────────────────────────────────

  app.get("/healthz", async (_req, reply) => {
    const states = poller.getAllStates();
    const healthy = states.filter((s) => s.status === "healthy").length;
    return reply.send({
      status: "ok",
      uptime_s: Math.floor((Date.now() - startTime) / 1000),
      nodes_healthy: healthy,
      nodes_total: states.length,
    });
  });

  // ── Prometheus ────────────────────────────────────────────────────────────

  app.get("/metrics", async (_req, reply) => {
    refreshNodeMetrics(poller.getAllStates());
    const output = await metrics.register.metrics();
    return reply.header("Content-Type", metrics.register.contentType).send(output);
  });

  // ── WebSocket ─────────────────────────────────────────────────────────────

  app.get("/ws/dashboard", { websocket: true }, (socket) => {
    broadcaster.addClient(socket);
  });
}
