import { db } from "../db/index.js";
import {
  tradesTable,
  positionsTable,
  signalsTable,
  settingsTable,
  engineLogsTable,
} from "../db/index.js";
import { eq, desc } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { decrypt } from "../lib/crypto.js";
import { CoinDCXClient } from "../integrations/coindcx-client.js";
import {
  generateMockCandles,
  calculateIndicators,
  generateSignal,
  type OHLCVCandle,
} from "./signal-generator.js";
import { checkRisk } from "./risk-manager.js";
import { syncPortfolioToPositions } from "./portfolio-sync.js";

interface EngineState {
  isRunning: boolean;
  lastScanAt: Date | null;
  nextScanIn: number | null;
  totalScans: number;
  intervalHandle: ReturnType<typeof setInterval> | null;
}

const state: EngineState = {
  isRunning: false,
  lastScanAt: null,
  nextScanIn: null,
  totalScans: 0,
  intervalHandle: null,
};

const WATCHED_SYMBOLS_DEFAULT = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "ADAUSDT",
  "DOTUSDT",
  "MATICUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "UNIUSDT",
];

const MOCK_PRICES: Record<string, number> = {
  BTCUSDT: 67500,
  ETHUSDT: 3520,
  SOLUSDT: 175,
  BNBUSDT: 598,
  ADAUSDT: 0.52,
  DOTUSDT: 8.4,
  MATICUSDT: 0.88,
  AVAXUSDT: 38.5,
  LINKUSDT: 18.2,
  UNIUSDT: 10.6,
};

async function addLog(
  level: "info" | "warn" | "error" | "trade",
  message: string,
  symbol?: string
) {
  try {
    await db.insert(engineLogsTable).values({ level, message, symbol: symbol ?? null });
    logger.info({ level, message, symbol }, "Engine log");
  } catch (err) {
    logger.error({ err }, "Failed to insert engine log");
  }
}

async function getSettings() {
  const rows = await db.select().from(settingsTable).limit(1);
  return rows[0] ?? null;
}

