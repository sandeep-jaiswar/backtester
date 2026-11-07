# Backtester

A personal backtesting app built with Next.js. It runs long-only strategies on daily Yahoo Finance bars, streams results as they finish, and compares each against a buy-and-hold benchmark. You can write strategies without code, optimise their parameters with validation, save runs to a database, and compare them.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests: engine, risk controls, analytics, fees, metrics, manifests, rules, optimiser
npm run verify     # synthetic-path sanity checks for the engine and strategies
npm run verify:nse # NSE endpoint checks (needs network access)
```

Pages: `/` (backtest), `/optimize`, `/strategies` (rule builder), `/runs` (history), `/runs/<runId>` (one run), `/compare`.

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
  "stopLossPct": 8,
  "takeProfitPct": 20,
  "positionFraction": 0.5,
  "runs": [
    { "strategyId": "sma-crossover", "params": { "fast": 20, "slow": 50 } },
    { "strategyId": "custom:a1b2c3d4", "params": {} }
  ]
}
```

- `costProfile`: `flat` (uses `commissionBps` on both sides) or `india-delivery` (NSE/BSE delivery charges: STT, exchange charges, SEBI fee, stamp duty on buy, and GST). If omitted, `.NS` and `.BO` symbols get `india-delivery` and everything else gets `flat`.
- `riskFreeRatePct`: annual rate used for Sharpe, Sortino and alpha. Defaults to `0`.
- `stopLossPct`, `takeProfitPct`: optional protective exits, in percent from the entry fill. See *Risk controls*.
- `positionFraction`: optional share of available cash spent on each entry, from above 0 to 1. Omit for all-in.
- `strategyId`: a built-in id, or `custom:<id>` for a rule strategy saved in the builder.

The response is newline-delimited JSON:

1. `data`: resolved currency, the trading dates, and `datasetHash`, a SHA-256 of the bars used.
2. `result`: the buy-and-hold benchmark first (`index: -1`), then the requested runs in the order they finish. Each result includes `metrics`, `equity`, `trades`, and a `manifest`.
3. `error`, only for a failed run or a failed data fetch.
4. `done`.

### Reproducing a run

Each `manifest` holds every input that affects the result: symbol, dates, dataset hash, capital, cost model, slippageBps, risk-free rate, risk controls (only when set), strategy, and parameters. `runId` is the first 16 hex characters of a SHA-256 over those inputs and `engineVersion`. Equal inputs give an equal `runId`. Optional keys that are not set are left out of the hash, so runs made before an option existed keep their IDs. `ENGINE_VERSION` in `src/lib/backtest/config.ts` changes only when results for the same inputs would change.

## API: strategies and optimisation

- `GET /api/strategies`, `POST /api/strategies`, `GET|PUT|DELETE /api/strategies/<id>`: custom rule strategies. Stored in Neon, so these return 503 without `DATABASE_URL`.
- `POST /api/optimize`: grid search over parameters, streamed as NDJSON (`progress`, `result`, `done`). Limits: at most 500 combinations and 4 axes. Validation modes:
  - `none`: rank every combination on the full period.
  - `split`: fit on the first part of the data (`trainFraction` 0.3–0.9), report the best combination out of sample.
  - `walkForward`: anchored folds (2–10). Each fold optimises on every bar before its test window, then tests the chosen combination on that window. The test windows are chained into one out-of-sample curve.
- The result warns when there are more than 50 combinations, when out-of-sample results are below half the in-sample figure, when out-of-sample returns are negative, and when there are fewer than 10 out-of-sample trades.

### Rule strategies

A rule strategy has up to 8 parameters, an entry rule and an exit rule. Each rule is up to 6 comparisons joined with AND or OR. Operands are `close`, `open`, `high`, `low`, `volume`, `sma`, `ema`, `rsi`, `atr`, `priorHigh` and `priorLow`, or a parameter. Operators are `gt`, `lt`, `gte`, `lte`, `crossesAbove` and `crossesBelow`. The position goes long when the entry rule first becomes true and exits when the exit rule becomes true. Indicators use only bars up to the current one, and a value still in its warm-up period never triggers a comparison. A test checks that changing future bars does not change earlier signals.

