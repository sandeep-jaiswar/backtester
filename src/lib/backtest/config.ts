/**
 * Single source of truth for backtest constants and defaults.
 * Imported by both server and client code, so keep this file free of imports.
 */

/** Registry id of the benchmark strategy that always runs alongside user strategies. */
export const BENCHMARK_STRATEGY_ID = "buy-and-hold";

/** Annualisation factor for daily bars. Change this if bars ever come from another interval. */
export const TRADING_DAYS_PER_YEAR = 252;

/** Upper bound on strategy runs per request. */
export const MAX_RUNS_PER_REQUEST = 10;

export const DEFAULT_BACKTEST = {
  symbol: "AAPL",
  startDate: "2019-01-01",
  capital: 100_000,
  commissionBps: 10,
  slippageBps: 5,
} as const;
