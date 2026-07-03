import { Router } from "express";
import { db } from "../db/index.js";
import { tradesTable, positionsTable } from "../db/index.js";
import { eq, isNotNull } from "../db/index.js";

const router = Router();

router.get("/summary", async (req, res) => {
  try {
    const trades = await db
      .select()
      .from(tradesTable)
      .where(isNotNull(tradesTable.pnl));

    const sells = trades.filter((t) => t.side === "sell");
    const winningTrades = sells.filter((t) => parseFloat(t.pnl as string ?? "0") > 0);
    const losingTrades = sells.filter((t) => parseFloat(t.pnl as string ?? "0") <= 0);

    const totalPnl = sells.reduce((acc, t) => acc + parseFloat(t.pnl as string ?? "0"), 0);
    const winRate = sells.length > 0 ? (winningTrades.length / sells.length) * 100 : 0;

    const pnls = sells.map((t) => parseFloat(t.pnl as string ?? "0"));
    const bestTrade = pnls.length > 0 ? Math.max(...pnls) : 0;
    const worstTrade = pnls.length > 0 ? Math.min(...pnls) : 0;
    const winPnls = winningTrades.map((t) => parseFloat(t.pnl as string ?? "0"));
    const lossPnls = losingTrades.map((t) => parseFloat(t.pnl as string ?? "0"));
    const avgWin = winPnls.length > 0 ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length : 0;
    const avgLoss = lossPnls.length > 0 ? Math.abs(lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length) : 0;
    const totalWins = winPnls.reduce((a, b) => a + b, 0);
    const totalLosses = Math.abs(lossPnls.reduce((a, b) => a + b, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;

    const activePositions = await db
      .select()
      .from(positionsTable)
      .where(eq(positionsTable.isOpen, true));

    const openPnl = activePositions.reduce(
      (acc, p) => acc + parseFloat(p.unrealizedPnl as string ?? "0"),
      0
    );

    const paperCapital = 10000;
    const totalPnlPercent = (totalPnl / paperCapital) * 100;

    res.json({
      totalTrades: sells.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: parseFloat(winRate.toFixed(2)),
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      totalPnlPercent: parseFloat(totalPnlPercent.toFixed(2)),
      bestTrade: parseFloat(bestTrade.toFixed(2)),
      worstTrade: parseFloat(worstTrade.toFixed(2)),
      avgWin: parseFloat(avgWin.toFixed(2)),
      avgLoss: parseFloat(avgLoss.toFixed(2)),
      profitFactor: parseFloat(profitFactor.toFixed(2)),
      activePositions: activePositions.length,
      openPnl: parseFloat(openPnl.toFixed(2)),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch analytics summary");
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

router.get("/pnl-history", async (req, res) => {
  try {
    const trades = await db
      .select()
      .from(tradesTable)
      .where(isNotNull(tradesTable.pnl));

    const byDate: Record<string, number> = {};
    for (const t of trades) {
      if (t.side !== "sell") continue;
      const date = t.createdAt.toISOString().split("T")[0];
      byDate[date] = (byDate[date] ?? 0) + parseFloat(t.pnl as string ?? "0");
    }

    const sorted = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));
    let cumulative = 0;
    const history = sorted.map(([date, dailyPnl]) => {
      cumulative += dailyPnl;
      return {
        date,
        cumulativePnl: parseFloat(cumulative.toFixed(2)),
        dailyPnl: parseFloat(dailyPnl.toFixed(2)),
      };
    });

    if (history.length === 0) {
      const today = new Date().toISOString().split("T")[0];
      history.push({ date: today, cumulativePnl: 0, dailyPnl: 0 });
    }

    res.json(history);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch PNL history");
    res.status(500).json({ error: "Failed to fetch PNL history" });
  }
});

router.get("/coin-performance", async (req, res) => {
  try {
    const trades = await db
      .select()
      .from(tradesTable)
      .where(isNotNull(tradesTable.pnl));

    const coinMap: Record<string, { wins: number; losses: number; pnl: number }> = {};
    for (const t of trades) {
      if (t.side !== "sell") continue;
      if (!coinMap[t.symbol]) coinMap[t.symbol] = { wins: 0, losses: 0, pnl: 0 };
      const pnl = parseFloat(t.pnl as string ?? "0");
      coinMap[t.symbol].pnl += pnl;
      if (pnl > 0) coinMap[t.symbol].wins++;
      else coinMap[t.symbol].losses++;
    }

    const result = Object.entries(coinMap).map(([symbol, data]) => {
      const totalTrades = data.wins + data.losses;
      return {
        symbol,
        totalTrades,
        wins: data.wins,
        losses: data.losses,
        pnl: parseFloat(data.pnl.toFixed(2)),
        winRate: totalTrades > 0 ? parseFloat(((data.wins / totalTrades) * 100).toFixed(2)) : 0,
      };
    });

    res.json(result.sort((a, b) => b.pnl - a.pnl));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch coin performance");
    res.status(500).json({ error: "Failed to fetch coin performance" });
  }
});

export default router;
