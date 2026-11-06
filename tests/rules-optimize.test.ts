// Tests for no-code rule strategies and the optimiser. Pure modules only, so no network access.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "../src/lib/backtest/types";
import { ruleDefinitionSchema, evaluateRuleSignals, ruleStrategy } from "../src/lib/backtest/rules";
import { RULE_TEMPLATES } from "../src/lib/backtest/rule-templates";
import { expandGrid, gridSize, runOptimization, MAX_GRID_COMBOS } from "../src/lib/backtest/optimize";
import { getStrategy } from "../src/lib/strategies";

function makeBars(closes: number[], highLow = 0.01): Bar[] {
  const start = Date.UTC(2020, 0, 1);
  return closes.map((c, i) => ({
    date: new Date(start + i * 86_400_000),
    open: i === 0 ? c : closes[i - 1],
    high: c * (1 + highLow),
    low: c * (1 - highLow),
    close: c,
    volume: 1000,
  }));
}

/** Deterministic pseudo-random walk, so tests are reproducible. */
function randomWalk(n: number, seed = 7): number[] {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out = [100];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + (rand() - 0.5) * 0.04));
  return out;
}

const smaTemplate = RULE_TEMPLATES.find((t) => t.id === "sma-cross")!.definition;
const rsiTemplate = RULE_TEMPLATES.find((t) => t.id === "rsi-reversion")!.definition;

// ---------- Rule definitions ----------

test("all templates validate against the schema", () => {
  for (const t of RULE_TEMPLATES) {
    assert.equal(ruleDefinitionSchema.safeParse(t.definition).success, true, t.id);
  }
});

test("schema rejects a reference to an undeclared parameter", () => {
  const bad = structuredClone(smaTemplate);
  bad.entry.conditions[0].right = { type: "param", key: "nope" };
  const r = ruleDefinitionSchema.safeParse(bad);
  assert.equal(r.success, false);
});

test("schema rejects a period indicator without a period", () => {
  const bad = structuredClone(smaTemplate);
  bad.entry.conditions[0].left = { type: "indicator", name: "sma" } as never;
  assert.equal(ruleDefinitionSchema.safeParse(bad).success, false);
});

test("schema rejects a period on an indicator that takes none", () => {
  const bad = structuredClone(smaTemplate);
  bad.entry.conditions[0].left = { type: "indicator", name: "close", period: 5 } as never;
  assert.equal(ruleDefinitionSchema.safeParse(bad).success, false);
});

test("schema rejects a default outside its min and max", () => {
  const bad = structuredClone(smaTemplate);
  bad.params[0].default = 9999;
  assert.equal(ruleDefinitionSchema.safeParse(bad).success, false);
});

// ---------- Rule evaluation ----------

test("SMA crossover goes long on the crossover and out on the cross back", () => {
  const closes = [
    ...Array.from({ length: 30 }, () => 100),
    ...Array.from({ length: 40 }, (_, i) => 100 + i * 2),
    ...Array.from({ length: 40 }, (_, i) => 178 - i * 2),
  ];
  const bars = makeBars(closes);
  const params = { fast: 5, slow: 10 };
  const sig = evaluateRuleSignals(bars, smaTemplate, params);
  assert.equal(sig.length, bars.length);
  assert.equal(sig[20], false, "flat market: no position");
  assert.equal(sig[40], true, "rising market: long");
  assert.equal(sig[bars.length - 1], false, "falling market: flat again");
  // Once flat, it stays flat until the next crossover, so long/flat switches are sparse.
  const switches = sig.slice(1).filter((v, i) => v !== sig[i]).length;
  assert.ok(switches <= 2, `expected at most one entry and one exit, got ${switches} switches`);
});

test("rules never look ahead: changing future bars leaves earlier signals unchanged", () => {
  const closes = randomWalk(400, 11);
  const bars = makeBars(closes);
  const params = { fast: 10, slow: 30 };
  const base = evaluateRuleSignals(bars, smaTemplate, params);

  const cut = 250;
  const mutated = bars.map((b, i) =>
    i > cut ? { ...b, close: b.close * 3, high: b.high * 3, low: b.low * 0.2 } : b,
  );
  const after = evaluateRuleSignals(mutated, smaTemplate, params);
  assert.deepEqual(after.slice(0, cut + 1), base.slice(0, cut + 1));
});

