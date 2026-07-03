/**
 * Lightweight in-memory "database" that stands in for the original
 * `@workspace/db` monorepo package (which was not included in the
 * exported project and depended on a Postgres connection that isn't
 * available in this environment).
 *
 * It intentionally mimics the small slice of the drizzle-orm query
 * builder API that the routes/engine code uses:
 *
 *   db.select().from(table).where(eq(col, val)).orderBy(desc(col)).limit(n)
 *   db.insert(table).values({...}).returning()
 *   db.update(table).set({...}).where(eq(col, val)).returning()
 *
 * Data lives in memory for the lifetime of the process. That's fine for
 * this paper-trading demo app — restart the server to reset all data.
 */

export type Row = Record<string, any>;

export interface ColumnRef {
  __table: string;
  __column: string;
}

class Table {
  __name: string;
  __columns: string[];
  [key: string]: any;

  constructor(name: string, columns: string[]) {
    this.__name = name;
    this.__columns = columns;
    for (const col of columns) {
      (this as any)[col] = { __table: name, __column: col } as ColumnRef;
    }
  }
}

function isColumnRef(v: any): v is ColumnRef {
  return v && typeof v === "object" && "__table" in v && "__column" in v;
}

// ---- condition helpers (stand-ins for drizzle-orm's eq/desc/and/isNotNull) ----

export interface Condition {
  test(row: Row): boolean;
}

export function eq(col: ColumnRef, value: any): Condition {
  return { test: (row) => row[col.__column] === value };
}

export function isNotNull(col: ColumnRef): Condition {
  return {
    test: (row) => row[col.__column] !== null && row[col.__column] !== undefined,
  };
}

export function and(...conditions: Condition[]): Condition {
  return { test: (row) => conditions.every((c) => c.test(row)) };
}

export interface OrderSpec {
  col: ColumnRef;
  direction: "asc" | "desc";
}

export function desc(col: ColumnRef): OrderSpec {
  return { col, direction: "desc" };
}

export function asc(col: ColumnRef): OrderSpec {
  return { col, direction: "asc" };
}

function compareValues(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av === bv) return 0;
  return av > bv ? 1 : -1;
}

// ---- storage ----

const storage = new Map<string, Row[]>();
const autoIncrement = new Map<string, number>();

function tableRows(name: string): Row[] {
  if (!storage.has(name)) storage.set(name, []);
  return storage.get(name)!;
}

function nextId(name: string): number {
  const current = (autoIncrement.get(name) ?? 0) + 1;
  autoIncrement.set(name, current);
  return current;
}

// ---- query builders ----

class SelectBuilder implements PromiseLike<Row[]> {
  private table: Table | null = null;
  private fields: Record<string, ColumnRef> | null;
  private condition: Condition | null = null;
  private order: OrderSpec | null = null;
  private limitCount: number | null = null;

  constructor(fields: Record<string, ColumnRef> | null = null) {
    this.fields = fields;
  }

  from(table: Table): this {
    this.table = table;
    return this;
  }

  where(condition: Condition): this {
    this.condition = condition;
    return this;
  }

