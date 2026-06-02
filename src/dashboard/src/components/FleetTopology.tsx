import { useEffect, useRef, useState } from "react";
import type { DispatcherStats, RoutingDecision } from "../../../types/index";

interface Props {
  stats: DispatcherStats | null;
  decisions: RoutingDecision[];
}

interface Packet {
  nodeId: string;
  progress: number; // 0→1
  id: string;
}

const STATUS_COLORS: Record<string, string> = {
  healthy: "#00e5c8",
  degraded: "#f5a623",
  unreachable: "#ff3b47",
  unknown: "#3a4050",
};

export function FleetTopology({ stats, decisions }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const packetsRef = useRef<Packet[]>([]);
  const animRef = useRef<number>(0);
  const lastDecisionId = useRef<string>("");
  const [, forceRender] = useState(0);

  // Spawn a packet when a new decision arrives
  useEffect(() => {
    const latest = decisions[0];
    if (!latest || latest.id === lastDecisionId.current) return;
    lastDecisionId.current = latest.id;
    packetsRef.current.push({ nodeId: latest.selected_node, progress: 0, id: latest.id });
  }, [decisions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let lastTime = 0;

    function draw(ts: number) {
      if (!canvas || !stats) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext("2d")!;
      const W = canvas.width;
      const H = canvas.height;
      const dt = Math.min(50, ts - lastTime) / 1000;
      lastTime = ts;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0a0c0f";
      ctx.fillRect(0, 0, W, H);

      // Dispatcher center
      const cx = W / 2;
      const cy = H / 2;

      const nodes = stats.nodes;
      const nodePositions: Record<string, { x: number; y: number }> = {};
      const radius = Math.min(cx, cy) * 0.75;

      nodes.forEach((node, i) => {
        const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
        nodePositions[node.config.id] = {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        };
      });

      // Draw lines
      for (const node of nodes) {
        const pos = nodePositions[node.config.id];
        const color = STATUS_COLORS[node.status] ?? "#3a4050";
        ctx.strokeStyle = color + "44";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }

      // Draw packets
      packetsRef.current = packetsRef.current.filter((p) => p.progress <= 1);
      for (const pkt of packetsRef.current) {
        const pos = nodePositions[pkt.nodeId];
        if (!pos) continue;
        const px = cx + (pos.x - cx) * pkt.progress;
        const py = cy + (pos.y - cy) * pkt.progress;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#00e5c8";
        ctx.fill();
        pkt.progress += dt * 1.5;
      }

      // Draw dispatcher center
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.fillStyle = "#0f1218";
      ctx.fill();
      ctx.strokeStyle = "#00e5c8";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#00e5c8";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("IZ", cx, cy);

      // Draw nodes
      for (const node of nodes) {
        const pos = nodePositions[node.config.id];
        const color = STATUS_COLORS[node.status] ?? "#3a4050";
        const tierRadius = 12 + (3 - node.config.tier) * 2;

        // Tier ring
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, tierRadius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = color + "33";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Node circle
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, tierRadius, 0, Math.PI * 2);
        ctx.fillStyle = "#0f1218";
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.fillStyle = color;
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const shortId = node.config.id.replace(/^vimage\d+-/, "").replace("win-", "w-").slice(0, 6);
        ctx.fillText(shortId, pos.x, pos.y);

        // Score below node
        ctx.fillStyle = "#5a6070";
        ctx.font = "9px monospace";
        ctx.fillText(String(Math.round(node.score)), pos.x, pos.y + tierRadius + 9);
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [stats]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ color: "#5a6070", fontSize: 10, letterSpacing: 1, fontFamily: "monospace" }}>
        FLEET TOPOLOGY
      </div>
      <canvas
        ref={canvasRef}
        width={340}
        height={260}
        style={{ width: "100%", border: "1px solid #1e2530", borderRadius: 4 }}
      />
    </div>
  );
}
