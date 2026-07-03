import { db } from "../db/index.js";
import { positionsTable, settingsTable } from "../db/index.js";
import { eq, and } from "../db/index.js";
import { CoinDCXClient } from "../integrations/coindcx-client.js";
import { decrypt } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";

const INR_TO_USDT = 1 / 83.5;
const MIN_VALUE_USDT = 0.5;

export interface SyncResult {
  synced: string[];
  skipped: string[];
  totalValueUsdt: number;
}

export function symbolToMarket(coin: string, tickers: Array<{ market: string; last_price: string }>): {
  market: string;
  priceUsdt: number;
  isInr: boolean;
} | null {
  const usdtMarket = coin + "USDT";
  const inrMarket = coin + "INR";

  const usdtTicker = tickers.find((t) => t.market === usdtMarket);
  if (usdtTicker) {
    return { market: usdtMarket, priceUsdt: parseFloat(usdtTicker.last_price), isInr: false };
  }

  const inrTicker = tickers.find((t) => t.market === inrMarket);
  if (inrTicker) {
    const priceUsdt = parseFloat(inrTicker.last_price) * INR_TO_USDT;
    return { market: inrMarket, priceUsdt, isInr: true };
  }

  return null;
}

export async function syncPortfolioToPositions(client: CoinDCXClient): Promise<SyncResult> {
  const synced: string[] = [];
  const skipped: string[] = [];
  let totalValueUsdt = 0;

  try {
    const [balances, tickers] = await Promise.all([
      client.getBalances(),
      client.getAllTickers(),
    ]);

    const existingOpen = await db
      .select({ symbol: positionsTable.symbol })
      .from(positionsTable)
      .where(and(eq(positionsTable.isOpen, true), eq(positionsTable.mode, "live")));

    const alreadyTracked = new Set(existingOpen.map((p) => p.symbol));

    for (const bal of balances) {
      const coin = bal.currency;
      if (coin === "USDT" || coin === "INR") continue;

      const amount = parseFloat(bal.balance) + parseFloat(bal.locked_balance);
      if (amount <= 0) continue;

      const marketInfo = symbolToMarket(coin, tickers as Array<{ market: string; last_price: string }>);
      if (!marketInfo) {
        skipped.push(coin);
        continue;
      }

      const valueUsdt = amount * marketInfo.priceUsdt;
      if (valueUsdt < MIN_VALUE_USDT) {
        skipped.push(coin);
        continue;
      }

      totalValueUsdt += valueUsdt;

      if (alreadyTracked.has(marketInfo.market)) {
        synced.push(marketInfo.market);
        continue;
      }

      await db.insert(positionsTable).values({
        symbol: marketInfo.market,
        side: "long",
        entryPrice: marketInfo.priceUsdt.toString(),
        currentPrice: marketInfo.priceUsdt.toString(),
        quantity: amount.toString(),
        notionalValue: valueUsdt.toString(),
        unrealizedPnl: "0",
        unrealizedPnlPercent: "0",
        stopLoss: (marketInfo.priceUsdt * 0.95).toString(),
        riskAmount: "0",
        mode: "live",
        isOpen: true,
      });

      synced.push(marketInfo.market);
      logger.info({ coin, market: marketInfo.market, valueUsdt }, "Portfolio position synced");
    }
  } catch (err) {
    logger.error({ err }, "Portfolio sync failed");
    throw err;
  }

  return { synced, skipped, totalValueUsdt };
}

export async function getLiveClient(): Promise<CoinDCXClient | null> {
  try {
    const settings = await db.select().from(settingsTable).limit(1);
    const s = settings[0];
    if (!s || s.tradingMode !== "live" || !s.encryptedApiKey || !s.encryptedApiSecret) {
      return null;
    }
    const apiKey = decrypt(s.encryptedApiKey);
    const apiSecret = decrypt(s.encryptedApiSecret);
    return new CoinDCXClient(apiKey, apiSecret);
  } catch {
    return null;
  }
}
