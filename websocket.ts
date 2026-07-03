import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage, Server } from "http";
import { logger } from "./logger.js";

const BASE_PRICES: Record<string, number> = {
  BTCUSDT: 67500,
  ETHUSDT: 3520,
  SOLUSDT: 175,
  BNBUSDT: 598,
  ADAUSDT: 0.52,
  DOTUSDT: 8.4,
  MATICUSDT: 0.88,
  AVAXUSDT: 38.5,
  LINKUSDT: 18.2,
  UNIUSDT: 10.6,
};

const livePrices: Record<string, number> = { ...BASE_PRICES };

let wss: WebSocketServer | null = null;
let broadcastInterval: ReturnType<typeof setInterval> | null = null;

const MAX_DRIFT_PCT = 0.03;

function jitter(symbol: string, price: number): number {
  const base = BASE_PRICES[symbol] ?? price;
  const pct = (Math.random() - 0.5) * 0.003;
  const next = price * (1 + pct);
  const clamped = Math.max(base * (1 - MAX_DRIFT_PCT), Math.min(base * (1 + MAX_DRIFT_PCT), next));
  return parseFloat(clamped.toFixed(price < 1 ? 6 : price < 100 ? 4 : 2));
}

function broadcast(wss: WebSocketServer) {
  for (const symbol of Object.keys(livePrices)) {
    livePrices[symbol] = jitter(symbol, livePrices[symbol]);
  }

  const message = JSON.stringify({
    type: "prices",
    data: livePrices,
    timestamp: new Date().toISOString(),
  });

  let clients = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      clients++;
    }
  });

  if (clients > 0) {
    logger.debug({ clients, symbols: Object.keys(livePrices).length }, "WS price broadcast");
  }
}

export function attachWebSocketServer(server: Server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    logger.info({ ip: req.socket.remoteAddress }, "WebSocket client connected");

    ws.send(
      JSON.stringify({
        type: "prices",
        data: livePrices,
        timestamp: new Date().toISOString(),
      })
    );

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string };
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignore invalid messages
      }
    });

    ws.on("close", () => {
      logger.info("WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
    });
  });

  broadcastInterval = setInterval(() => broadcast(wss!), 1000);

  logger.info("WebSocket server attached at /ws");
}

export function getLivePrices(): Record<string, number> {
  return { ...livePrices };
}
