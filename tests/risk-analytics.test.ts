// Tests for protective exits, position sizing, and the analytics functions.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { runBacktest } from "../src/lib/backtest/engine";
import { benchmarkStats, drawdownEpisodes, monthlyReturns } from "../src/lib/backtest/analytics";
import type { Bar } from "../src/lib/backtest/types";
import { buildManifest } from "../src/lib/backtest/manifest";
import { flatCostModel } from "../src/lib/backtest/costs";

/** Bars from explicit OHLC rows. Dates are consecutive days from 2020-01-01. */
function bars(rows: [open: number, high: number, low: number, close: number][]): Bar[] {
  const start = Date.UTC(2020, 0, 1);
  return rows.map(([open, high, low, close], i) => ({
    date: new Date(start + i * 86_400_000),
    open,
    high,
    low,
    close,
    volume: 1000,
  }));
}

const base = { initialCapital: 10_000, commissionBps: 0, slippageBps: 0 };

// ---------- Protective exits ----------

// Bar 0 sets the signal, bar 1 buys at 100. Stop at 5% = 95, target at 10% = 110.
const path = bars([
  [100, 101, 99, 100], // 0 signal long
  [100, 101, 99, 100], // 1 entry at open 100
  [99, 99.5, 94, 96], // 2 low 94 breaks the stop
  [96, 97, 95, 96], // 3 signal still long, but stopped out: must stay flat
  [96, 97, 95, 96], // 4
]);
const longSignals = [true, true, true, true, true];

test("stop-loss exits at the stop level and stays flat while the signal is still true", () => {
  const r = runBacktest(path, longSignals, { ...base, stopLossPct: 5 });
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.exitReason, "stop");
  assert.equal(t.exitPrice, 95);
  assert.equal(t.exitDate, "2020-01-03");
  assert.equal(t.openAtEnd, false);
});

test("after a stop-out, re-entry needs the signal to go false and then true again", () => {
  // Entry at bar 1 (open 100). Stop hit on bar 2 (low 94). Signal is still true on bars 3-4: stay flat.
  const rows = bars([
    [100, 101, 99, 100],
    [100, 101, 99, 100],
    [99, 99.5, 94, 96],
    [96, 97, 95, 96],
    [96, 97, 95, 96],
    [96, 97, 95, 96], // signal goes false on bar 5, which re-arms the engine
    [96, 97, 95, 96], // signal true again on bar 6: re-enter at this bar's open
  ]);
  const signals = [true, true, true, true, false, true, true];
  const r = runBacktest(rows, signals, { ...base, stopLossPct: 5 });
  assert.equal(r.trades.length, 2);
  assert.equal(r.trades[0].exitReason, "stop");
  assert.equal(r.trades[0].exitDate, "2020-01-03");
  assert.equal(r.trades[1].entryDate, "2020-01-07");
  assert.equal(r.trades[1].exitReason, "end");
});

test("a gap below the stop fills at the open, not at the stop level", () => {
  const rows = bars([
    [100, 101, 99, 100],
    [100, 101, 99, 100], // entry at 100
    [90, 91, 88, 89], // gaps down through 95
  ]);
  const r = runBacktest(rows, [true, true, true], { ...base, stopLossPct: 5 });
  assert.equal(r.trades[0].exitReason, "stop");
  assert.equal(r.trades[0].exitPrice, 90);
});

test("take-profit exits at the target level; a gap above fills at the open", () => {
  const rows = bars([
    [100, 101, 99, 100],
    [100, 101, 99, 100], // entry at 100, target 110
    [100, 111, 99, 108], // high 111 reaches the target
  ]);
  const r = runBacktest(rows, [true, true, true], { ...base, takeProfitPct: 10 });
  assert.equal(r.trades[0].exitReason, "target");
  assert.equal(r.trades[0].exitPrice, 110);

  const gap = bars([
    [100, 101, 99, 100],
    [100, 101, 99, 100],
    [115, 116, 114, 115], // opens above the target
  ]);
  const g = runBacktest(gap, [true, true, true], { ...base, takeProfitPct: 10 });
  assert.equal(g.trades[0].exitPrice, 115);
});

test("when stop and target both fall inside one bar, the stop wins", () => {
  const rows = bars([
    [100, 101, 99, 100],
    [100, 101, 99, 100],
    [100, 115, 90, 100], // range covers both 95 and 110
  ]);
  const r = runBacktest(rows, [true, true, true], { ...base, stopLossPct: 5, takeProfitPct: 10 });
  assert.equal(r.trades[0].exitReason, "stop");
});

test("with no protective levels set, behaviour is the same as before (signal exit only)", () => {
  const rows = bars([
    [100, 101, 99, 100],
    [100, 101, 99, 100],
    [80, 81, 70, 75], // a 25% crash, but no stop is set
    [75, 76, 74, 75],
  ]);
  const r = runBacktest(rows, [true, true, false, false], base);
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].exitReason, "signal");
  assert.equal(r.trades[0].exitPrice, 75);
});

// ---------- Position sizing ----------

