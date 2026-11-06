import type { Bar, BacktestConfig, EngineResult, Trade } from "./types";

/**
 * Long-only, all-in / all-out execution engine.
 *
 * - A `true` signal at the close of bar i-1 means "be long": the engine buys at the open of bar i.
 * - A `false` signal means "be flat": the engine sells at the open of bar i.
 * - Fills include slippage and commission on both sides.
 * - Equity is marked to each bar's close.
 * - Any position still open on the last bar is closed at that close and flagged `openAtEnd`.
 */
export function runBacktest(
  bars: Bar[],
  signals: boolean[],
  config: BacktestConfig,
): EngineResult {
  if (signals.length !== bars.length) {
    throw new Error("Signal length must match bar length");
  }

  const comm = config.commissionBps / 10_000;
  const slip = config.slippageBps / 10_000;

  let cash = config.initialCapital;
  let shares = 0;
  let entry: { index: number; date: string; price: number; shares: number } | null = null;

  const equity: number[] = new Array(bars.length);
  const trades: Trade[] = [];
  let barsInMarket = 0;

  const openPosition = (i: number) => {
    const fill = bars[i].open * (1 + slip);
    const budget = cash * (1 - comm);
    shares = budget / fill;
    entry = { index: i, date: iso(bars[i].date), price: fill, shares };
    cash = 0;
  };

  const closePosition = (i: number, price: number, openAtEnd: boolean) => {
    if (!entry) return;
    const proceeds = shares * price * (1 - comm);
    const cost = entry.shares * entry.price;
    const pnl = proceeds - cost;
    trades.push({
      entryDate: entry.date,
      entryPrice: round(entry.price),
      exitDate: iso(bars[i].date),
      exitPrice: round(price),
      shares: round(entry.shares, 4),
      pnl: round(pnl),
      returnPct: round((proceeds / cost - 1) * 100),
      barsHeld: i - entry.index,
      openAtEnd,
    });
    cash = proceeds;
    shares = 0;
    entry = null;
  };

  for (let i = 0; i < bars.length; i++) {
    if (i > 0) {
      const wantLong = signals[i - 1];
      if (wantLong && shares === 0) {
        openPosition(i);
      } else if (!wantLong && shares > 0) {
        closePosition(i, bars[i].open * (1 - slip), false);
      }
    }

    if (shares > 0) barsInMarket++;
    equity[i] = cash + shares * bars[i].close;
  }

  if (shares > 0) {
    closePosition(bars.length - 1, bars[bars.length - 1].close, true);
    // Re-mark the final equity point after the forced close (commission applied).
    equity[bars.length - 1] = cash;
  }

  return { equity, trades, barsInMarket };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
