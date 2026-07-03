# Crypto Trade AI — Dashboard + Paper/Live Trading Engine

A two-part app:

- **`api-server/`** — Express + WebSocket API that runs a simple technical-analysis
  signal engine (RSI/EMA/MACD/SuperTrend), paper-trades or live-trades on CoinDCX,
  and streams live prices over `/ws`.
- **`trading-dashboard/`** — React + Vite dashboard (scanner, positions, trades,
  analytics, settings) that talks to the API.

## What was wrong with the exported project

The `.tar.gz` you uploaded was a partial export of a larger pnpm-workspace
(Replit) monorepo. `api-server` and `trading-dashboard` both imported three
shared workspace packages that **weren't included in the export**:

- `@workspace/db` — a Drizzle ORM + Postgres data layer
- `@workspace/api-zod` — shared Zod request/response schemas
- `@workspace/api-client-react` — an OpenAPI-generated React Query hook client

Without those packages the project couldn't install or build at all. There
were also a few smaller issues once that was fixed:

- `PORT`/`BASE_PATH` env vars were hard-required and threw on startup instead
  of falling back to sane defaults.
- `vite.config.ts` imported Replit-only plugins (`@replit/vite-plugin-*`)
  that don't apply outside Replit.
- Several relative imports were missing the explicit `.js` extension required
  by `"moduleResolution": "NodeNext"`.
- `button.tsx` / `badge.tsx` reference a `hover-elevate` / `active-elevate-2`
  utility and `--primary-border` / `--secondary-border` / `--destructive-border`
  / `--button-outline` theme tokens that were never defined anywhere, so
  buttons and badges rendered with no hover feedback and no outline colors.

## What was fixed

- Rewrote `@workspace/db` as `api-server/src/db/store.ts` — a small in-memory
  data store with the same chainable query API the routes already used
  (`db.select().from(table).where(eq(...)).orderBy(desc(...)).limit(n)`,
  `db.insert(table).values(...).returning()`, etc). No external database to
  install — it just resets when the server restarts, which is fine for a
  paper-trading demo.
- Rewrote `@workspace/api-zod` as `api-server/src/zod/schemas.ts`.
- Rewrote `@workspace/api-client-react` as `trading-dashboard/src/lib/api-client.ts`
  — hand-written React Query hooks (`useGetPositions`, `useToggleEngine`, etc.)
  that call the real REST API.
- Fixed all the import paths, env var defaults, Vite config, and the missing
  CSS utilities/theme tokens described above.
- Wired the API server to serve the dashboard's production build as static
  files, so `npm run build && npm start` runs the whole app from one process.

Everything else — the signal-generation math, risk manager, CoinDCX client,
trading engine loop, and every dashboard page — is the original code,
untouched, since it was already self-consistent.

## Running it

Requires Node.js 18+ and npm.

```bash
# from the project root
npm run install:all   # installs both api-server and trading-dashboard
npm run dev            # runs both dev servers together
```

This starts:
- the API on **http://localhost:3001**
- the dashboard on **http://localhost:5173** (proxies `/api` and `/ws` to the API)

Open http://localhost:5173.

### Running the two apps separately

```bash
cd api-server && npm install && npm run dev      # http://localhost:3001
cd trading-dashboard && npm install && npm run dev # http://localhost:5173
```

### Production build (single server)

```bash
npm run install:all
npm run build   # builds the dashboard, then bundles the API server
npm start       # serves API + built dashboard together on PORT (default 3001)
```

## Notes

- Starts in **paper trading** mode with a simulated $10,000 balance — no
  real money, no exchange account needed. Toggle "Engine Control → START"
  on the dashboard home page to let it scan the watchlist and paper-trade.
- Market data (scanner prices, candles, live ticker) is simulated —
  there's no live CoinDCX connection unless you switch to **live mode** in
  Settings and add a CoinDCX API key/secret, in which case it also fetches
  real balances/candles from CoinDCX's public + authenticated endpoints.
- All data (trades, positions, settings) lives in memory and resets when
  the API server restarts.
