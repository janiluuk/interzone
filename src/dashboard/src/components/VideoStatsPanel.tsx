import type { VideoBackendStats } from "../../../types/index";

interface Props {
  stats: VideoBackendStats[];
}

function fmt(ms: number): string {
  if (ms === 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

const BACKEND_COLORS: Record<string, string> = {
  deforum: "#ff6b9d",
  svd: "#4fc3f7",
  ltx_video: "#a5d6a7",
  wan_video: "#f5a623",
  animate_lcm: "#7c6af7",
};

export function VideoStatsPanel({ stats }: Props) {
  if (stats.length === 0) return null;

  return (
    <div style={{
      background: "#0f1218",
      border: "1px solid #1e2530",
      borderRadius: 6,
      padding: 14,
      fontFamily: "monospace",
      fontSize: 11,
      color: "#c8cdd4",
    }}>
      <div style={{ color: "#5a6070", fontSize: 10, letterSpacing: 1, marginBottom: 10 }}>
        VIDEO JOB STATS
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {stats.map((s) => {
          const color = BACKEND_COLORS[s.backend] ?? "#5a6070";
          const successRate = s.jobs_total > 0
            ? Math.round((s.jobs_ok / s.jobs_total) * 100)
            : 0;
          return (
            <div key={s.backend} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  background: color + "22",
                  color,
                  border: `1px solid ${color}44`,
                  borderRadius: 3,
                  padding: "1px 6px",
                  fontSize: 10,
                  letterSpacing: 1,
                }}>
                  {s.backend.replace("_", "-").toUpperCase()}
                </span>
                <span style={{ color: "#5a6070" }}>{s.jobs_total} jobs</span>
                <span style={{ color: successRate === 100 ? "#00e5c8" : successRate > 80 ? "#f5a623" : "#ff3b47" }}>
                  {successRate}% ok
                </span>
                {s.jobs_failed > 0 && (
                  <span style={{ color: "#ff3b47" }}>{s.jobs_failed} failed</span>
                )}
              </div>
              {s.jobs_ok > 0 && (
                <div style={{ display: "flex", gap: 16, color: "#7a8090", paddingLeft: 4 }}>
                  <span>avg <span style={{ color: "#c8cdd4" }}>{fmt(s.duration_avg_ms)}</span></span>
                  <span>min <span style={{ color: "#00e5c8" }}>{fmt(s.duration_min_ms)}</span></span>
                  <span>max <span style={{ color: s.duration_max_ms > 300_000 ? "#f5a623" : "#c8cdd4" }}>{fmt(s.duration_max_ms)}</span></span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
