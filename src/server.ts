import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyWS from "@fastify/websocket";
import path from "path";
import { fileURLToPath } from "url";
import { FLEET } from "./config/fleet.js";
import { NodePoller } from "./poller/NodePoller.js";
import { Router } from "./router/Router.js";
import { Proxy } from "./proxy/Proxy.js";
import { DashboardBroadcaster } from "./ws/DashboardBroadcaster.js";
import { registerRoutes, buildMetrics } from "./api/routes.js";
import type { NodeState, NodeStatus, DispatcherStats } from "./types/index.js";
import { scoreNode } from "./router/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT ?? "4242");
const HOST = process.env.HOST ?? "0.0.0.0";
const DASHBOARD_DIST = path.join(__dirname, "../dist/dashboard");

// Apply DISABLED_NODES env override
const disabledIds = (process.env.DISABLED_NODES ?? "vimage-cpu").split(",").map((s) => s.trim()).filter(Boolean);
for (const node of FLEET) {
  if (disabledIds.includes(node.id)) node.enabled = false;
}

const app = Fastify({ logger: { level: "info" } });

const metrics = buildMetrics();

// Poller
const poller = new NodePoller(
  FLEET,
  (state: NodeState) => {
    // Recompute score on every update
    state.score = scoreNode(state);
    broadcaster.broadcastDecision; // keep ref
  },
  (id: string, status: NodeStatus, prev: NodeStatus) => {
    broadcaster.broadcastStatusChange(id, status, prev);
    app.log.info({ node: id, status, prev }, "node status change");
  },
);

const router = new Router(poller, (decision) => {
  broadcaster.broadcastDecision(decision);
  metrics.routingDecisions.inc({
    task_type: decision.task_type,
    selected_node: decision.selected_node,
    tier: String(poller.getState(decision.selected_node)?.config.tier ?? 0),
  });
});

const proxy = new Proxy(router, poller);

const broadcaster = new DashboardBroadcaster((): DispatcherStats => {
  const states = poller.getAllStates();
  return {
    requests_total: states.reduce((a, s) => a + s.requests_total, 0),
    requests_ok: states.reduce((a, s) => a + s.requests_ok, 0),
    requests_err: states.reduce((a, s) => a + s.requests_err, 0),
    requests_queued: states.reduce((a, s) => a + s.queue_depth + s.queue_depth_image + s.queue_depth_video, 0),
    uptime_s: Math.floor((Date.now() - startMs) / 1000),
    nodes: states,
    recent_decisions: router.getRecentDecisions(),
  };
});

const startMs = Date.now();

async function main() {
  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWS);

  // Serve dashboard SPA
  try {
    await app.register(fastifyStatic, {
      root: DASHBOARD_DIST,
      prefix: "/dashboard",
    });
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile("index.html", DASHBOARD_DIST);
    });
  } catch {
    app.log.warn("Dashboard dist not found — run npm run build:dashboard first");
  }

  await registerRoutes(app, proxy, poller, router, broadcaster, metrics);

  poller.start();
  broadcaster.start();

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Dispatcher running on ${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
