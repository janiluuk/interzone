import { useRef, useState } from "react";
import type { RoutingDecision } from "../../../types/index";

interface Props {
  decisions: RoutingDecision[];
}

const TASK_COLORS: Record<string, string> = {
  classify: "#7c6af7",
  parse_agreement: "#f5a623",
  generic: "#5a6070",
  txt2img: "#e06cff",
  img2img: "#e06cff",
  txt2video: "#ff6b9d",
};

function relTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

export function RouteLog({ decisions }: Props) {
  const [paused, setPaused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <div
      style={{
        background: "#0a0c0f",
        border: "1px solid #1e2530",
        borderRadius: 6,
        padding: 12,
        fontFamily: "monospace",
        fontSize: 11,
        color: "#c8cdd4",
        height: 220,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ color: "#5a6070", letterSpacing: 1, fontSize: 10 }}>ROUTE LOG</span>
        <span style={{ color: "#5a6070" }}>({decisions.length})</span>
        <button
          onClick={() => setPaused((p) => !p)}
          style={{
            marginLeft: "auto", background: "none", border: "1px solid #2a3040",
            color: paused ? "#f5a623" : "#5a6070", cursor: "pointer",
            borderRadius: 3, padding: "1px 6px", fontSize: 10, fontFamily: "monospace",
          }}
        >
          {paused ? "RESUME" : "PAUSE"}
        </button>
      </div>
      <div
        ref={listRef}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 3 }}
      >
        {decisions.map((d) => (
          <div
            key={d.id}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "baseline",
              padding: "2px 0",
              borderBottom: "1px solid #111620",
              color: d.success === false ? "#ff3b47" : d.success === true ? "#c8cdd4" : "#7a8090",
            }}
          >
            <span style={{ color: "#3a4050", flexShrink: 0 }}>{relTime(d.ts)}</span>
            <span style={{
              background: (TASK_COLORS[d.task_type] ?? "#5a6070") + "22",
              color: TASK_COLORS[d.task_type] ?? "#5a6070",
              border: `1px solid ${(TASK_COLORS[d.task_type] ?? "#5a6070")}44`,
              borderRadius: 2, padding: "0 4px", fontSize: 9, letterSpacing: 1, flexShrink: 0,
            }}>
              {d.task_type.toUpperCase()}
            </span>
            <span style={{ color: "#00e5c8", flexShrink: 0 }}>→ {d.selected_node}</span>
            <span style={{ color: "#5a6070", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {d.reason}
            </span>
            {d.latency_ms !== undefined && (
              <span style={{ flexShrink: 0, color: "#7a8090" }}>{d.latency_ms}ms</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
