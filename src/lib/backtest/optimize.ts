import type { Bar, BacktestConfig, EngineResult, Metrics, Strategy, Trade } from "./types";
import { runBacktest } from "./engine";
import { computeMetrics } from "./metrics";
import { resolveParams } from "../strategies";

/**
 * Parameter search with out-of-sample validation. Pure: takes bars, returns results, no I/O.
 *
 * Modes:
 * - none: grid over the full range. Quick, but every result is in-sample.
 * - split: optimise on the first `trainFraction` of bars, then test the best combination on the rest.
 * - walkForward: anchored folds. For each fold, optimise on everything before the test window,
 *   then test the chosen combination on the window. The out-of-sample windows are chained together.
 *
 * Signals are computed once per combination on the full series. Each window only reads bars up to
 * its own end, so no window ever uses future data.
 */

export const OPTIMIZE_METRICS = ["sharpe", "sortino", "cagrPct", "calmar", "totalReturnPct"] as const;
export type OptimizeMetric = (typeof OPTIMIZE_METRICS)[number];

export const MAX_GRID_COMBOS = 500;
export const MAX_GRID_AXES = 4;
const MAX_RANKING_ROWS = 100;
const MANY_TRIALS = 50;

export interface GridAxis {
  key: string;
  min: number;
  max: number;
  step: number;
}

export type ValidationMode =
  | { mode: "none" }
  | { mode: "split"; trainFraction: number }
  | { mode: "walkForward"; folds: number };

export interface Stats {
  metric: number;
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  tradeCount: number;
  winRatePct: number;
}

export interface RankRow {
  params: Record<string, number>;
  inSample: Stats;
  outOfSample?: Stats;
}

export interface FoldResult {
  fold: number;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  bestParams: Record<string, number>;
  trainMetric: number;
  outOfSample: Stats;
}

export interface OptimizeResult {
  metric: OptimizeMetric;
  mode: ValidationMode["mode"];
  trialCount: number;
  bestParams: Record<string, number>;
  /** Top combinations by the chosen metric, best first. In-sample is the training window for split and walk-forward. */
  ranking: RankRow[];
  folds?: FoldResult[];
  /** Out-of-sample result. Test window for split, chained folds for walk-forward. */
  outOfSample?: { stats: Stats; dates: string[]; equity: number[] };
  warnings: string[];
}

export interface OptimizeOptions {
  bars: Bar[];
  strategy: Strategy;
  config: BacktestConfig;
  riskFreeRatePct: number;
  axes: GridAxis[];
  validation: ValidationMode;
  metric: OptimizeMetric;
  onProgress?: (done: number, total: number) => void;
}

/** Number of values on one axis, inclusive of both ends. */
function axisCount(axis: GridAxis): number {
  return Math.floor((axis.max - axis.min) / axis.step + 1e-9) + 1;
}

export function gridSize(axes: GridAxis[]): number {
  return axes.reduce((n, a) => n * axisCount(a), 1);
}

