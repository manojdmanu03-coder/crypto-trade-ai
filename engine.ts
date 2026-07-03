import { Router } from "express";
import { db } from "../db/index.js";
import { engineLogsTable, settingsTable } from "../db/index.js";
import { desc } from "../db/index.js";
import { ToggleEngineBody } from "../zod/schemas.js";
import { startEngine, stopEngine, getEngineState } from "../engine/trading-engine.js";

const router = Router();

router.get("/status", async (req, res) => {
  try {
    const state = getEngineState();
    const settings = await db.select().from(settingsTable).limit(1);
    const mode = settings[0]?.tradingMode ?? "paper";

    const logs = await db
      .select()
      .from(engineLogsTable)
      .orderBy(desc(engineLogsTable.createdAt))
      .limit(50);

    res.json({
      isRunning: state.isRunning,
      mode,
      lastScanAt: state.lastScanAt ? state.lastScanAt.toISOString() : null,
      nextScanIn: state.nextScanIn,
      totalScans: state.totalScans,
      logs: logs.reverse().map((l) => ({
        timestamp: l.createdAt.toISOString(),
        level: l.level,
        message: l.message,
        symbol: l.symbol,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch engine status");
    res.status(500).json({ error: "Failed to fetch engine status" });
  }
});

router.post("/toggle", async (req, res) => {
  try {
    const body = ToggleEngineBody.parse(req.body);
    const settings = await db.select().from(settingsTable).limit(1);
    const intervalSeconds = settings[0]?.scanIntervalSeconds ?? 30;
    const mode = settings[0]?.tradingMode ?? "paper";

    if (body.running) {
      startEngine(intervalSeconds);
    } else {
      stopEngine();
    }

    const state = getEngineState();
    const logs = await db
      .select()
      .from(engineLogsTable)
      .orderBy(desc(engineLogsTable.createdAt))
      .limit(20);

    res.json({
      isRunning: state.isRunning,
      mode,
      lastScanAt: state.lastScanAt ? state.lastScanAt.toISOString() : null,
      nextScanIn: state.nextScanIn,
      totalScans: state.totalScans,
      logs: logs.reverse().map((l) => ({
        timestamp: l.createdAt.toISOString(),
        level: l.level,
        message: l.message,
        symbol: l.symbol,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to toggle engine");
    res.status(500).json({ error: "Failed to toggle engine" });
  }
});

export default router;
