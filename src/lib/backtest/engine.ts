import type { Bar, BacktestConfig, CostModel, EngineResult, ExitReason, Trade } from "./types";
import { flatCostModel } from "./costs";

/**
 * Long-only execution engine.
 *
 * - A `true` signal at the close of bar i-1 means "be long": the engine buys at the open of bar i.
 * - A `false` signal means "be flat": the engine sells at the open of bar i.
 * - Optional protective exits, checked against each bar's low (stop) and high (target) while long.
 *   Levels are measured from the entry fill. If the open has already gapped through a level, the
 *   exit is at the open. If both levels are touched in one bar, the stop wins, because the order
 *   of intrabar moves is unknown and the stop is the conservative choice.
 *   After a stop-out the engine stays flat until the entry signal has gone false and true again.
 * - `positionFraction` is the share of available cash spent on each entry (1 = all cash).
 * - Fills include slippage. Fees come from the cost model, on both legs.
 * - Trade P&L is measured against the cash spent on entry, including the buy fee.
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

  const cost: CostModel = config.costModel ?? flatCostModel(config.commissionBps);
  const slip = config.slippageBps / 10_000;
  const stopFrac = config.stopLossPct === undefined ? null : config.stopLossPct / 100;
  const targetFrac = config.takeProfitPct === undefined ? null : config.takeProfitPct / 100;
  const fraction = config.positionFraction ?? 1;

  let cash = config.initialCapital;
  let shares = 0;
  let entry: {
    index: number;
    date: string;
    price: number;
    shares: number;
    spent: number;
    fees: number;
    stopPrice: number | null;
    targetPrice: number | null;
  } | null = null;
  let stoppedOut = false;

  const equity: number[] = new Array(bars.length);
  const trades: Trade[] = [];
  let barsInMarket = 0;
  let totalFees = 0;

  const openPosition = (i: number) => {
    const budget = cash * fraction;
    const fill = bars[i].open * (1 + slip);
    const bought = budget / (fill * (1 + cost.rateBuy));
    const fee = bought * fill * cost.rateBuy;
    shares = bought;
    entry = {
      index: i,
      date: iso(bars[i].date),
      price: fill,
      shares,
      spent: budget,
      fees: fee,
      stopPrice: stopFrac === null ? null : fill * (1 - stopFrac),
      targetPrice: targetFrac === null ? null : fill * (1 + targetFrac),
    };
    totalFees += fee;
    cash -= budget;
  };

  const closePosition = (i: number, price: number, reason: ExitReason) => {
    if (!entry) return;
    const notional = shares * price;
    const fee = notional * cost.rateSell + cost.fixedPerSell;
    const proceeds = notional - fee;
    const tradeFees = entry.fees + fee;
    trades.push({
      entryDate: entry.date,
      entryPrice: round(entry.price),
      exitDate: iso(bars[i].date),
      exitPrice: round(price),
      shares: round(entry.shares, 4),
      pnl: round(proceeds - entry.spent),
      returnPct: round((proceeds / entry.spent - 1) * 100),
      barsHeld: i - entry.index,
      fees: round(tradeFees),
      exitReason: reason,
      openAtEnd: reason === "end",
    });
    totalFees += fee;
    cash += proceeds;
    shares = 0;
    entry = null;
  };

  /** Returns the protective exit that fires on this bar, stop before target, or null. */
  const protectiveExit = (bar: Bar): { price: number; reason: ExitReason } | null => {
    if (!entry) return null;
    if (entry.stopPrice !== null && bar.low <= entry.stopPrice) {
      return { price: Math.min(bar.open, entry.stopPrice) * (1 - slip), reason: "stop" };
    }
    if (entry.targetPrice !== null && bar.high >= entry.targetPrice) {
      return { price: Math.max(bar.open, entry.targetPrice) * (1 - slip), reason: "target" };
    }
    return null;
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (i > 0) {
      const wantLong = signals[i - 1];
      if (!wantLong) {
        stoppedOut = false;
        if (shares > 0) closePosition(i, bar.open * (1 - slip), "signal");
      } else if (shares === 0 && !stoppedOut) {
        openPosition(i);
      }
    }

    if (shares > 0) {
      const exit = protectiveExit(bar);
      if (exit) {
        closePosition(i, exit.price, exit.reason);
        stoppedOut = exit.reason === "stop";
      }
    }

    if (shares > 0) barsInMarket++;
    equity[i] = cash + shares * bar.close;
  }

  if (shares > 0) {
    closePosition(bars.length - 1, bars[bars.length - 1].close, "end");
    // Re-mark the final equity point after the forced close (fees applied).
    equity[bars.length - 1] = cash;
  }

  return { equity, trades, barsInMarket, totalFees: round(totalFees) };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