  orderBy(order: OrderSpec): this {
    this.order = order;
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  private execute(): Row[] {
    if (!this.table) return [];
    let rows = [...tableRows(this.table.__name)];

    if (this.condition) {
      rows = rows.filter((row) => this.condition!.test(row));
    }

    if (this.order) {
      const { col, direction } = this.order;
      rows.sort((a, b) => {
        const cmp = compareValues(a[col.__column], b[col.__column]);
        return direction === "desc" ? -cmp : cmp;
      });
    }

    if (this.limitCount !== null) {
      rows = rows.slice(0, this.limitCount);
    }

    if (this.fields) {
      rows = rows.map((row) => {
        const projected: Row = {};
        for (const [alias, colRef] of Object.entries(this.fields!)) {
          projected[alias] = row[colRef.__column];
        }
        return projected;
      });
    }

    // Return shallow copies so callers can't mutate stored rows by accident.
    return rows.map((r) => ({ ...r }));
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

class InsertBuilder implements PromiseLike<Row[]> {
  private table: Table;
  private rowsToInsert: Row[] = [];
  private shouldReturn = false;

  constructor(table: Table) {
    this.table = table;
  }

  values(data: Row | Row[]): this {
    this.rowsToInsert = Array.isArray(data) ? data : [data];
    return this;
  }

  returning(): this {
    this.shouldReturn = true;
    return this;
  }

  private execute(): Row[] {
    const rows = tableRows(this.table.__name);
    const inserted: Row[] = [];

    for (const data of this.rowsToInsert) {
      const row: Row = {
        id: nextId(this.table.__name),
        ...defaultsFor(this.table.__name),
        ...data,
      };
      rows.push(row);
      inserted.push({ ...row });
    }

    return this.shouldReturn ? inserted : [];
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

class UpdateBuilder implements PromiseLike<Row[]> {
  private table: Table;
  private patch: Row = {};
  private condition: Condition | null = null;
  private shouldReturn = false;

  constructor(table: Table) {
    this.table = table;
  }

  set(data: Row): this {
    this.patch = data;
    return this;
  }

  where(condition: Condition): this {
    this.condition = condition;
    return this;
  }

  returning(): this {
    this.shouldReturn = true;
    return this;
  }

  private execute(): Row[] {
    const rows = tableRows(this.table.__name);
    const updated: Row[] = [];

    for (let i = 0; i < rows.length; i++) {
      if (this.condition && !this.condition.test(rows[i])) continue;
      rows[i] = { ...rows[i], ...this.patch };
      updated.push({ ...rows[i] });
    }

    return this.shouldReturn ? updated : [];
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

// ---- default value generators per table ----

function defaultsFor(tableName: string): Row {
  const now = new Date();
  switch (tableName) {
    case "positions":
      return {
        unrealizedPnl: "0",
        unrealizedPnlPercent: "0",
        riskAmount: "0",
        isOpen: true,
        openedAt: now,
        closedAt: null,
      };
    case "trades":
      return {
        status: "filled",
        pnl: null,
        pnlPercent: null,
        exchangeOrderId: null,
        createdAt: now,
        filledAt: null,
      };
    case "settings":
      return {
        encryptedApiKey: null,
        encryptedApiSecret: null,
        watchedSymbols: [
          "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT",
          "DOTUSDT", "MATICUSDT", "AVAXUSDT", "LINKUSDT", "UNIUSDT",
        ],
        defaultOrderType: "market",
        updatedAt: now,
      };
    case "signals":
      return { createdAt: now };
    case "engine_logs":
      return { symbol: null, createdAt: now };
    default:
      return {};
  }
}

// ---- public db object ----

export const db = {
  select(fields?: Record<string, ColumnRef>) {
    return new SelectBuilder(fields ?? null);
  },
  insert(table: Table) {
    return new InsertBuilder(table);
  },
  update(table: Table) {
    return new UpdateBuilder(table);
  },
};

// ---- table definitions ----

export const positionsTable = new Table("positions", [
  "id", "symbol", "side", "entryPrice", "currentPrice", "quantity",
  "notionalValue", "unrealizedPnl", "unrealizedPnlPercent", "stopLoss",
  "riskAmount", "mode", "openedAt", "closedAt", "isOpen",
]);

export const tradesTable = new Table("trades", [
  "id", "symbol", "side", "orderType", "quantity", "price", "totalValue",
  "status", "pnl", "pnlPercent", "mode", "exchangeOrderId", "createdAt", "filledAt",
]);

export const settingsTable = new Table("settings", [
  "id", "tradingMode", "encryptedApiKey", "encryptedApiSecret",
  "maxConcurrentPositions", "riskPerTrade", "watchedSymbols",
  "scanIntervalSeconds", "defaultOrderType", "stopLossPercent", "updatedAt",
]);

export const signalsTable = new Table("signals", [
  "id", "symbol", "action", "confidence", "reasoning", "rsi", "ema20",
  "ema50", "ema200", "macdLine", "macdSignal", "supertrend", "price", "createdAt",
]);

export const engineLogsTable = new Table("engine_logs", [
  "id", "level", "message", "symbol", "createdAt",
]);