## Risk controls

Turn these on with the optional request fields, or in the *Risk controls* card on the backtest page.

- **Stop-loss** (`stopLossPct`): exits when the bar's low reaches the stop, which is that percentage below the entry fill. If the bar opens below the stop, the exit is at the open.
- **Take-profit** (`takeProfitPct`): exits when the bar's high reaches the target. If the bar opens above it, the exit is at the open.
- If both levels are reached on the same bar, the stop is taken. The order of moves inside a bar is unknown, so the stop is the conservative choice.
- After a stop-out, the strategy stays flat until its entry rule has gone false and then true again. It does not re-enter straight away.
- Each trade records its `exitReason`: `signal`, `stop`, `target` or `end`.
- **Position fraction** (`positionFraction`): each entry spends that share of the cash on hand. The rest stays idle and counts towards equity.

## Analytics

Shown for the selected strategy on the backtest page and for each saved run.

- **Versus buy & hold**: CAPM alpha (annualised, with the risk-free rate), beta, information ratio, tracking error, and up and down capture. Buy and hold is the benchmark, on the same symbol and dates. The PRD names NIFTY 50 as the default index benchmark; that is not built yet.
- **Underwater chart**: distance below the previous peak at each close.
- **Worst drawdowns**: the five deepest falls, with peak, trough and the date the peak was regained.
- **Monthly returns**: month-end to month-end, with a compounded year column.
- **Excel report**: a workbook with a Summary sheet (metrics, benchmark, and reproducibility fields), Trades, Equity with drawdown, Drawdowns, and Monthly returns. It includes the disclaimer. It is built in the browser.

Runs saved before dates were stored have no drawdown or monthly views.

## Engine conventions

- A signal that is `true` at the close of bar *i* fills at the open of bar *i+1*. Strategies must only read bars `0..i`.
- A buy spends the available cash, with the buy fee taken out of the share count. A sell pays its fee out of proceeds.
- Trade P&L is measured against the full cash spent on entry, including the buy fee.
- A position still open on the last bar is closed at that close and marked `openAtEnd`.
- `profitFactor` is `null` when there are no losing trades. It is never `Infinity`, because JSON turns that into `null` silently.

## Cost profiles

Rates live in `src/lib/backtest/costs.ts`. Statutory and exchange rates change, and brokerage varies by broker. Check the table against current circulars before relying on the India profile. The DP charge is a fixed INR amount, so it is not modelled.

## Run history (Neon Postgres)

Every finished run is saved to the `backtest_runs` table, keyed by its manifest `runId`. Saving the same run again is a no-op. Custom strategies are kept in `custom_strategies`. Tables are created on first use.

- `GET /api/runs?limit=50`: recent runs, newest first, with headline metrics.
- `GET /api/runs/<runId>`: one run with its manifest, metrics, trades, and equity curve.

Set `DATABASE_URL` to enable this. Without it, backtests and optimisation still run, and the database endpoints return 503. A database error is logged and never fails a backtest.

## Adding a strategy

Either build one in `/strategies` (no code, saved to the database), or create a file in `src/lib/strategies/` that exports a `Strategy` and add it to the array in `src/lib/strategies/index.ts`. Built-in strategies appear in the API and the UI automatically.

## Not built yet

From the PRD: a multi-asset portfolio engine, Monte Carlo resampling, a PDF tearsheet, scheduled runs, auth and per-user data, the public `/v1` API, index benchmarks such as NIFTY 50, and volatility-targeted sizing. Live trading is out of scope.

## Data

Bars come from Yahoo Finance through `yahoo-finance2`. They are cached in memory for six hours per server instance, keyed by symbol and date range. Failed fetches are not cached. This is an unofficial source, so treat it as a development data source.