test("positionFraction keeps the rest of the cash idle and counts it in equity", () => {
  const flat = bars([
    [100, 100, 100, 100],
    [100, 100, 100, 100],
    [100, 100, 100, 100],
  ]);
  const r = runBacktest(flat, [true, true, true], { ...base, positionFraction: 0.5 });
  assert.deepEqual(r.equity, [10_000, 10_000, 10_000]);

  const up = bars([
    [100, 100, 100, 100],
    [100, 100, 100, 100], // buy 50 shares with 5,000
    [200, 200, 200, 200], // position is worth 10,000, cash 5,000
  ]);
  const u = runBacktest(up, [true, true, true], { ...base, positionFraction: 0.5 });
  assert.equal(u.equity[2], 15_000);
  assert.equal(u.trades.length, 1, "still open on the last bar, closed as openAtEnd");
});

test("fraction 1 is identical to the default all-in sizing", () => {
  const rows = bars([
    [100, 101, 99, 100],
    [100, 101, 99, 100],
    [110, 111, 109, 110],
    [120, 121, 119, 120],
  ]);
  const sig = [true, true, true, false];
  const a = runBacktest(rows, sig, base);
  const b = runBacktest(rows, sig, { ...base, positionFraction: 1 });
  assert.deepEqual(a.equity, b.equity);
  assert.deepEqual(a.trades, b.trades);
});

// ---------- Benchmark stats ----------

/** Builds an equity curve by compounding the given daily returns. */
function curveFrom(returns: number[], start = 100): number[] {
  const out = [start];
  for (const r of returns) out.push(out[out.length - 1] * (1 + r));
  return out;
}

const wiggle = [0.01, -0.02, 0.015, 0.003, -0.011, 0.007, -0.004, 0.02, -0.013, 0.006, 0.001, -0.008];

test("benchmark stats: identical series gives beta 1, alpha 0, no tracking error", () => {
  const eq = curveFrom(wiggle.concat(wiggle));
  const s = benchmarkStats(eq, eq, 0);
  assert.ok(s);
  assert.equal(s.beta, 1);
  assert.equal(s.alphaPct, 0);
  assert.equal(s.trackingErrorPct, 0);
  assert.equal(s.informationRatio, 0);
  assert.equal(s.upCapturePct, 100);
  assert.equal(s.downCapturePct, 100);
});

test("benchmark stats: a strategy that moves twice as much as the benchmark has beta 2", () => {
  const bench = curveFrom(wiggle);
  const strat = curveFrom(wiggle.map((r) => 2 * r));
  const s = benchmarkStats(strat, bench, 0);
  assert.ok(s);
  assert.ok(Math.abs(s.beta - 2) < 1e-6, `beta was ${s.beta}`);
  assert.ok(Math.abs(s.downCapturePct! - 200) < 1e-3, `down capture was ${s.downCapturePct}`);
});

test("benchmark stats: mismatched or too-short series return null", () => {
  assert.equal(benchmarkStats([100, 101, 102], [100, 101], 0), null);
  assert.equal(benchmarkStats([100, 101], [100, 101], 0), null);
});

// ---------- Drawdowns and monthly returns ----------

test("drawdown episodes: deepest first, with peak, trough, and recovery", () => {
  const eq = [100, 120, 90, 95, 130, 100, 110];
  const dates = eq.map((_, i) => `2020-01-${String(i + 1).padStart(2, "0")}`);
  const eps = drawdownEpisodes(eq, dates, 5);
  assert.equal(eps.length, 2);
  assert.equal(eps[0].startDate, "2020-01-02"); // peak 120
  assert.equal(eps[0].troughDate, "2020-01-03"); // 90
  assert.equal(eps[0].recoveryDate, "2020-01-05"); // back to 130 (above 120)
  assert.equal(eps[0].depthPct, -25);
  assert.equal(eps[1].recoveryDate, null);
  assert.equal(eps[1].depthPct, -23.08);
});

test("drawdown episodes: a curve that only rises has none", () => {
  assert.deepEqual(drawdownEpisodes([1, 2, 3], ["a", "b", "c"]), []);
});

test("monthly returns: each month compares its last value with the previous month's", () => {
  const dates = ["2020-01-30", "2020-01-31", "2020-02-14", "2020-02-28", "2020-03-31"];
  const eq = [100, 110, 121, 115.5, 126.5];
  const m = monthlyReturns(eq, dates);
  assert.deepEqual(
    m.map((x) => [x.year, x.month, x.returnPct]),
    [
      [2020, 1, 10],
      [2020, 2, 5],
      [2020, 3, 9.52],
    ],
  );
});

// ---------- Reproducibility of the new options ----------

const manifestBase = {
  symbol: "TEST",
  start: "2020-01-01",
  end: "2020-12-31",
  datasetHash: "abc",
  capital: 100_000,
  costProfile: "flat",
  costModel: flatCostModel(10),
  slippageBps: 5,
  riskFreeRatePct: 0,
  strategyId: "sma-crossover",
  params: { fast: 10 },
};

test("plain runs keep the same run ID when the new optional keys are not set", () => {
  const plain = buildManifest(manifestBase);
  const withUndefined = buildManifest({
    ...manifestBase,
    stopLossPct: undefined,
    takeProfitPct: undefined,
    positionFraction: undefined,
  });
  assert.equal(withUndefined.runId, plain.runId);
});

test("setting a risk option changes the run ID", () => {
  const plain = buildManifest(manifestBase);
  const withStop = buildManifest({ ...manifestBase, stopLossPct: 5 });
  assert.notEqual(withStop.runId, plain.runId);
});