/** Every combination on the grid, with unspecified parameters at their defaults. Duplicates (from integer rounding) are removed. */
export function expandGrid(strategy: Strategy, axes: GridAxis[]): Record<string, number>[] {
  if (axes.length === 0) throw new Error("Pick at least one parameter to optimise");
  if (axes.length > MAX_GRID_AXES) throw new Error(`Optimise at most ${MAX_GRID_AXES} parameters at once`);
  for (const a of axes) {
    if (!strategy.params.some((p) => p.key === a.key)) throw new Error(`Unknown parameter ${a.key}`);
    if (!(a.step > 0)) throw new Error(`Step for ${a.key} must be positive`);
    if (a.min > a.max) throw new Error(`Min for ${a.key} must not exceed max`);
  }
  const size = gridSize(axes);
  if (size > MAX_GRID_COMBOS) {
    throw new Error(`The grid has ${size} combinations; the limit is ${MAX_GRID_COMBOS}. Narrow a range or widen a step.`);
  }

  const defaults = Object.fromEntries(strategy.params.map((p) => [p.key, p.default]));
  let combos: Record<string, number>[] = [{}];
  for (const axis of axes) {
    const next: Record<string, number>[] = [];
    for (const partial of combos) {
      for (let k = 0; k < axisCount(axis); k++) {
        const v = Math.min(axis.max, axis.min + k * axis.step);
        next.push({ ...partial, [axis.key]: v });
      }
    }
    combos = next;
  }

  const seen = new Set<string>();
  const out: Record<string, number>[] = [];
  for (const c of combos) {
    const resolved = resolveParams(strategy, { ...defaults, ...c });
    const key = JSON.stringify(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

interface Window {
  start: number;
  end: number;
}

function evalWindow(
  bars: Bar[],
  signals: boolean[],
  config: BacktestConfig,
  riskFreeRatePct: number,
  w: Window,
): { metrics: Metrics; result: EngineResult; dates: string[] } {
  const slice = bars.slice(w.start, w.end);
  const result = runBacktest(slice, signals.slice(w.start, w.end), config);
  const metrics = computeMetrics(result, slice.map((b) => b.date), { riskFreeRatePct });
  return { metrics, result, dates: slice.map((b) => isoDate(b.date)) };
}

function pick(m: Metrics | Stats, metric: OptimizeMetric): number {
  const v = m[metric];
  return Number.isFinite(v) ? v : -Infinity;
}

function toStats(m: Metrics, metric: OptimizeMetric): Stats {
  return {
    metric: pick(m, metric),
    totalReturnPct: m.totalReturnPct,
    cagrPct: m.cagrPct,
    maxDrawdownPct: m.maxDrawdownPct,
    sharpe: m.sharpe,
    sortino: m.sortino,
    calmar: m.calmar,
    tradeCount: m.tradeCount,
    winRatePct: m.winRatePct,
  };
}

function bestIndex(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

/** Window boundaries for anchored walk-forward: b[0]=0 ... b[folds+1]=N. Fold j tests [b[j], b[j+1]). */
function walkForwardBounds(n: number, folds: number): number[] {
  return Array.from({ length: folds + 2 }, (_, k) => Math.round((k * n) / (folds + 1)));
}

function validate(n: number, validation: ValidationMode) {
  if (validation.mode === "split") {
    const cut = Math.floor(n * validation.trainFraction);
    if (!(validation.trainFraction >= 0.3 && validation.trainFraction <= 0.9)) {
      throw new Error("Train fraction must be between 0.3 and 0.9");
    }
    if (cut < 30 || n - cut < 20) {
      throw new Error(`Not enough bars for a split: ${n} bars gives ${cut} to train and ${n - cut} to test`);
    }
  }
  if (validation.mode === "walkForward") {
    const { folds } = validation;
    if (!Number.isInteger(folds) || folds < 2 || folds > 10) throw new Error("Folds must be a whole number from 2 to 10");
    const b = walkForwardBounds(n, folds);
    if (b[1] < 30) throw new Error("The first training window is too short. Use more bars or fewer folds.");
    for (let k = 1; k <= folds; k++) {
      if (b[k + 1] - b[k] < 20) throw new Error("Each test window needs at least 20 bars. Use more bars or fewer folds.");
    }
  }
}

export function runOptimization(opts: OptimizeOptions): OptimizeResult {
  const { bars, strategy, config, riskFreeRatePct, axes, validation, metric, onProgress } = opts;
  const n = bars.length;
  validate(n, validation);

  const combos = expandGrid(strategy, axes);
  const signals = combos.map((p) => strategy.signals(bars, p));
  const full: Window = { start: 0, end: n };

  const foldCount = validation.mode === "walkForward" ? validation.folds : 0;
  const total = combos.length * (foldCount + 1);
  let done = 0;
  const tick = () => {
    done++;
    if (done % 10 === 0 || done === total) onProgress?.(done, total);
  };

  const warnings: string[] = [];
  let result: OptimizeResult;

  if (validation.mode === "none") {
    const rows: RankRow[] = combos.map((params, c) => {
      const { metrics } = evalWindow(bars, signals[c], config, riskFreeRatePct, full);
      tick();
      return { params, inSample: toStats(metrics, metric) };
    });
    rows.sort((a, b) => b.inSample.metric - a.inSample.metric);
    result = {
      metric,
      mode: "none",
      trialCount: combos.length,
      bestParams: rows[0].params,
      ranking: rows.slice(0, MAX_RANKING_ROWS),
      warnings,
    };
    const best = rows[0].inSample;
    if (best.tradeCount < 10) warnings.push(`Only ${best.tradeCount} trades in the best combination. Treat it as noisy.`);
  } else if (validation.mode === "split") {
    const cut = Math.floor(n * validation.trainFraction);
    const trainWin: Window = { start: 0, end: cut };
    const testWin: Window = { start: cut, end: n };
    const rows: RankRow[] = combos.map((params, c) => {
      const train = evalWindow(bars, signals[c], config, riskFreeRatePct, trainWin);
      const test = evalWindow(bars, signals[c], config, riskFreeRatePct, testWin);
      tick();
      return { params, inSample: toStats(train.metrics, metric), outOfSample: toStats(test.metrics, metric) };
    });
    rows.sort((a, b) => b.inSample.metric - a.inSample.metric);
    const bestCombo = combos.indexOf(rows[0].params);
    const test = evalWindow(bars, signals[bestCombo], config, riskFreeRatePct, testWin);
    result = {
      metric,
      mode: "split",
      trialCount: combos.length,
      bestParams: rows[0].params,
      ranking: rows.slice(0, MAX_RANKING_ROWS),
      outOfSample: { stats: toStats(test.metrics, metric), dates: test.dates, equity: roundEquity(test.result.equity) },
      warnings,
    };
    addOverfitWarnings(warnings, rows[0].inSample.metric, result.outOfSample!.stats, metric);
  } else {
    const bounds = walkForwardBounds(n, validation.folds);
    const folds: FoldResult[] = [];
    const chainEquity: number[] = [];
    const chainDates: string[] = [];
    const chainTrades: Trade[] = [];
    let chainFees = 0;
    let chainInMarket = 0;

    for (let j = 1; j <= validation.folds; j++) {
      const trainWin: Window = { start: 0, end: bounds[j] };
      const testWin: Window = { start: bounds[j], end: bounds[j + 1] };
      const trainMetrics = combos.map((_, c) => {
        const m = evalWindow(bars, signals[c], config, riskFreeRatePct, trainWin).metrics;
        tick();
        return pick(m, metric);
      });
      const pickIdx = bestIndex(trainMetrics);
      const test = evalWindow(bars, signals[pickIdx], config, riskFreeRatePct, testWin);

      folds.push({
        fold: j,
        trainEnd: isoDate(bars[bounds[j] - 1].date),
        testStart: isoDate(bars[bounds[j]].date),
        testEnd: isoDate(bars[bounds[j + 1] - 1].date),
        bestParams: combos[pickIdx],
        trainMetric: round2(trainMetrics[pickIdx]),
        outOfSample: toStats(test.metrics, metric),
      });

      // Chain fold returns: scale each test window to start where the previous one ended.
      const eq = test.result.equity;
      const scale = chainEquity.length === 0 ? 1 : chainEquity[chainEquity.length - 1] / eq[0];
      const piece = chainEquity.length === 0 ? eq : eq.slice(1);
      for (const v of piece) chainEquity.push(v * scale);
      chainDates.push(...(chainDates.length === 0 ? test.dates : test.dates.slice(1)));
      chainTrades.push(...test.result.trades);
      chainFees += test.result.totalFees;
      chainInMarket += test.result.barsInMarket;
    }

    const chained = computeMetrics(
      { equity: chainEquity, trades: chainTrades, barsInMarket: chainInMarket, totalFees: chainFees },
      chainDates.map((d) => new Date(`${d}T00:00:00Z`)),
      { riskFreeRatePct },
    );

    // Full-range ranking gives the reference in-sample view.
    const rows: RankRow[] = combos.map((params, c) => {
      const { metrics } = evalWindow(bars, signals[c], config, riskFreeRatePct, full);
      tick();
      return { params, inSample: toStats(metrics, metric) };
    });
    rows.sort((a, b) => b.inSample.metric - a.inSample.metric);

    result = {
      metric,
      mode: "walkForward",
      trialCount: combos.length,
      bestParams: rows[0].params,
      ranking: rows.slice(0, MAX_RANKING_ROWS),
      folds,
      outOfSample: { stats: toStats(chained, metric), dates: chainDates, equity: roundEquity(chainEquity) },
      warnings,
    };
    addOverfitWarnings(warnings, rows[0].inSample.metric, result.outOfSample!.stats, metric);
  }

  if (combos.length > MANY_TRIALS) {
    warnings.unshift(
      `Tested ${combos.length} parameter combinations. The best in-sample result is partly a product of picking the best of many.`,
    );
  }
  return result;
}

function addOverfitWarnings(warnings: string[], isMetric: number, oos: Stats, metric: OptimizeMetric) {
  if (isMetric > 0 && oos.metric < 0.5 * isMetric) {
    warnings.push(
      `Out-of-sample ${metric} is ${round2(oos.metric)} against ${round2(isMetric)} in sample. Much of the in-sample edge may not hold.`,
    );
  }
  if (oos.metric < 0) warnings.push("The out-of-sample result is negative.");
  if (oos.tradeCount < 10) warnings.push(`Only ${oos.tradeCount} out-of-sample trades. Treat the result as noisy.`);
}

function roundEquity(values: number[]): number[] {
  return values.map((v) => Math.round(v * 100) / 100);
}

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : n;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
