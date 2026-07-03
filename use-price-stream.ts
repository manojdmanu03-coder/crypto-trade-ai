import { useState, useEffect, useRef, useCallback } from "react";

export type LivePrices = Record<string, number>;

interface PriceMessage {
  type: "prices" | "pong";
  data?: LivePrices;
  timestamp?: string;
}

interface UsePriceStreamResult {
  prices: LivePrices;
  connected: boolean;
  lastUpdated: Date | null;
}

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;

export function usePriceStream(): UsePriceStreamResult {
  const [prices, setPrices] = useState<LivePrices>({});
  const [connected, setConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        reconnectAttempts.current = 0;
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data) as PriceMessage;
          if (msg.type === "prices" && msg.data) {
            setPrices(msg.data);
            setLastUpdated(new Date());
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        wsRef.current = null;

        if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts.current++;
          const delay = RECONNECT_DELAY_MS * Math.min(reconnectAttempts.current, 5);
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket not available (SSR or restricted env), silently skip
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);

    return () => {
      mountedRef.current = false;
      clearInterval(pingInterval);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return { prices, connected, lastUpdated };
}
