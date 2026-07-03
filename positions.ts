import { Router } from "express";
import { db } from "../db/index.js";
import { positionsTable, tradesTable } from "../db/index.js";
import { eq, desc } from "../db/index.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const positions = await db
      .select()
      .from(positionsTable)
      .where(eq(positionsTable.isOpen, true))
      .orderBy(desc(positionsTable.openedAt));

    res.json(
      positions.map((p) => ({
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        entryPrice: parseFloat(p.entryPrice as string),
        currentPrice: parseFloat(p.currentPrice as string),
        quantity: parseFloat(p.quantity as string),
        notionalValue: parseFloat(p.notionalValue as string),
        unrealizedPnl: parseFloat(p.unrealizedPnl as string ?? "0"),
        unrealizedPnlPercent: parseFloat(p.unrealizedPnlPercent as string ?? "0"),
        stopLoss: parseFloat(p.stopLoss as string),
        riskAmount: parseFloat(p.riskAmount as string ?? "0"),
        mode: p.mode,
        openedAt: p.openedAt.toISOString(),
        closedAt: p.closedAt ? p.closedAt.toISOString() : null,
        isOpen: p.isOpen,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to fetch positions");
    res.status(500).json({ error: "Failed to fetch positions" });
  }
});

router.post("/:id/close", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid position ID" });
    }

    const [pos] = await db
      .select()
      .from(positionsTable)
      .where(eq(positionsTable.id, id))
      .limit(1);

    if (!pos) {
      return res.status(404).json({ error: "Position not found" });
    }
    if (!pos.isOpen) {
      return res.status(400).json({ error: "Position already closed" });
    }

    const currentPrice = parseFloat(pos.currentPrice as string);
    const entryPrice = parseFloat(pos.entryPrice as string);
    const quantity = parseFloat(pos.quantity as string);
    const pnl = (currentPrice - entryPrice) * quantity;
    const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

    const [closed] = await db
      .update(positionsTable)
      .set({
        isOpen: false,
        closedAt: new Date(),
        unrealizedPnl: pnl.toString(),
        unrealizedPnlPercent: pnlPercent.toString(),
      })
      .where(eq(positionsTable.id, id))
      .returning();

    await db.insert(tradesTable).values({
      symbol: pos.symbol,
      side: "sell",
      orderType: "market",
      quantity: pos.quantity as string,
      price: currentPrice.toString(),
      totalValue: (quantity * currentPrice).toString(),
      status: "filled",
      pnl: pnl.toString(),
      pnlPercent: pnlPercent.toString(),
      mode: pos.mode,
      filledAt: new Date(),
    });

    res.json({
      id: closed.id,
      symbol: closed.symbol,
      side: closed.side,
      entryPrice: parseFloat(closed.entryPrice as string),
      currentPrice: parseFloat(closed.currentPrice as string),
      quantity: parseFloat(closed.quantity as string),
      notionalValue: parseFloat(closed.notionalValue as string),
      unrealizedPnl: pnl,
      unrealizedPnlPercent: pnlPercent,
      stopLoss: parseFloat(closed.stopLoss as string),
      riskAmount: parseFloat(closed.riskAmount as string ?? "0"),
      mode: closed.mode,
      openedAt: closed.openedAt.toISOString(),
      closedAt: closed.closedAt ? closed.closedAt.toISOString() : null,
      isOpen: false,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to close position");
    res.status(500).json({ error: "Failed to close position" });
  }
});

export default router;
