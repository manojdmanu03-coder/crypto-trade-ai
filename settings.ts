import { Router } from "express";
import { db } from "../db/index.js";
import { settingsTable } from "../db/index.js";
import { UpdateSettingsBody } from "../zod/schemas.js";
import { encrypt } from "../lib/crypto.js";
import { startEngine, stopEngine } from "../engine/trading-engine.js";

const router = Router();

async function getOrCreateSettings() {
  const rows = await db.select().from(settingsTable).limit(1);
  if (rows[0]) return rows[0];

  const [created] = await db
    .insert(settingsTable)
    .values({
      tradingMode: "paper",
      maxConcurrentPositions: 5,
      riskPerTrade: "1.0",
      scanIntervalSeconds: 30,
      defaultOrderType: "market",
      stopLossPercent: "2.0",
    })
    .returning();
  return created;
}

router.get("/", async (req, res) => {
  try {
    const s = await getOrCreateSettings();
    res.json({
      tradingMode: s.tradingMode,
      apiKeySet: !!(s.encryptedApiKey && s.encryptedApiSecret),
      maxConcurrentPositions: s.maxConcurrentPositions,
      riskPerTrade: parseFloat(s.riskPerTrade as string),
      watchedSymbols: (s.watchedSymbols as string[]) ?? [
        "BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","ADAUSDT",
        "DOTUSDT","MATICUSDT","AVAXUSDT","LINKUSDT","UNIUSDT",
      ],
      scanIntervalSeconds: s.scanIntervalSeconds,
      defaultOrderType: s.defaultOrderType,
      stopLossPercent: parseFloat(s.stopLossPercent as string),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch settings");
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/", async (req, res) => {
  try {
    const body = UpdateSettingsBody.parse(req.body);
    const existing = await getOrCreateSettings();

    const updateData: Partial<typeof settingsTable.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (body.tradingMode !== undefined) updateData.tradingMode = body.tradingMode;
    if (body.maxConcurrentPositions !== undefined) updateData.maxConcurrentPositions = body.maxConcurrentPositions;
    if (body.riskPerTrade !== undefined) updateData.riskPerTrade = body.riskPerTrade.toString();
    if (body.watchedSymbols !== undefined) updateData.watchedSymbols = body.watchedSymbols;
    if (body.scanIntervalSeconds !== undefined) updateData.scanIntervalSeconds = body.scanIntervalSeconds;
    if (body.defaultOrderType !== undefined) updateData.defaultOrderType = body.defaultOrderType;
    if (body.stopLossPercent !== undefined) updateData.stopLossPercent = body.stopLossPercent.toString();

    if (body.apiKey && body.apiSecret) {
      updateData.encryptedApiKey = encrypt(body.apiKey);
      updateData.encryptedApiSecret = encrypt(body.apiSecret);
    }

    const { eq } = await import("../db/index.js");
    const [updated] = await db
      .update(settingsTable)
      .set(updateData)
      .where(eq(settingsTable.id, existing.id))
      .returning();

    res.json({
      tradingMode: updated.tradingMode,
      apiKeySet: !!(updated.encryptedApiKey && updated.encryptedApiSecret),
      maxConcurrentPositions: updated.maxConcurrentPositions,
      riskPerTrade: parseFloat(updated.riskPerTrade as string),
      watchedSymbols: (updated.watchedSymbols as string[]),
      scanIntervalSeconds: updated.scanIntervalSeconds,
      defaultOrderType: updated.defaultOrderType,
      stopLossPercent: parseFloat(updated.stopLossPercent as string),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update settings");
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
