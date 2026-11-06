# Backtester

A personal backtesting app built with Next.js. It runs long-only strategies on daily Yahoo Finance bars, streams results as they finish, and compares each against a buy-and-hold benchmark.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests for engine, fees, metrics, manifests, validation
npm run verify     # synthetic-path sanity checks for the engine and strategies
npm run verify:nse # NSE endpoint checks (needs network access)
```

## API: `POST /api/backtest`

Request (only `symbol`, `start`, `end` and `runs` are required):

```json
{
  "symbol": "RELIANCE.NS",
  "start": "2020-01-01",
  "end": "2024-12-31",
  "capital": 100000,
  "commissionBps": 10,
  "slippageBps": 5,
  "costProfile": "india-delivery",
  "riskFreeRatePct": 6.5,
  "runs": [{ "strategyId": "sma-crossover", "params": { "fast": 20, "slow": 50 } }]
}
```

- `costProfile`: `flat` (uses `commissionBps` on both sides) or `india-delivery` (NSE/BSE delivery charges: STT, exchange charges, SEBI fee, stamp duty on buy, and GST). If omitted, `.NS` and `.BO` symbols get `india-delivery` and everything else gets `flat`.
- `riskFreeRatePct`: annual rate used for Sharpe and Sortino. Defaults to `0`.

The response is newline-delimited JSON:

1. `data`: resolved currency, the trading dates, and `datasetHash`, a SHA-256 of the bars used.
2. `result`, one per run in completion order. The benchmark has `index: -1`. Each result includes `metrics`, `equity`, `trades`, and a `manifest`.
3. `error`, only for a failed run or a failed data fetch.
4. `done`.

### Reproducing a run

Each `manifest` holds every input that affects the result: symbol, dates, dataset hash, capital, cost model, slippage, risk-free rate, strategy, and parameters. `runId` is the first 16 hex characters of a SHA-256 over those inputs and `engineVersion`. Equal inputs give an equal `runId`, so you can match a saved result to a rerun. `ENGINE_VERSION` in `src/lib/backtest/config.ts` changes whenever the maths changes.

## Engine conventions

- A signal that is `true` at the close of bar *i* fills at the open of bar *i+1*. Strategies must only read bars `0..i`.
- A buy spends all available cash, with the buy fee taken out of the share count. A sell pays its fee out of proceeds.
- Trade P&L is measured against the full cash spent on entry, including the buy fee.
- A position still open on the last bar is closed at that close and marked `openAtEnd`.
- `profitFactor` is `null` when there are no losing trades. It is never `Infinity`, because JSON turns that into `null` silently.

## Cost profiles

Rates live in `src/lib/backtest/costs.ts`. Statutory and exchange rates change, and brokerage varies by broker. Check the table against current circulars before relying on the India profile. The DP charge is a fixed INR amount, so it is not modelled.

## Run history (Neon Postgres)

Every finished run is saved to the `backtest_runs` table, keyed by its manifest `runId`. Saving the same run again is a no-op. The table is created on first use.

- `GET /api/runs?limit=50`: recent runs, newest first, with headline metrics.
- `GET /api/runs/<runId>`: one run with its manifest, metrics, trades, and equity curve.

Set `DATABASE_URL` to enable this. Without it, backtests still run and the run endpoints return 503. A database error is logged and never fails a backtest.

## Adding a strategy

Create a file in `src/lib/strategies/` that exports a `Strategy`, then add it to the array in `src/lib/strategies/index.ts`. It appears in the API and the UI automatically.

## Data

Bars come from Yahoo Finance through `yahoo-finance2`. They are cached in memory for six hours per server instance, keyed by symbol and date range. Failed fetches are not cached. This is an unofficial source, so treat it as a development data source.
