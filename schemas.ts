import { z } from "zod";

export const HealthCheckResponse = z.object({
  status: z.literal("ok"),
});

export const UpdateSettingsBody = z.object({
  tradingMode: z.enum(["paper", "live"]).optional(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  maxConcurrentPositions: z.number().int().min(1).max(20).optional(),
  riskPerTrade: z.number().min(0.1).max(10).optional(),
  stopLossPercent: z.number().min(0.5).max(20).optional(),
  scanIntervalSeconds: z.number().int().min(5).max(300).optional(),
  watchedSymbols: z.array(z.string()).optional(),
});

export const ExecuteTradeBody = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  orderType: z.enum(["market", "limit"]),
  quantity: z.number().positive(),
  price: z.number().positive().optional(),
});

export const ToggleEngineBody = z.object({
  running: z.boolean(),
});
