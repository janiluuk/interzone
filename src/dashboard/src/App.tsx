import { useDispatcherWS } from "./hooks/useDispatcherWS";
import { NodeCard } from "./components/NodeCard";
import { RouteLog } from "./components/RouteLog";
import { ThroughputChart } from "./components/ThroughputChart";
import { FleetTopology } from "./components/FleetTopology";

const CSS = `
  :root {
    --bg: #0a0c0f;
    --bg1: #0f1218;
    --border: #1e2530;
    --cyan: #00e5c8;
    --amber: #f5a623;
    --red: #ff3b47;
    --muted: #5a6070;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: #c8cdd4; font-family: 'JetBrains Mono', 'Courier New', monospace; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
`;

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function App() {
  const { state, decisions, connected } = useDispatcherWS();

  const uptimeStr = state
    ? `${Math.floor(state.uptime_s / 3600)}h ${Math.floor((state.uptime_s % 3600) / 60)}m`
    : "—";

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <header style={{
          background: "#0b0e14",
          borderBottom: "1px solid #1e2530",
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}>
          <span style={{ fontWeight: "bold", fontSize: 15, letterSpacing: 2, color: "#00e5c8" }}>
            INTERZONE DISPATCHER
          </span>
          <span style={{ color: "#5a6070", fontSize: 11 }}>uptime {uptimeStr}</span>
          <span style={{ color: "#7a8090", fontSize: 11 }}>
            req {fmt(state?.requests_total ?? 0)} / ok {fmt(state?.requests_ok ?? 0)}
          </span>
          {(state?.requests_err ?? 0) > 0 && (
            <span style={{ color: "#ff3b47", fontSize: 11 }}>err {fmt(state!.requests_err)}</span>
          )}
          <span style={{ marginLeft: "auto", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: connected ? "#00e5c8" : "#ff3b47",
              boxShadow: connected ? "0 0 6px #00e5c8" : "none",
              display: "inline-block",
            }} />
            {connected ? "LIVE" : "DISCONNECTED"}
          </span>
        </header>

        {/* Top section: topology + throughput */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "340px 1fr",
          gap: 16,
          padding: 16,
          borderBottom: "1px solid #1e2530",
        }}>
          <FleetTopology stats={state} decisions={decisions} />
          <ThroughputChart stats={state} />
        </div>

        {/* Node cards grid */}
        <div style={{
          padding: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 12,
          flex: 1,
        }}>
          {state?.nodes.map((node) => (
            <NodeCard key={node.config.id} node={node} />
          ))}
          {!state && (
            <div style={{ color: "#5a6070", padding: 40, gridColumn: "1/-1", textAlign: "center" }}>
              Connecting to dispatcher…
            </div>
          )}
        </div>

        {/* Route log footer */}
        <div style={{ padding: "0 16px 16px" }}>
          <RouteLog decisions={decisions} />
        </div>
      </div>
    </>
  );
}
