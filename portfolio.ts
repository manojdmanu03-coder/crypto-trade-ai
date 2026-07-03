import { Router } from "express";
import { db } from "../db/index.js";
import { tradesTable, positionsTable, settingsTable } from "../db/index.js";
import { eq, isNotNull } from "../db/index.js";
import { CoinDCXClient } from "../integrations/coindcx-client.js";
import { decrypt } from "../lib/crypto.js";
import { syncPortfolioToPositions } from "../engine/portfolio-sync.js";

const router = Router();

router.get("/balance", async (req, res) => {
  try {
    const settings = await db.select().from(settingsTable).limit(1);
    const s = settings[0];
    const isLive = s?.tradingMode === "live" && !!s?.encryptedApiKey && !!s?.encryptedApiSecret;

    if (isLive) {
      try {
        const apiKey = decrypt(s.encryptedApiKey!);
        const apiSecret = decrypt(s.encryptedApiSecret!);
        const client = new CoinDCXClient(apiKey, apiSecret);

        const rawBalances = await client.getBalances();

        const nonZero = rawBalances.filter(
          (b) => parseFloat(b.balance) > 0 || parseFloat(b.locked_balance) > 0
        );

        const usdtRaw = rawBalances.find((b) => b.currency === "USDT");
        const availableUsdt = parseFloat(usdtRaw?.balance ?? "0");
        const lockedUsdt = parseFloat(usdtRaw?.locked_balance ?? "0");
        const totalUsdtCash = availableUsdt + lockedUsdt;

        const assets = nonZero.map((b) => ({
          currency: b.currency,
          balance: parseFloat(b.balance),
          lockedBalance: parseFloat(b.locked_balance),
          valueUsdt: b.currency === "USDT" ? parseFloat(b.balance) : 0,
        }));

        const openPositions = await db
          .select()
          .from(positionsTable)
          .where(eq(positionsTable.isOpen, true));

        const inPositionsUsdt = openPositions.reduce(
          (acc, p) => acc + parseFloat(p.notionalValue as string ?? "0"),
          0
        );
        const openPnl = openPositions.reduce(
          (acc, p) => acc + parseFloat(p.unrealizedPnl as string ?? "0"),
          0
        );

        const closedTrades = await db
          .select()
          .from(tradesTable)
          .where(isNotNull(tradesTable.pnl));
        const totalPnl = closedTrades
          .filter((t) => t.mode === "live")
          .reduce((acc, t) => acc + parseFloat(t.pnl as string ?? "0"), 0);

        return res.json({
          mode: "live",
          totalValueUsdt: parseFloat((totalUsdtCash + inPositionsUsdt + openPnl).toFixed(2)),
          availableUsdt: parseFloat(availableUsdt.toFixed(2)),
          lockedUsdt: parseFloat(lockedUsdt.toFixed(2)),
          inPositionsUsdt: parseFloat(inPositionsUsdt.toFixed(2)),
          totalPnl: parseFloat(totalPnl.toFixed(2)),
          totalPnlPercent: 0,
          openPnl: parseFloat(openPnl.toFixed(2)),
          assets,
        });
      } catch (err) {
        req.log.error({ err }, "CoinDCX balance fetch failed, falling back to paper");
      }
    }

    const openPositions = await db
      .select()
      .from(positionsTable)
      .where(eq(positionsTable.isOpen, true));

    const inPositionsUsdt = openPositions.reduce(
      (acc, p) => acc + parseFloat(p.notionalValue as string ?? "0"),
      0
    );
    const openPnl = openPositions.reduce(
      (acc, p) => acc + parseFloat(p.unrealizedPnl as string ?? "0"),
      0
    );

    const closedTrades = await db
      .select()
      .from(tradesTable)
      .where(isNotNull(tradesTable.pnl));
    const totalPnl = closedTrades.reduce(
      (acc, t) => acc + parseFloat(t.pnl as string ?? "0"),
      0
    );

    const paperCapital = 10000;
    const totalValueUsdt = paperCapital + totalPnl + openPnl;
    const availableUsdt = totalValueUsdt - inPositionsUsdt;
    const totalPnlPercent = (totalPnl / paperCapital) * 100;

    const assets = [
      { currency: "USDT", balance: availableUsdt, valueUsdt: availableUsdt },
      ...openPositions.map((p) => ({
        currency: p.symbol.replace("USDT", ""),
        balance: parseFloat(p.quantity as string),
        valueUsdt: parseFloat(p.notionalValue as string ?? "0"),
      })),
    ];

    return res.json({
      mode: "paper",
      totalValueUsdt: parseFloat(totalValueUsdt.toFixed(2)),
      availableUsdt: parseFloat(availableUsdt.toFixed(2)),
      inPositionsUsdt: parseFloat(inPositionsUsdt.toFixed(2)),
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      totalPnlPercent: parseFloat(totalPnlPercent.toFixed(2)),
      openPnl: parseFloat(openPnl.toFixed(2)),
      assets,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch balance");
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

router.post("/sync", async (req, res) => {
  try {
    const settings = await db.select().from(settingsTable).limit(1);
    const s = settings[0];

    if (!s || s.tradingMode !== "live" || !s.encryptedApiKey || !s.encryptedApiSecret) {
      return res.status(400).json({ error: "Live mode with API keys required for portfolio sync" });
    }

    const { decrypt } = await import("../lib/crypto.js");
    const apiKey = decrypt(s.encryptedApiKey!);
    const apiSecret = decrypt(s.encryptedApiSecret!);
    const client = new CoinDCXClient(apiKey, apiSecret);

    const result = await syncPortfolioToPositions(client);
    return res.json({
      synced: result.synced.length,
      symbols: result.synced,
      skipped: result.skipped.length,
      totalValueUsdt: parseFloat(result.totalValueUsdt.toFixed(2)),
    });
  } catch (err) {
    req.log.error({ err }, "Portfolio sync failed");
    return res.status(500).json({ error: "Portfolio sync failed" });
  }
});

export default router;
