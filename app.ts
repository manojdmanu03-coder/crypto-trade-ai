import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production, serve the built trading-dashboard static files from the
// same server so the whole app can run as a single process/port. During
// local development the dashboard runs on its own Vite dev server instead
// (see trading-dashboard/vite.config.ts's proxy config) and this block is
// simply skipped because the folder won't exist yet.
const clientDist = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../trading-dashboard/dist/public",
);

if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

export default app;
