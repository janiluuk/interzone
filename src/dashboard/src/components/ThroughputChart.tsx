import { useEffect, useRef, useState } from "react";
import type { DispatcherStats } from "../../../types/index";

interface Props {
  stats: DispatcherStats | null;
}

const WINDOW_S = 120;
const RESOLUTION_S = 2;
const POINTS = WINDOW_S / RESOLUTION_S;

const NODE_COLORS = [
  "#00e5c8", "#f5a623", "#7c6af7", "#ff6b9d", "#e06cff",
  "#4fc3f7", "#ff7043", "#a5d6a7",
];

interface DataPoint {
  ts: number;
  counts: Record<string, number>;
}

export function ThroughputChart({ stats }: Props) {
  const historyRef = useRef<DataPoint[]>([]);
  const prevTotals = useRef<Record<string, number>>({});
  const [history, setHistory] = useState<DataPoint[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!stats) return;
    const now = Date.now();
    const counts: Record<string, number> = {};

    for (const node of stats.nodes) {
      const prev = prevTotals.current[node.config.id] ?? node.requests_total;
      counts[node.config.id] = Math.max(0, node.requests_total - prev) / RESOLUTION_S;
      prevTotals.current[node.config.id] = node.requests_total;
    }

    historyRef.current.push({ ts: now, counts });
    const cutoff = now - WINDOW_S * 1000;
    historyRef.current = historyRef.current.filter((p) => p.ts >= cutoff).slice(-POINTS);
    setHistory([...historyRef.current]);
  }, [stats]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length === 0 || !stats) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#0a0c0f";
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = "#1a1e26";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (H * i) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    const nodeIds = stats.nodes.map((n) => n.config.id);
    const allVals = history.flatMap((p) => Object.values(p.counts));
    const maxVal = Math.max(1, ...allVals);

    nodeIds.forEach((id, colorIdx) => {
      const color = NODE_COLORS[colorIdx % NODE_COLORS.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      history.forEach((point, i) => {
        const x = (i / Math.max(1, history.length - 1)) * W;
        const val = point.counts[id] ?? 0;
        const y = H - (val / maxVal) * (H - 10) - 5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }, [history, stats]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ color: "#5a6070", fontSize: 10, letterSpacing: 1, fontFamily: "monospace" }}>
        THROUGHPUT (req/s, 2min window)
      </div>
      <canvas
        ref={canvasRef}
        width={500}
        height={120}
        style={{ width: "100%", height: 120, border: "1px solid #1e2530", borderRadius: 4 }}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontFamily: "monospace", fontSize: 10 }}>
        {stats?.nodes.map((n, i) => (
          <span key={n.config.id} style={{ color: NODE_COLORS[i % NODE_COLORS.length], display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 12, height: 2, background: NODE_COLORS[i % NODE_COLORS.length] }} />
            {n.config.id}
          </span>
        ))}
      </div>
    </div>
  );
}