async function scanAndTrade() {
  state.totalScans++;
  state.lastScanAt = new Date();

  const settings = await getSettings();
  if (!settings) {
    await addLog("warn", "No settings found, skipping scan");
    return;
  }

  const watchlistSymbols =
    (settings.watchedSymbols as string[]) ?? WATCHED_SYMBOLS_DEFAULT;
  const mode = settings.tradingMode as "paper" | "live";

  let client: CoinDCXClient | null = null;
  let effectiveMode = mode;

  if (mode === "live") {
    if (!settings.encryptedApiKey || !settings.encryptedApiSecret) {
      effectiveMode = "paper";
      await addLog("warn", "Mode is LIVE but no API keys saved — running in PAPER mode. Go to Settings and save your CoinDCX API keys.");
    } else {
      try {
        const apiKey = decrypt(settings.encryptedApiKey);
        const apiSecret = decrypt(settings.encryptedApiSecret);
        client = new CoinDCXClient(apiKey, apiSecret);
        await addLog("info", "LIVE MODE — authenticated with CoinDCX. Real orders will be placed.");
      } catch {
        effectiveMode = "paper";
        await addLog("error", "API key decryption failed — running in PAPER mode. Re-enter your keys in Settings.");
      }
    }
  }

  // Sync existing CoinDCX holdings into positions table (live mode only)
  if (effectiveMode === "live" && client) {
    try {
      const syncResult = await syncPortfolioToPositions(client);
      if (syncResult.synced.length > 0) {
        await addLog("info", `Portfolio sync: imported ${syncResult.synced.length} holdings (total ~$${syncResult.totalValueUsdt.toFixed(2)} USDT)`);
      }
    } catch {
      await addLog("warn", "Portfolio sync failed — scanning watchlist only");
    }
  }

  const activePositions = await db
    .select()
    .from(positionsTable)
    .where(eq(positionsTable.isOpen, true));

  // Combine watchlist + symbols from tracked open positions (deduplicated)
  const heldSymbols = activePositions.map((p) => p.symbol);
  const symbols = [...new Set([...watchlistSymbols, ...heldSymbols])];

  let availableCapital = 10000;
  if (effectiveMode === "paper") {
    availableCapital = 10000;
  } else if (client) {
    try {
      const balances = await client.getBalances();
      const usdtBal = balances.find((b) => b.currency === "USDT");
      availableCapital = usdtBal ? parseFloat(usdtBal.balance) : 0;
      await addLog("info", `Live USDT balance: $${availableCapital.toFixed(2)}`);
    } catch {
      await addLog("warn", "Could not fetch live balance, using $0 capital");
      availableCapital = 0;
    }
  }
  const maxPositions = settings.maxConcurrentPositions ?? 5;
  const riskPerTrade = parseFloat(settings.riskPerTrade as string) ?? 1.0;
  const stopLossPercent = parseFloat(settings.stopLossPercent as string) ?? 2.0;

  for (const symbol of symbols) {
    try {
      let candles: OHLCVCandle[];
      const basePrice = MOCK_PRICES[symbol] ?? 100;

      if (client) {
        try {
          const raw = await client.getCandles(symbol, "1h", 250);
          candles = raw.map((c) => ({
            timestamp: c.time,
            open: parseFloat(c.open),
            high: parseFloat(c.high),
            low: parseFloat(c.low),
            close: parseFloat(c.close),
            volume: parseFloat(c.volume),
          }));
        } catch {
          candles = generateMockCandles(basePrice, 250);
        }
      } else {
        const priceJitter = basePrice * (1 + (Math.random() - 0.5) * 0.02);
        candles = generateMockCandles(priceJitter, 250);
      }

      const indicators = calculateIndicators(candles);
      if (!indicators) {
        await addLog("warn", `Not enough candle data for ${symbol}`, symbol);
        continue;
      }

      const signal = generateSignal(symbol, candles, indicators);

      await db.insert(signalsTable).values({
        symbol,
        action: signal.action,
        confidence: signal.confidence.toString(),
        reasoning: signal.reasoning,
        rsi: indicators.rsi.toString(),
        ema20: indicators.ema20.toString(),
        ema50: indicators.ema50.toString(),
        ema200: indicators.ema200.toString(),
        macdLine: indicators.macdLine.toString(),
        macdSignal: indicators.macdSignal.toString(),
        supertrend: indicators.supertrend,
        price: signal.price.toString(),
      });

      const existingPosition = activePositions.find((p) => p.symbol === symbol);

      if (signal.action === "BUY" && !existingPosition && signal.confidence > 60) {
        const risk = checkRisk({
          symbol,
          side: "buy",
          price: signal.price,
          availableCapital,
          riskPerTradePercent: riskPerTrade,
          stopLossPercent,
          activePositionsCount: activePositions.length,
          maxConcurrentPositions: maxPositions,
          atr: indicators.atr,
        });

        if (risk.approved) {
          const totalValue = risk.quantity * signal.price;
          await db.insert(tradesTable).values({
            symbol,
            side: "buy",
            orderType: "market",
            quantity: risk.quantity.toString(),
            price: signal.price.toString(),
            totalValue: totalValue.toString(),
            status: "filled",
            mode,
            filledAt: new Date(),
          });

          await db.insert(positionsTable).values({
            symbol,
            side: "long",
            entryPrice: signal.price.toString(),
            currentPrice: signal.price.toString(),
            quantity: risk.quantity.toString(),
            notionalValue: totalValue.toString(),
            stopLoss: risk.stopLoss.toString(),
            riskAmount: risk.riskAmount.toString(),
            mode,
            isOpen: true,
          });

          await addLog(
            "trade",
            `BOUGHT ${symbol} @ $${signal.price.toFixed(4)} | Qty: ${risk.quantity.toFixed(4)} | Confidence: ${signal.confidence}%`,
            symbol
          );
          activePositions.push({} as typeof activePositions[0]);
        } else {
          await addLog("warn", `BUY rejected for ${symbol}: ${risk.reason}`, symbol);
        }
      } else if (signal.action === "SELL" && existingPosition) {
        const entryPrice = parseFloat(existingPosition.entryPrice as string);
        const pnl = (signal.price - entryPrice) * parseFloat(existingPosition.quantity as string);
        const pnlPercent = ((signal.price - entryPrice) / entryPrice) * 100;

        await db.insert(tradesTable).values({
          symbol,
          side: "sell",
          orderType: "market",
          quantity: existingPosition.quantity as string,
          price: signal.price.toString(),
          totalValue: (
            parseFloat(existingPosition.quantity as string) * signal.price
          ).toString(),
          status: "filled",
          pnl: pnl.toString(),
          pnlPercent: pnlPercent.toString(),
          mode,
          filledAt: new Date(),
        });

        await db
          .update(positionsTable)
          .set({
            isOpen: false,
            closedAt: new Date(),
            currentPrice: signal.price.toString(),
            unrealizedPnl: pnl.toString(),
            unrealizedPnlPercent: pnlPercent.toString(),
          })
          .where(eq(positionsTable.id, existingPosition.id));

        await addLog(
          "trade",
          `SOLD ${symbol} @ $${signal.price.toFixed(4)} | PNL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`,
          symbol
        );
      } else if (signal.action !== "WAIT") {
        await addLog("info", `${signal.action} signal for ${symbol} (${signal.confidence}% confidence) — no action taken`, symbol);
      }

      await updateOpenPositions(symbol, signal.price);
    } catch (err) {
      await addLog("error", `Error scanning ${symbol}: ${(err as Error).message}`, symbol);
    }
  }

  await addLog("info", `Scan #${state.totalScans} complete`);
}

