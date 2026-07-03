import { logger } from "../lib/logger.js";

export interface RiskCheckResult {
  approved: boolean;
  reason?: string;
  quantity: number;
  stopLoss: number;
  riskAmount: number;
}

export interface RiskParams {
  symbol: string;
  side: "buy" | "sell";
  price: number;
  availableCapital: number;
  riskPerTradePercent: number;
  stopLossPercent: number;
  activePositionsCount: number;
  maxConcurrentPositions: number;
  atr?: number;
}

export function checkRisk(params: RiskParams): RiskCheckResult {
  const {
    symbol,
    side,
    price,
    availableCapital,
    riskPerTradePercent,
    stopLossPercent,
    activePositionsCount,
    maxConcurrentPositions,
    atr,
  } = params;

  if (side === "buy" && activePositionsCount >= maxConcurrentPositions) {
    return {
      approved: false,
      reason: `Max concurrent positions reached (${activePositionsCount}/${maxConcurrentPositions})`,
      quantity: 0,
      stopLoss: 0,
      riskAmount: 0,
    };
  }

  const MIN_CAPITAL = 1;
  const MIN_POSITION_USDT = 1;

  if (availableCapital < MIN_CAPITAL) {
    return {
      approved: false,
      reason: `Insufficient capital: $${availableCapital.toFixed(2)} available (min $${MIN_CAPITAL})`,
      quantity: 0,
      stopLoss: 0,
      riskAmount: 0,
    };
  }

  const riskAmount = availableCapital * (riskPerTradePercent / 100);
  const stopLossDistance = atr ? atr * 1.5 : price * (stopLossPercent / 100);
  const stopLoss = side === "buy"
    ? price - stopLossDistance
    : price + stopLossDistance;

  let quantity = riskAmount / stopLossDistance;
  let positionSize = quantity * price;

  // Ensure minimum $1 position size
  if (positionSize < MIN_POSITION_USDT) {
    quantity = MIN_POSITION_USDT / price;
    positionSize = MIN_POSITION_USDT;
  }

  // Cap at 95% of available capital (leave a small buffer)
  const maxPositionUsdt = availableCapital * 0.95;
  if (positionSize > maxPositionUsdt) {
    quantity = maxPositionUsdt / price;
    positionSize = maxPositionUsdt;
    logger.info({ symbol, positionSize, adjustedQuantity: quantity }, "Position size capped at 95% of capital");
    return {
      approved: true,
      quantity,
      stopLoss,
      riskAmount: quantity * stopLossDistance,
    };
  }

  logger.info(
    { symbol, side, quantity, stopLoss, riskAmount, positionSize },
    "Risk check approved"
  );

  return { approved: true, quantity, stopLoss, riskAmount };
}
