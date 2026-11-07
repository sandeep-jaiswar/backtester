import type { BenchmarkStats } from "./types";
import { TRADING_DAYS_PER_YEAR } from "./config";

/**
 * Pure analytics over an equity curve and its dates. No I/O, so it runs on the server and in the browser.
 * Equity is marked to bar close. Dates are YYYY-MM-DD strings aligned with the equity array.
 */

const TD = TRADING_DAYS_PER_YEAR;

/** Compares a strategy with a benchmark over the same bars. Returns null if the series cannot be compared. */
export function benchmarkStats(
  equity: number[],
  benchEquity: number[],
  riskFreeRatePct = 0,
): BenchmarkStats | null {
  if (equity.length !== benchEquity.length || equity.length < 3) return null;
  const rs = dailyReturns(equity);
  const rb = dailyReturns(benchEquity);
  const n = rs.length;
  const rfDaily = riskFreeRatePct / 100 / TD;

  const meanS = avg(rs);
  const meanB = avg(rb);
  let cov = 0;
  for (let i = 0; i < n; i++) cov += (rs[i] - meanS) * (rb[i] - meanB);
  cov /= n - 1;
  const varB = sampleVariance(rb, meanB);
  const beta = varB > 0 ? cov / varB : 0;

  const alphaDaily = meanS - rfDaily - beta * (meanB - rfDaily);

  const active = rs.map((r, i) => r - rb[i]);
  const meanActive = avg(active);
  const trackingDaily = stdev(active, meanActive);
  const informationRatio = trackingDaily > 0 ? (meanActive / trackingDaily) * Math.sqrt(TD) : 0;

  return {
    alphaPct: round(alphaDaily * TD * 100),
    beta: round(beta, 3),
    informationRatio: round(informationRatio),
    trackingErrorPct: round(trackingDaily * Math.sqrt(TD) * 100),
    upCapturePct: capture(rs, rb, (b) => b > 0),
    downCapturePct: capture(rs, rb, (b) => b < 0),
  };
}

/** Mean strategy return over the selected benchmark days, divided by the mean benchmark return on those days. */
function capture(rs: number[], rb: number[], pick: (b: number) => boolean): number | null {
  const days: number[] = [];
  for (let i = 0; i < rb.length; i++) if (pick(rb[i])) days.push(i);
  if (days.length === 0) return null;
  const meanB = avg(days.map((i) => rb[i]));
  if (meanB === 0) return null;
  return round((avg(days.map((i) => rs[i])) / meanB) * 100);
}

export interface DrawdownEpisode {
  startDate: string;
  troughDate: string;
  /** Null while the curve has not yet regained the starting peak. */
  recoveryDate: string | null;
  depthPct: number;
  /** Bars from the peak to recovery, or to the last bar if not yet recovered. */
  bars: number;
}

/** The deepest drawdowns, from peak to trough to recovery, sorted by depth (worst first). */
export function drawdownEpisodes(equity: number[], dates: string[], limit = 5): DrawdownEpisode[] {
  type Raw = { peak: number; trough: number; recovery: number | null };
  const raw: Raw[] = [];
  let peak = 0;
  let trough = -1;
  let troughValue = Infinity;
  let inDrawdown = false;

  for (let i = 0; i < equity.length; i++) {
    if (equity[i] >= equity[peak]) {
      if (inDrawdown) raw.push({ peak, trough, recovery: i });
      inDrawdown = false;
      peak = i;
      trough = -1;
      troughValue = Infinity;
    } else {
      inDrawdown = true;
      if (equity[i] < troughValue) {
        troughValue = equity[i];
        trough = i;
      }
    }
  }
  if (inDrawdown) raw.push({ peak, trough, recovery: null });

  return raw
    .map((e) => ({
      startDate: dates[e.peak],
      troughDate: dates[e.trough],
      recoveryDate: e.recovery === null ? null : dates[e.recovery],
      depthPct: round((equity[e.trough] / equity[e.peak] - 1) * 100),
      bars: (e.recovery ?? equity.length - 1) - e.peak,
    }))
    .sort((a, b) => a.depthPct - b.depthPct)
    .slice(0, limit);
}

export interface MonthlyReturn {
  year: number;
  /** 1-12 */
  month: number;
  returnPct: number;
}

/** Return for each calendar month, from the last equity value of the previous month. The first month starts from the first equity value. */
export function monthlyReturns(equity: number[], dates: string[]): MonthlyReturn[] {
  if (equity.length === 0) return [];
  const monthEnds: { key: string; value: number }[] = [];
  for (let i = 0; i < equity.length; i++) {
    const key = dates[i].slice(0, 7);
    const last = monthEnds[monthEnds.length - 1];
    if (last && last.key === key) last.value = equity[i];
    else monthEnds.push({ key, value: equity[i] });
  }
  let prev = equity[0];
  return monthEnds.map(({ key, value }) => {
    const r = {
      year: Number(key.slice(0, 4)),
      month: Number(key.slice(5, 7)),
      returnPct: round(prev === 0 ? 0 : (value / prev - 1) * 100),
    };
    prev = value;
    return r;
  });
}

function dailyReturns(equity: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    out.push(equity[i - 1] === 0 ? 0 : equity[i] / equity[i - 1] - 1);
  }
  return out;
}

function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
function avg(xs: number[]) {
  return xs.length ? sum(xs) / xs.length : 0;
}
function sampleVariance(xs: number[], mean: number) {
  if (xs.length < 2) return 0;
  return sum(xs.map((x) => (x - mean) ** 2)) / (xs.length - 1);
}
function stdev(xs: number[], mean: number) {
  return Math.sqrt(sampleVariance(xs, mean));
}
function round(n: number, dp = 2) {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