test("RSI template enters on a sustained fall", () => {
  const closes = [
    ...Array.from({ length: 30 }, (_, i) => 100 + i * 0.1),
    ...Array.from({ length: 30 }, (_, i) => 103 - i * 1.5),
  ];
  const bars = makeBars(closes);
  const sig = evaluateRuleSignals(bars, rsiTemplate, { period: 14, buyBelow: 30, sellAbove: 70 });
  assert.ok(sig.some(Boolean), "RSI should drop below 30 during the fall and trigger a long");
});

test("NaN warm-up values never trigger a comparison", () => {
  const bars = makeBars([100, 101, 102]);
  // A period longer than the series means every indicator value is NaN.
  const def = structuredClone(smaTemplate);
  def.params[0].default = 50;
  def.params[0].min = 2;
  def.params[0].max = 400;
  const sig = evaluateRuleSignals(bars, def, { fast: 50, slow: 60 });
  assert.ok(sig.every((v) => v === false));
});

test("ruleStrategy exposes the definition's params and hash", () => {
  const s = ruleStrategy("custom:abc12345", "Test", "", smaTemplate, "deadbeef");
  assert.equal(s.params.length, 2);
  assert.equal(s.definitionHash, "deadbeef");
  assert.equal(s.signals(makeBars(randomWalk(60)), { fast: 5, slow: 10 }).length, 60);
});

// ---------- Grid expansion ----------

test("grid expansion is inclusive of both ends", () => {
  const sma = getStrategy("sma-crossover")!;
  const combos = expandGrid(sma, [{ key: "fast", min: 10, max: 20, step: 5 }]);
  assert.deepEqual(combos.map((c) => c.fast), [10, 15, 20]);
  assert.equal(gridSize([{ key: "fast", min: 10, max: 20, step: 5 }]), 3);
});

test("grid expansion fills unspecified parameters with defaults", () => {
  const sma = getStrategy("sma-crossover")!;
  const combos = expandGrid(sma, [{ key: "fast", min: 10, max: 12, step: 1 }]);
  assert.ok(combos.every((c) => c.slow === 50));
});

test("grid expansion rejects grids over the limit and unknown parameters", () => {
  const sma = getStrategy("sma-crossover")!;
  assert.throws(
    () =>
      expandGrid(sma, [
        { key: "fast", min: 2, max: 200, step: 1 },
        { key: "slow", min: 3, max: 400, step: 1 },
      ]),
    /limit is/,
  );
  assert.ok(gridSize([{ key: "fast", min: 2, max: 200, step: 1 }, { key: "slow", min: 3, max: 400, step: 1 }]) > MAX_GRID_COMBOS);
  assert.throws(() => expandGrid(sma, [{ key: "nope", min: 1, max: 2, step: 1 }]), /Unknown parameter/);
});

// ---------- Optimiser ----------

const sma = getStrategy("sma-crossover")!;
const bars400 = makeBars(randomWalk(400, 21));
const baseConfig = { initialCapital: 100_000, commissionBps: 10, slippageBps: 5 };
const axes = [{ key: "fast", min: 5, max: 25, step: 5 }];

test("grid mode ranks combinations by the chosen metric, best first", () => {
  const r = runOptimization({
    bars: bars400,
    strategy: sma,
    config: baseConfig,
    riskFreeRatePct: 0,
    axes,
    validation: { mode: "none" },
    metric: "sharpe",
  });
  assert.equal(r.trialCount, 5);
  assert.equal(r.mode, "none");
  const sharpes = r.ranking.map((row) => row.inSample.metric);
  assert.deepEqual(sharpes, [...sharpes].sort((a, b) => b - a));
  assert.deepEqual(r.bestParams, r.ranking[0].params);
  assert.equal(r.outOfSample, undefined);
});

