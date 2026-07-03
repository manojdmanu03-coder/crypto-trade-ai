import { Router } from "express";
import {
  generateMockCandles,
  calculateIndicators,
  generateSignal,
} from "../engine/signal-generator.js";

const router = Router();

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

const WATCHED_SYMBOLS = Object.keys(MOCK_PRICES);

router.get("/scanner", async (req, res) => {
  try {
    const results = await Promise.all(
      WATCHED_SYMBOLS.map(async (symbol) => {
        const basePrice = MOCK_PRICES[symbol] ?? 100;
        const jitter = basePrice * (1 + (Math.random() - 0.5) * 0.04);
        const candles = generateMockCandles(jitter, 250);
        const indicators = calculateIndicators(candles);
        const price = candles[candles.length - 1].close;
        const change24h = (Math.random() - 0.45) * 8;
        const volume24h = Math.random() * 50000000 + 5000000;

        if (!indicators) {
          return {
            symbol,
            price,
            change24h,
            volume24h,
            signal: "WAIT",
            confidence: 0,
            reasoning: "Insufficient data",
            rsi: 50,
            ema20: price,
            ema50: price,
            ema200: price,
            macdLine: 0,
            macdSignal: 0,
            supertrend: "NEUTRAL",
            updatedAt: new Date().toISOString(),
          };
        }

        const signal = generateSignal(symbol, candles, indicators);
        return {
          symbol,
          price,
          change24h,
          volume24h,
          signal: signal.action,
          confidence: signal.confidence,
          reasoning: signal.reasoning,
          rsi: parseFloat(indicators.rsi.toFixed(2)),
          ema20: parseFloat(indicators.ema20.toFixed(4)),
          ema50: parseFloat(indicators.ema50.toFixed(4)),
          ema200: parseFloat(indicators.ema200.toFixed(4)),
          macdLine: parseFloat(indicators.macdLine.toFixed(6)),
          macdSignal: parseFloat(indicators.macdSignal.toFixed(6)),
          supertrend: indicators.supertrend,
          updatedAt: new Date().toISOString(),
        };
      })
    );

    res.json(results);
  } catch (err) {
    req.log.error({ err }, "Market scanner error");
    res.status(500).json({ error: "Scanner failed" });
  }
});

router.get("/ticker/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const basePrice = MOCK_PRICES[symbol] ?? 100;
  const price = basePrice * (1 + (Math.random() - 0.5) * 0.02);
  res.json({
    symbol,
    price,
    high24h: price * 1.03,
    low24h: price * 0.97,
    change24h: (Math.random() - 0.45) * 6,
    volume24h: Math.random() * 50000000 + 1000000,
    timestamp: new Date().toISOString(),
  });
});

router.get("/candles/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const basePrice = MOCK_PRICES[symbol] ?? 100;
  const candles = generateMockCandles(basePrice, 100);
  res.json(
    candles.map((c) => ({
      timestamp: c.timestamp,
      open: parseFloat(c.open.toFixed(6)),
      high: parseFloat(c.high.toFixed(6)),
      low: parseFloat(c.low.toFixed(6)),
      close: parseFloat(c.close.toFixed(6)),
      volume: parseFloat(c.volume.toFixed(2)),
    }))
  );
});

export default router;
