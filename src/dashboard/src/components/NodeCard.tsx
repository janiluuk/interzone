import { GpuGauge } from "./GpuGauge";
import type { NodeState } from "../../../types/index";

interface Props {
  node: NodeState;
}

const BACKEND_COLORS: Record<string, string> = {
  ollama: "#00e5c8",
  localai: "#7c6af7",
  sd_forge: "#f5a623",
  swarmui: "#e06cff",
  deforum: "#ff6b9d",
};

const TIER_LABELS: Record<number, string> = { 1: "T1", 2: "T2", 3: "T3" };

function Bar({ pct, color = "#00e5c8" }: { pct: number; color?: string }) {
  return (
    <div style={{ background: "#111620", borderRadius: 2, height: 4, width: "100%", overflow: "hidden" }}>
      <div
        style={{
          background: color,
          width: `${Math.min(100, pct)}%`,
          height: "100%",
          transition: "width 0.4s ease",
        }}
      />
    </div>
  );
}

function tempColor(c: number): string {
  if (c > 80) return "#ff3b47";
  if (c > 70) return "#f5a623";
  return "#00e5c8";
}

function na(v: number | undefined, digits = 0): string {
  if (v === undefined || v === null) return "n/a";
  return v.toFixed(digits);
}

export function NodeCard({ node }: Props) {
  const { config, status, gpu, system, score, queue_depth, queue_depth_image, p50_ms, p95_ms,
    requests_total, requests_ok, requests_err, ping_ms } = node;

  const statusColor = status === "healthy" ? "#00e5c8"
    : status === "degraded" ? "#f5a623"
    : status === "unreachable" ? "#ff3b47"
    : "#5a6070";

  const backendColor = BACKEND_COLORS[config.backend] ?? "#5a6070";

  return (
    <div style={{
      background: "#0f1218",
      border: `1px solid ${status === "unreachable" ? "#ff3b47" : "#1e2530"}`,
      borderRadius: 6,
      padding: 14,
      minWidth: 300,
      fontFamily: "monospace",
      fontSize: 12,
      color: "#c8cdd4",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Status dot */}
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: statusColor,
          boxShadow: status === "healthy" ? `0 0 6px ${statusColor}` : "none",
          display: "inline-block",
          flexShrink: 0,
        }} />
        <span style={{ flex: 1, fontWeight: "bold", color: "#e0e5ec", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {config.label}
        </span>
        <span style={{
          background: backendColor + "22",
          color: backendColor,
          border: `1px solid ${backendColor}44`,
          borderRadius: 3, padding: "1px 6px", fontSize: 10, letterSpacing: 1,
        }}>
          {config.backend.toUpperCase()}
        </span>
        <span style={{
          background: "#1a2030",
          color: "#7a8090",
          border: "1px solid #2a3040",
          borderRadius: 3, padding: "1px 5px", fontSize: 10,
        }}>
          {TIER_LABELS[config.tier] ?? "T?"}
        </span>
      </div>

      {/* Score row */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: "bold", color: "#00e5c8", lineHeight: 1 }}>
          {Math.round(score)}
        </span>
        <span style={{ color: "#5a6070", fontSize: 11 }}>score</span>
        <span style={{ marginLeft: "auto", color: "#5a6070" }}>ping {ping_ms}ms</span>
      </div>

      {/* GPU gauges */}
      {gpu ? (
        <div>
          <div style={{ color: "#5a6070", fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>GPU</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <GpuGauge value={gpu.utilization_pct} label="COMPUTE" />
            <GpuGauge
              value={gpu.memory_total_mb > 0 ? (gpu.memory_used_mb / gpu.memory_total_mb) * 100 : 0}
              label="VRAM"
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
              <span style={{ color: tempColor(gpu.temperature_c) }}>
                {gpu.temperature_c > 0 ? `${gpu.temperature_c.toFixed(0)}°C` : "—"}
              </span>
              <span style={{ color: "#5a6070" }}>
                {gpu.power_draw_w > 0 ? `${gpu.power_draw_w.toFixed(0)}W` : "—"}
                {gpu.power_limit_w > 0 ? ` / ${gpu.power_limit_w.toFixed(0)}W` : ""}
              </span>
              <span style={{ color: "#7a8090" }}>
                {(gpu.memory_free_mb / 1024).toFixed(1)} GB free
              </span>
            </div>
          </div>
          {/* Loaded models */}
          {gpu.loaded_models.length > 0 && (
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 3 }}>
              {gpu.loaded_models.map((m) => (
                <span key={m.name} style={{
                  background: "#1a2030",
                  border: "1px solid #2a3040",
                  borderRadius: 3, padding: "1px 5px", fontSize: 10,
                  color: m.processor === "gpu" ? "#00e5c8" : "#7a8090",
                  maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {m.name}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: "#5a6070", fontSize: 11 }}>No GPU metrics</div>
      )}

      {/* System row */}
      {system ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ color: "#5a6070", fontSize: 10, letterSpacing: 1 }}>SYSTEM</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 30, color: "#5a6070" }}>CPU</span>
            <Bar pct={system.cpu_pct} color="#00e5c8" />
            <span style={{ width: 36, textAlign: "right" }}>{system.cpu_pct.toFixed(0)}%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 30, color: "#5a6070" }}>RAM</span>
            <Bar pct={system.mem_pct} color={system.mem_pct > 90 ? "#ff3b47" : "#00e5c8"} />
            <span style={{ width: 36, textAlign: "right" }}>{system.mem_pct.toFixed(0)}%</span>
          </div>
          <div style={{ display: "flex", gap: 12, color: "#7a8090", fontSize: 10 }}>
            <span>↓ {system.disk_read_mb_s.toFixed(1)} MB/s</span>
            <span>↑ {system.disk_write_mb_s.toFixed(1)} MB/s</span>
            <span>rx {system.net_rx_mb_s.toFixed(1)}</span>
            <span>tx {system.net_tx_mb_s.toFixed(1)}</span>
          </div>
        </div>
      ) : (
        <div style={{ color: "#5a6070", fontSize: 11 }}>System metrics n/a</div>
      )}

      {/* Queue + latency */}
      <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
        <span>queue <span style={{ color: queue_depth > 0 ? "#f5a623" : "#00e5c8" }}>{queue_depth}</span></span>
        {queue_depth_image > 0 && <span>img <span style={{ color: "#f5a623" }}>{queue_depth_image}</span></span>}
        <span style={{ color: "#5a6070" }}>p50 {na(p50_ms, 0)}ms · p95 {na(p95_ms, 0)}ms</span>
      </div>

      {/* Request counters */}
      <div style={{ display: "flex", gap: 10, fontSize: 11, color: "#5a6070" }}>
        <span>total {requests_total}</span>
        <span style={{ color: "#00e5c8" }}>ok {requests_ok}</span>
        {requests_err > 0 && <span style={{ color: "#ff3b47" }}>err {requests_err}</span>}
      </div>
    </div>
  );
}
