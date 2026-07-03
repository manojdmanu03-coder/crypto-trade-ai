import { Router } from "express";
import { db } from "../db/index.js";
import { signalsTable } from "../db/index.js";
import { eq, desc } from "../db/index.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const signals = await db
      .select()
      .from(signalsTable)
      .orderBy(desc(signalsTable.createdAt))
      .limit(50);

    const seen = new Set<string>();
    const latest = signals
      .filter((s) => {
        if (seen.has(s.symbol)) return false;
        seen.add(s.symbol);
        return true;
      })
      .map((s) => ({
        id: s.id,
        symbol: s.symbol,
        action: s.action,
        confidence: parseFloat(s.confidence as string),
        reasoning: s.reasoning,
        rsi: parseFloat(s.rsi as string ?? "50"),
        ema20: parseFloat(s.ema20 as string ?? "0"),
        ema50: parseFloat(s.ema50 as string ?? "0"),
        ema200: parseFloat(s.ema200 as string ?? "0"),
        macdLine: parseFloat(s.macdLine as string ?? "0"),
        macdSignal: parseFloat(s.macdSignal as string ?? "0"),
        supertrend: s.supertrend,
        price: parseFloat(s.price as string),
        createdAt: s.createdAt.toISOString(),
      }));

    res.json(latest);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch signals");
    res.status(500).json({ error: "Failed to fetch signals" });
  }
});

router.get("/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const rows = await db
      .select()
      .from(signalsTable)
      .where(eq(signalsTable.symbol, symbol))
      .orderBy(desc(signalsTable.createdAt))
      .limit(1);

    if (!rows[0]) {
      return res.status(404).json({ error: "No signal found for symbol" });
    }

    const s = rows[0];
    res.json({
      id: s.id,
      symbol: s.symbol,
      action: s.action,
      confidence: parseFloat(s.confidence as string),
      reasoning: s.reasoning,
      rsi: parseFloat(s.rsi as string ?? "50"),
      ema20: parseFloat(s.ema20 as string ?? "0"),
      ema50: parseFloat(s.ema50 as string ?? "0"),
      ema200: parseFloat(s.ema200 as string ?? "0"),
      macdLine: parseFloat(s.macdLine as string ?? "0"),
      macdSignal: parseFloat(s.macdSignal as string ?? "0"),
      supertrend: s.supertrend,
      price: parseFloat(s.price as string),
      createdAt: s.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch signal for symbol");
    res.status(500).json({ error: "Failed to fetch signal" });
  }
});

export default router;
