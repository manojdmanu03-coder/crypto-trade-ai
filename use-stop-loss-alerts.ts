import { useEffect, useRef, useMemo } from "react";
import type { LivePrices } from "./use-price-stream";

export type AlertLevel = "safe" | "warning" | "danger";

export interface PositionAlert {
  id: number;
  symbol: string;
  side: string;
  entryPrice: number;
  stopLoss: number;
  livePrice: number;
  distancePct: number;
  level: AlertLevel;
}

interface MonitoredPosition {
  id: number;
  symbol: string;
  side: string;
  entryPrice: number | string;
  stopLoss: number | string;
}

const WARNING_THRESHOLD_PCT = 2;
const DANGER_THRESHOLD_PCT = 0.5;
const NOTIFICATION_COOLDOWN_MS = 60_000;

function getLevel(distancePct: number): AlertLevel {
  if (distancePct <= DANGER_THRESHOLD_PCT) return "danger";
  if (distancePct <= WARNING_THRESHOLD_PCT) return "warning";
  return "safe";
}

async function requestNotificationPermission(): Promise<void> {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
}

function fireNotification(symbol: string, livePrice: number, stopLoss: number, level: AlertLevel) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const title = level === "danger"
    ? `🚨 STOP-LOSS BREACHED — ${symbol}`
    : `⚠️ Stop-Loss Warning — ${symbol}`;
  const body = level === "danger"
    ? `Live price ${livePrice.toFixed(4)} has crossed stop-loss ${stopLoss.toFixed(4)}`
    : `Live price ${livePrice.toFixed(4)} is within ${WARNING_THRESHOLD_PCT}% of stop-loss ${stopLoss.toFixed(4)}`;
  try {
    const n = new Notification(title, { body, icon: "/favicon.ico", tag: `sl-${symbol}` });
    setTimeout(() => n.close(), 8000);
  } catch {
    // Some browsers block Notification in iframes
  }
}

export function useStopLossAlerts(
  positions: MonitoredPosition[] | undefined,
  livePrices: LivePrices,
  onAlert?: (alert: PositionAlert) => void,
): PositionAlert[] {
  const lastNotifiedAt = useRef<Record<string, number>>({});
  const permissionRequested = useRef(false);
  const prevLevels = useRef<Record<number, AlertLevel>>({});
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  // Request browser notification permission once positions arrive
  useEffect(() => {
    if (positions && positions.length > 0 && !permissionRequested.current) {
      permissionRequested.current = true;
      void requestNotificationPermission();
    }
  }, [positions]);

  // Compute current alerts (pure derivation — no side effects)
  const alerts = useMemo<PositionAlert[]>(() => {
    if (!positions || positions.length === 0) return [];
    const result: PositionAlert[] = [];
    for (const p of positions) {
      const stop = parseFloat(String(p.stopLoss));
      const entry = parseFloat(String(p.entryPrice));
      const livePrice = livePrices[p.symbol];
      if (!livePrice || !stop || stop === 0) continue;

      const distancePct = p.side === "long"
        ? ((livePrice - stop) / entry) * 100
        : ((stop - livePrice) / entry) * 100;

      const level = getLevel(distancePct);
      result.push({ id: p.id, symbol: p.symbol, side: p.side, entryPrice: entry, stopLoss: stop, livePrice, distancePct, level });
    }
    return result;
  }, [positions, livePrices]);

  // Fire side effects (notifications + onAlert) in an effect, never during render
  useEffect(() => {
    for (const alert of alerts) {
      if (alert.level === "safe") {
        prevLevels.current[alert.id] = "safe";
        continue;
      }
      const prevLevel = prevLevels.current[alert.id];
      const lastNotified = lastNotifiedAt.current[alert.symbol] ?? 0;
      const cooldownPassed = Date.now() - lastNotified > NOTIFICATION_COOLDOWN_MS;

      if (cooldownPassed && (prevLevel === "safe" || prevLevel === undefined || alert.level === "danger")) {
        fireNotification(alert.symbol, alert.livePrice, alert.stopLoss, alert.level);
        lastNotifiedAt.current[alert.symbol] = Date.now();
        onAlertRef.current?.(alert);
      }
      prevLevels.current[alert.id] = alert.level;
    }
  }, [alerts]);

  return alerts;
}
