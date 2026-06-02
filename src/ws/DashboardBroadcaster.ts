import type { WebSocket } from "@fastify/websocket";
import type { DispatcherStats, RoutingDecision, WSMessage, NodeStatus } from "../types/index.js";

const WS_INTERVAL_MS = parseInt(process.env.WS_BROADCAST_INTERVAL_MS ?? "2000");

export class DashboardBroadcaster {
  private clients: Set<WebSocket> = new Set();
  private interval?: ReturnType<typeof setInterval>;

  constructor(private getStats: () => DispatcherStats) {}

  start(): void {
    this.interval = setInterval(() => this.broadcastSnapshot(), WS_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    // Send immediate snapshot on connect
    const msg: WSMessage = { type: "state_snapshot", data: this.getStats() };
    ws.send(JSON.stringify(msg));

    ws.on("close", () => this.clients.delete(ws));
    ws.on("error", () => this.clients.delete(ws));
  }

  broadcastDecision(decision: RoutingDecision): void {
    const msg: WSMessage = { type: "routing_decision", data: decision };
    this.broadcast(msg);
  }

  broadcastStatusChange(id: string, status: NodeStatus, prev: NodeStatus): void {
    const msg: WSMessage = { type: "node_status_change", data: { id, status, prev } };
    this.broadcast(msg);
  }

  private broadcastSnapshot(): void {
    const msg: WSMessage = { type: "state_snapshot", data: this.getStats() };
    this.broadcast(msg);
  }

  private broadcast(msg: WSMessage): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.clients) {
      try {
        if (ws.readyState === ws.OPEN) ws.send(payload);
      } catch {
        this.clients.delete(ws);
      }
    }
  }
}
