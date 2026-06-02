import { useEffect, useRef, useState } from "react";
import type { DispatcherStats, RoutingDecision, WSMessage } from "../../../types/index";

const MAX_DECISIONS = 100;

export function useDispatcherWS() {
  const [state, setState] = useState<DispatcherStats | null>(null);
  const [decisions, setDecisions] = useState<RoutingDecision[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryDelay = useRef(1000);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws/dashboard`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryDelay.current = 1000;
      };

      ws.onclose = () => {
        setConnected(false);
        retryTimer.current = setTimeout(() => {
          retryDelay.current = Math.min(retryDelay.current * 2, 30000);
          connect();
        }, retryDelay.current);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as WSMessage;
          if (msg.type === "state_snapshot") {
            setState(msg.data);
          } else if (msg.type === "routing_decision") {
            setDecisions((prev) => {
              const next = [msg.data, ...prev];
              return next.slice(0, MAX_DECISIONS);
            });
          }
        } catch { /* ignore malformed */ }
      };
    }

    connect();

    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, []);

  return { state, decisions, connected };
}
