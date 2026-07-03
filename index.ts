import { createServer } from "http";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { attachWebSocketServer } from "./lib/websocket.js";

const rawPort = process.env["PORT"] ?? "3001";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
attachWebSocketServer(server);

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});
