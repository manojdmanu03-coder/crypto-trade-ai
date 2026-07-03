import { signHmacSha256 } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";

export function symbolToPair(symbol: string): string {
  if (symbol.endsWith("USDT")) return `B-${symbol.slice(0, -4)}_USDT`;
  if (symbol.endsWith("INR")) return `B-${symbol.slice(0, -3)}_INR`;
  return symbol;
}

const COINDCX_BASE_URL = "https://api.coindcx.com";
const PUBLIC_BASE_URL = "https://public.coindcx.com";

export interface CoinDCXCandle {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface CoinDCXTicker {
  market: string;
  last_price: string;
  high: string;
  low: string;
  volume: string;
  change_24_hour: string;
}

export class CoinDCXClient {
  private apiKey: string;
  private apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private async publicRequest<T>(path: string): Promise<T> {
    const url = `${PUBLIC_BASE_URL}${path}`;
    try {
      const resp = await fetch(url, {
        headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok) throw new Error(`CoinDCX public API error: ${resp.status}`);
      return resp.json() as Promise<T>;
    } catch (err) {
      logger.error({ err, path }, "CoinDCX public request failed");
      throw err;
    }
  }

  private async privateRequest<T>(path: string, body: object = {}): Promise<T> {
    const timestamp = Date.now();
    const payload = JSON.stringify({ ...body, timestamp });
    const signature = signHmacSha256(this.apiSecret, payload);
    const url = `${COINDCX_BASE_URL}${path}`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AUTH-APIKEY": this.apiKey,
          "X-AUTH-SIGNATURE": signature,
        },
        body: payload,
      });
      if (!resp.ok) throw new Error(`CoinDCX private API error: ${resp.status}`);
      return resp.json() as Promise<T>;
    } catch (err) {
      logger.error({ err, path }, "CoinDCX private request failed");
      throw err;
    }
  }

  async getCandles(
    symbol: string,
    interval: string = "1h",
    limit: number = 100
  ): Promise<CoinDCXCandle[]> {
    const pair = symbolToPair(symbol);
    const path = `/market_data/candles?pair=${pair}&interval=${interval}&limit=${limit}`;
    return this.publicRequest<CoinDCXCandle[]>(path);
  }

  async getTicker(symbol: string): Promise<CoinDCXTicker | null> {
    const tickers = await this.publicRequest<CoinDCXTicker[]>("/market_data/trade_history?pair=B-BTC_USDT&limit=1");
    return tickers?.[0] ?? null;
  }

  async getAllTickers(): Promise<CoinDCXTicker[]> {
    return this.publicRequest<CoinDCXTicker[]>("/exchange/ticker");
  }

  async getBalances(): Promise<Array<{ currency: string; balance: string; locked_balance: string }>> {
    return this.privateRequest("/exchange/v1/users/balances");
  }

  async createOrder(params: {
    market: string;
    side: "buy" | "sell";
    order_type: "market_order" | "limit_order";
    quantity: number;
    price?: number;
  }): Promise<{ id: string; status: string }> {
    return this.privateRequest("/exchange/v1/orders/create", params);
  }
}

let clientInstance: CoinDCXClient | null = null;

export function getClient(apiKey: string, apiSecret: string): CoinDCXClient {
  if (!clientInstance || (apiKey && apiSecret)) {
    clientInstance = new CoinDCXClient(apiKey, apiSecret);
  }
  return clientInstance;
}
