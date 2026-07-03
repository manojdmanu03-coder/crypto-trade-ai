import { Router } from "express";
import { db } from "../db/index.js";
import { tradesTable, positionsTable, settingsTable } from "../db/index.js";
import { eq, desc } from "../db/index.js";
import { ExecuteTradeBody } from "../zod/schemas.js";
import { checkRisk } from "../engine/risk-manager.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const trades = await db
      .select()
      .from(tradesTable)
      .orderBy(desc(tradesTable.createdAt))
      .limit(100);

    res.json(
      trades.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        orderType: t.orderType,
        quantity: parseFloat(t.quantity as string),
        price: parseFloat(t.price as string),
        totalValue: parseFloat(t.totalValue as string),
        status: t.status,
        pnl: t.pnl !== null ? parseFloat(t.pnl as string) : null,
        pnlPercent: t.pnlPercent !== null ? parseFloat(t.pnlPercent as string) : null,
        mode: t.mode,
        exchangeOrderId: t.exchangeOrderId,
        createdAt: t.createdAt.toISOString(),
        filledAt: t.filledAt ? t.filledAt.toISOString() : null,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to fetch trades");
    res.status(500).json({ error: "Failed to fetch trades" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = ExecuteTradeBody.parse(req.body);
    const settings = await db.select().from(settingsTable).limit(1);
    const mode = settings[0]?.tradingMode ?? "paper";

    const openPositions = await db
      .select()
      .from(positionsTable)
      .where(eq(positionsTable.isOpen, true));

    const MOCK_PRICES: Record<string, number> = {
      BTCUSDT: 67500, ETHUSDT: 3520, SOLUSDT: 175, BNBUSDT: 598,
      ADAUSDT: 0.52, DOTUSDT: 8.4, MATICUSDT: 0.88, AVAXUSDT: 38.5,
      LINKUSDT: 18.2, UNIUSDT: 10.6,
    };
    const price = body.price ?? MOCK_PRICES[body.symbol.toUpperCase()] ?? 100;

    if (body.side === "buy") {
      const risk = checkRisk({
        symbol: body.symbol,
        side: "buy",
        price,
        availableCapital: 10000,
        riskPerTradePercent: parseFloat(settings[0]?.riskPerTrade as string ?? "1"),
        stopLossPercent: parseFloat(settings[0]?.stopLossPercent as string ?? "2"),
        activePositionsCount: openPositions.length,
        maxConcurrentPositions: settings[0]?.maxConcurrentPositions ?? 5,
      });

      if (!risk.approved) {
        return res.status(400).json({ error: "risk_rejected", message: risk.reason });
      }
    }

    const totalValue = body.quantity * price;
    const [trade] = await db
      .insert(tradesTable)
      .values({
        symbol: body.symbol.toUpperCase(),
        side: body.side,
        orderType: body.orderType,
        quantity: body.quantity.toString(),
        price: price.toString(),
        totalValue: totalValue.toString(),
        status: "filled",
        mode,
        filledAt: new Date(),
      })
      .returning();

    if (body.side === "buy") {
      await db.insert(positionsTable).values({
        symbol: body.symbol.toUpperCase(),
        side: "long",
        entryPrice: price.toString(),
        currentPrice: price.toString(),
        quantity: body.quantity.toString(),
        notionalValue: totalValue.toString(),
        stopLoss: (price * 0.98).toString(),
        riskAmount: (totalValue * 0.01).toString(),
        mode,
        isOpen: true,
      });
    }

    res.status(201).json({
      id: trade.id,
      symbol: trade.symbol,
      side: trade.side,
      orderType: trade.orderType,
      quantity: parseFloat(trade.quantity as string),
      price: parseFloat(trade.price as string),
      totalValue: parseFloat(trade.totalValue as string),
      status: trade.status,
      pnl: null,
      pnlPercent: null,
      mode: trade.mode,
      exchangeOrderId: null,
      createdAt: trade.createdAt.toISOString(),
      filledAt: trade.filledAt ? trade.filledAt.toISOString() : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to execute trade");
    res.status(500).json({ error: "Trade execution failed" });
  }
});

export default router;
