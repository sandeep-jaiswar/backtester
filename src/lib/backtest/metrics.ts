import type { EngineResult, Metrics, Trade } from "./types";

const TRADING_DAYS = 252;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Computes summary statistics from an engine run. Returns are based on bar-close equity. */
export function computeMetrics(result: EngineResult, dates: Date[]): Metrics {
  const { equity, trades, barsInMarket } = result;
  const startValue = equity[0];
  const endValue = equity[equity.length - 1];

  const totalReturn = endValue / startValue - 1;
  const years = (dates[dates.length - 1].getTime() - dates[0].getTime()) / MS_PER_YEAR;
  const cagr = years > 0 ? Math.pow(endValue / startValue, 1 / years) - 1 : 0;

  const dailyReturns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    dailyReturns.push(equity[i - 1] === 0 ? 0 : equity[i] / equity[i - 1] - 1);
  }
  const mean = avg(dailyReturns);
  const sd = stdev(dailyReturns, mean);
  const volatility = sd * Math.sqrt(TRADING_DAYS);
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(TRADING_DAYS) : 0;

  const maxDd = maxDrawdown(equity);
  const calmar = maxDd < 0 ? cagr / Math.abs(maxDd) : 0;

  return {
    startValue: round(startValue),
    endValue: round(endValue),
    totalReturnPct: round(totalReturn * 100),
    cagrPct: round(cagr * 100),
    maxDrawdownPct: round(maxDd * 100),
    volatilityPct: round(volatility * 100),
    sharpe: round(sharpe),
    calmar: round(calmar),
    ...tradeStats(trades),
    exposurePct: round((barsInMarket / equity.length) * 100),
  };
}

function tradeStats(trades: Trade[]) {
  const count = trades.length;
  if (count === 0) {
    return {
      tradeCount: 0,
      winRatePct: 0,
      avgTradeReturnPct: 0,
      profitFactor: 0,
      avgBarsHeld: 0,
    };
  }
  const wins = trades.filter((t) => t.pnl > 0);
  const grossWin = sum(wins.map((t) => t.pnl));
  const grossLoss = Math.abs(sum(trades.filter((t) => t.pnl < 0).map((t) => t.pnl)));
  return {
    tradeCount: count,
    winRatePct: round((wins.length / count) * 100),
    avgTradeReturnPct: round(avg(trades.map((t) => t.returnPct))),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : grossWin > 0 ? Infinity : 0,
    avgBarsHeld: round(avg(trades.map((t) => t.barsHeld)), 1),
  };
}

/** Drawdown as a negative fraction, e.g. -0.25 for a 25% peak-to-trough fall. */
export function drawdownSeries(equity: number[]): number[] {
  let peak = -Infinity;
  return equity.map((v) => {
    peak = Math.max(peak, v);
    return peak > 0 ? v / peak - 1 : 0;
  });
}

function maxDrawdown(equity: number[]): number {
  return Math.min(0, ...drawdownSeries(equity));
}

function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
function avg(xs: number[]) {
  return xs.length ? sum(xs) / xs.length : 0;
}
function stdev(xs: number[], mean: number) {
  if (xs.length < 2) return 0;
  const variance = sum(xs.map((x) => (x - mean) ** 2)) / (xs.length - 1);
  return Math.sqrt(variance);
}
function round(n: number, dp = 2) {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