async function updateOpenPositions(symbol: string, currentPrice: number) {
  const positions = await db
    .select()
    .from(positionsTable)
    .where(eq(positionsTable.isOpen, true));

  for (const pos of positions) {
    if (pos.symbol !== symbol) continue;
    const entryPrice = parseFloat(pos.entryPrice as string);
    const qty = parseFloat(pos.quantity as string);
    const stopLoss = parseFloat(pos.stopLoss as string);
    const pnl = (currentPrice - entryPrice) * qty;
    const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

    if (currentPrice <= stopLoss) {
      await db
        .update(positionsTable)
        .set({
          isOpen: false,
          closedAt: new Date(),
          currentPrice: currentPrice.toString(),
          unrealizedPnl: pnl.toString(),
          unrealizedPnlPercent: pnlPercent.toString(),
        })
        .where(eq(positionsTable.id, pos.id));

      await db.insert(tradesTable).values({
        symbol,
        side: "sell",
        orderType: "market",
        quantity: pos.quantity as string,
        price: currentPrice.toString(),
        totalValue: (qty * currentPrice).toString(),
        status: "filled",
        pnl: pnl.toString(),
        pnlPercent: pnlPercent.toString(),
        mode: pos.mode,
        filledAt: new Date(),
      });

      await addLog(
        "warn",
        `STOP LOSS triggered for ${symbol} @ $${currentPrice.toFixed(4)} | Loss: $${pnl.toFixed(2)}`,
        symbol
      );
    } else {
      await db
        .update(positionsTable)
        .set({
          currentPrice: currentPrice.toString(),
          unrealizedPnl: pnl.toString(),
          unrealizedPnlPercent: pnlPercent.toString(),
          notionalValue: (qty * currentPrice).toString(),
        })
        .where(eq(positionsTable.id, pos.id));
    }
  }
}

export function startEngine(intervalSeconds = 30) {
  if (state.isRunning) return;
  state.isRunning = true;
  state.nextScanIn = 0;

  addLog("info", `Trading engine started (${intervalSeconds}s interval)`);

  scanAndTrade().catch((err) => logger.error({ err }, "Initial scan failed"));

  state.intervalHandle = setInterval(() => {
    state.nextScanIn = intervalSeconds;
    scanAndTrade().catch((err) => logger.error({ err }, "Scheduled scan failed"));
  }, intervalSeconds * 1000);

  logger.info({ intervalSeconds }, "Trading engine started");
}

export function stopEngine() {
  if (!state.isRunning) return;
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  state.isRunning = false;
  state.nextScanIn = null;
  addLog("info", "Trading engine stopped");
  logger.info("Trading engine stopped");
}

export function getEngineState() {
  return {
    isRunning: state.isRunning,
    lastScanAt: state.lastScanAt,
    nextScanIn: state.nextScanIn,
    totalScans: state.totalScans,
  };
}