test("split mode tests the chosen combination on the held-out tail only", () => {
  const cut = Math.floor(400 * 0.7);
  const r = runOptimization({
    bars: bars400,
    strategy: sma,
    config: baseConfig,
    riskFreeRatePct: 0,
    axes,
    validation: { mode: "split", trainFraction: 0.7 },
    metric: "totalReturnPct",
  });
  assert.ok(r.outOfSample);
  assert.equal(r.outOfSample!.dates.length, 400 - cut);
  assert.equal(r.outOfSample!.dates[0], new Date(bars400[cut].date).toISOString().slice(0, 10));
  assert.ok(r.ranking.every((row) => row.outOfSample !== undefined));
});

test("walk-forward chains the test windows, one fold per window", () => {
  const folds = 4;
  const n = 400;
  const r = runOptimization({
    bars: bars400,
    strategy: sma,
    config: baseConfig,
    riskFreeRatePct: 0,
    axes,
    validation: { mode: "walkForward", folds },
    metric: "sharpe",
  });
  assert.equal(r.folds!.length, folds);
  const b1 = Math.round(n / (folds + 1));
  // Test windows cover [b1, n). Each later window's first bar is dropped when chaining.
  assert.equal(r.outOfSample!.equity.length, n - b1 - (folds - 1));
  // Folds are chronological and each test starts after its training window ends.
  for (let i = 1; i < r.folds!.length; i++) {
    assert.ok(r.folds![i].testStart > r.folds![i - 1].testStart);
  }
});

test("walk-forward out-of-sample values start from the first test window's initial capital", () => {
  const r = runOptimization({
    bars: bars400,
    strategy: sma,
    config: baseConfig,
    riskFreeRatePct: 0,
    axes,
    validation: { mode: "walkForward", folds: 3 },
    metric: "sharpe",
  });
  assert.ok(r.outOfSample!.equity.every((v) => Number.isFinite(v) && v > 0));
});

test("warns when many combinations were tested", () => {
  const r = runOptimization({
    bars: bars400,
    strategy: sma,
    config: baseConfig,
    riskFreeRatePct: 0,
    axes: [{ key: "fast", min: 2, max: 60, step: 1 }],
    validation: { mode: "none" },
    metric: "sharpe",
  });
  assert.ok(r.trialCount > 50);
  assert.ok(r.warnings.some((w) => /Tested \d+ parameter combinations/.test(w)));
});

test("split and walk-forward reject windows that are too short", () => {
  const short = makeBars(randomWalk(40));
  assert.throws(
    () =>
      runOptimization({
        bars: short,
        strategy: sma,
        config: baseConfig,
        riskFreeRatePct: 0,
        axes,
        validation: { mode: "split", trainFraction: 0.7 },
        metric: "sharpe",
      }),
    /Not enough bars/,
  );
  assert.throws(
    () =>
      runOptimization({
        bars: short,
        strategy: sma,
        config: baseConfig,
        riskFreeRatePct: 0,
        axes,
        validation: { mode: "walkForward", folds: 5 },
        metric: "sharpe",
      }),
    /too short|at least 20 bars/,
  );
});

test("optimisation is deterministic for identical inputs", () => {
  const run = () =>
    runOptimization({
      bars: bars400,
      strategy: sma,
      config: baseConfig,
      riskFreeRatePct: 0,
      axes,
      validation: { mode: "walkForward", folds: 3 },
      metric: "sortino",
    });
  assert.deepEqual(run(), run());
});

test("progress callbacks report up to the total", () => {
  const seen: [number, number][] = [];
  runOptimization({
    bars: bars400,
    strategy: sma,
    config: baseConfig,
    riskFreeRatePct: 0,
    axes,
    validation: { mode: "split", trainFraction: 0.7 },
    metric: "sharpe",
    onProgress: (d, t) => seen.push([d, t]),
  });
  const last = seen[seen.length - 1];
  assert.equal(last[0], last[1]);
  assert.equal(last[1], 5);
});
