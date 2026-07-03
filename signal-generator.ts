export interface OHLCVCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalIndicators {
  rsi: number;
  ema20: number;
  ema50: number;
  ema200: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  supertrend: "BULLISH" | "BEARISH" | "NEUTRAL";
  atr: number;
}

export interface TradingSignal {
  action: "BUY" | "SELL" | "WAIT";
  confidence: number;
  reasoning: string;
  indicators: TechnicalIndicators;
  price: number;
}

function ema(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let emaPrev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(emaPrev);
  for (let i = period; i < values.length; i++) {
    emaPrev = values[i] * k + emaPrev * (1 - k);
    result.push(emaPrev);
  }
  return result;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const changes = closes.slice(1).map((v, i) => v - closes[i]);
  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? -c : 0));

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcATR(candles: OHLCVCandle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i];
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
  });
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function calcSupertrend(
  candles: OHLCVCandle[],
  period = 10,
  multiplier = 3
): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (candles.length < period + 2) return "NEUTRAL";
  const atr = calcATR(candles, period);
  const last = candles[candles.length - 1];
  const hl2 = (last.high + last.low) / 2;
  const upperBand = hl2 + multiplier * atr;
  const lowerBand = hl2 - multiplier * atr;
  if (last.close > upperBand) return "BULLISH";
  if (last.close < lowerBand) return "BEARISH";
  const prev = candles[candles.length - 2];
  const prevHl2 = (prev.high + prev.low) / 2;
  const prevUpper = prevHl2 + multiplier * atr;
  if (last.close > prevUpper) return "BULLISH";
  if (last.close < lowerBand) return "BEARISH";
  return "NEUTRAL";
}

export function calculateIndicators(candles: OHLCVCandle[]): TechnicalIndicators | null {
  if (candles.length < 200) return null;
  const closes = candles.map((c) => c.close);

  const ema20Arr = ema(closes, 20);
  const ema50Arr = ema(closes, 50);
  const ema200Arr = ema(closes, 200);

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLineArr = ema12.slice(ema12.length - ema26.length).map((v, i) => v - ema26[i]);
  const macdSignalArr = ema(macdLineArr, 9);
  const macdLine = macdLineArr[macdLineArr.length - 1] ?? 0;
  const macdSignalVal = macdSignalArr[macdSignalArr.length - 1] ?? 0;

  return {
    rsi: calcRSI(closes.slice(-50), 14),
    ema20: ema20Arr[ema20Arr.length - 1] ?? closes[closes.length - 1],
    ema50: ema50Arr[ema50Arr.length - 1] ?? closes[closes.length - 1],
    ema200: ema200Arr[ema200Arr.length - 1] ?? closes[closes.length - 1],
    macdLine,
    macdSignal: macdSignalVal,
    macdHistogram: macdLine - macdSignalVal,
    supertrend: calcSupertrend(candles),
    atr: calcATR(candles),
  };
}

export function generateSignal(
  symbol: string,
  candles: OHLCVCandle[],
  indicators: TechnicalIndicators
): TradingSignal {
  const price = candles[candles.length - 1].close;
  const reasons: string[] = [];
  let score = 0;

  const { rsi, ema20, ema50, ema200, macdLine, macdSignal, supertrend } = indicators;

  if (rsi < 30) { score += 2; reasons.push(`RSI oversold (${rsi.toFixed(1)})`); }
  else if (rsi < 45) { score += 1; reasons.push(`RSI bearish zone (${rsi.toFixed(1)})`); }
  else if (rsi > 70) { score -= 2; reasons.push(`RSI overbought (${rsi.toFixed(1)})`); }
  else if (rsi > 55) { score -= 1; reasons.push(`RSI bullish zone (${rsi.toFixed(1)})`); }

  if (price > ema20 && ema20 > ema50 && ema50 > ema200) {
    score += 3; reasons.push("EMA bullish alignment (20>50>200)");
  } else if (price < ema20 && ema20 < ema50 && ema50 < ema200) {
    score -= 3; reasons.push("EMA bearish alignment (20<50<200)");
  } else if (price > ema50) {
    score += 1; reasons.push("Price above EMA50");
  } else if (price < ema50) {
    score -= 1; reasons.push("Price below EMA50");
  }

  if (macdLine > macdSignal && macdLine > 0) {
    score += 2; reasons.push("MACD bullish crossover above zero");
  } else if (macdLine > macdSignal) {
    score += 1; reasons.push("MACD bullish crossover");
  } else if (macdLine < macdSignal && macdLine < 0) {
    score -= 2; reasons.push("MACD bearish crossover below zero");
  } else if (macdLine < macdSignal) {
    score -= 1; reasons.push("MACD bearish crossover");
  }

  if (supertrend === "BULLISH") { score += 2; reasons.push("SuperTrend bullish"); }
  else if (supertrend === "BEARISH") { score -= 2; reasons.push("SuperTrend bearish"); }

  const maxScore = 9;
  const normalizedScore = score / maxScore;
  const confidence = Math.min(Math.round(Math.abs(normalizedScore) * 100), 95);

  let action: "BUY" | "SELL" | "WAIT";
  if (score >= 4) action = "BUY";
  else if (score <= -4) action = "SELL";
  else action = "WAIT";

  const reasoning = reasons.join("; ") || "Mixed signals, no clear direction";

  return { action, confidence, reasoning, indicators, price };
}

export function generateMockCandles(basePrice: number, count = 250): OHLCVCandle[] {
  const candles: OHLCVCandle[] = [];
  let price = basePrice;
  const now = Date.now();
  for (let i = count; i >= 0; i--) {
    const change = (Math.random() - 0.48) * price * 0.02;
    const open = price;
    price = Math.max(price + change, 0.0001);
    const high = Math.max(open, price) * (1 + Math.random() * 0.005);
    const low = Math.min(open, price) * (1 - Math.random() * 0.005);
    candles.push({
      timestamp: now - i * 3600000,
      open,
      high,
      low,
      close: price,
      volume: Math.random() * 1000 + 100,
    });
  }
  return candles;
}
