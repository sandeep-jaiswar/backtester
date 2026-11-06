// Unit tests for the backtest core: engine fees, metrics, cost profiles, manifests and request validation.
// Run with: npm test
// Note: these import only pure modules. yahoo.ts imports "server-only", which throws outside Next.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runBacktest } from "../src/lib/backtest/engine";
import { computeMetrics } from "../src/lib/backtest/metrics";
import { flatCostModel, indiaDeliveryCostModel, defaultCostProfileFor } from "../src/lib/backtest/costs";
import { buildManifest, canonicalJson, hashBars, type RunInputs } from "../src/lib/backtest/manifest";
import { requestSchema } from "../src/lib/backtest/request";
import type { Bar } from "../src/lib/backtest/types";

function makeBars(closes: number[], opens = closes): Bar[] {
  const start = Date.UTC(2020, 0, 1);
  return closes.map((c, i) => ({
    date: new Date(start + i * 86_400_000),
    open: opens[i],
    high: Math.max(opens[i], c) * 1.01,
    low: Math.min(opens[i], c) * 0.99,
    close: c,
    volume: 1000,
  }));
}

const zeroCost = { initialCapital: 10_000, commissionBps: 0, slippageBps: 0 };

// ---------- Engine: fees ----------

test("flat fees: buy fee comes out of shares and is included in trade P&L", () => {
  // Buy at 100 with 100 bps commission, sell at 100 with 100 bps: round trip loses 2% of notional.
  const bars = makeBars([100, 100, 100, 100]);
  const res = runBacktest(bars, [true, false, false, false], {
    initialCapital: 10_000,
    commissionBps: 100,
    slippageBps: 0,
  });
  const t = res.trades[0];
  // shares = 10000 / (100 * 1.01); sell fee = shares*100*0.01; proceeds = shares*100*0.99
  assert.ok(Math.abs(t.pnl - -198.02) < 0.01, `pnl was ${t.pnl}`);
  assert.ok(Math.abs(t.fees - 198.02) < 0.01, `fees were ${t.fees}`);
  assert.ok(Math.abs(res.totalFees - 198.02) < 0.01, `total fees were ${res.totalFees}`);
  // Equity after the round trip equals cash plus the P&L, so the trade P&L and the equity agree.
  assert.ok(Math.abs(res.equity[3] - (10_000 + t.pnl)) < 0.02);
});

test("zero cost model: P&L equals the price move, no fees", () => {
  const bars = makeBars([100, 100, 110, 110]);
  const res = runBacktest(bars, [true, false, false, false], zeroCost);
  assert.equal(res.totalFees, 0);
  assert.equal(res.trades[0].fees, 0);
  assert.ok(Math.abs(res.trades[0].pnl - 1000) < 0.01);
});

test("fixed fee per sell is charged once per exit", () => {
  const bars = makeBars([100, 100, 100, 100]);
  const res = runBacktest(bars, [true, false, false, false], {
    initialCapital: 10_000,
    commissionBps: 0,
    slippageBps: 0,
    costModel: { rateBuy: 0, rateSell: 0, fixedPerSell: 20 },
  });
  assert.equal(res.trades[0].fees, 20);
  assert.ok(Math.abs(res.trades[0].pnl - -20) < 0.01);
});

// ---------- Cost profiles ----------

test("india delivery rates match the component build-up", () => {
  const m = indiaDeliveryCostModel();
  const gstBase = 0.0000297 + 0.000001; // exchange + SEBI (brokerage is zero)
  const sellSide = 0.001 + gstBase + 0.18 * gstBase; // STT + exchange/SEBI + GST on them
  assert.ok(Math.abs(m.rateSell - sellSide) < 1e-12, `sell ${m.rateSell}`);
  assert.ok(Math.abs(m.rateBuy - (sellSide + 0.00015)) < 1e-12, `buy ${m.rateBuy}`);
  assert.equal(m.fixedPerSell, 0);
  // Buy side is costlier than the sell side because of stamp duty.
  assert.ok(m.rateBuy > m.rateSell);
});

test("flat cost model converts bps to fractions on both sides", () => {
  assert.deepEqual(flatCostModel(10), { rateBuy: 0.001, rateSell: 0.001, fixedPerSell: 0 });
});

test("default cost profile follows the symbol's exchange suffix", () => {
  assert.equal(defaultCostProfileFor("RELIANCE.NS"), "india-delivery");
  assert.equal(defaultCostProfileFor("500325.BO"), "india-delivery");
  assert.equal(defaultCostProfileFor("AAPL"), "flat");
  assert.equal(defaultCostProfileFor("^NSEI"), "flat");
});

// ---------- Metrics ----------

test("profit factor is null (not Infinity) when there are no losing trades", () => {
  const bars = makeBars([100, 100, 110, 110]);
  const res = runBacktest(bars, [true, false, false, false], zeroCost);
  const m = computeMetrics(res, bars.map((b) => b.date));
  assert.equal(m.profitFactor, null);
  // The result must survive JSON round-tripping without becoming null by accident.
  assert.equal(JSON.parse(JSON.stringify(m)).profitFactor, null);
});

test("profit factor is a number when there are both wins and losses", () => {
  // Win then loss: 100 -> 110 (sell at open 110), then 110 -> 99 (sell at open 99).
  const closes = [100, 100, 110, 110, 110, 99, 99];
  const signals = [true, false, true, true, false, false, false];
  const bars = makeBars(closes);
  const res = runBacktest(bars, signals, zeroCost);
  const m = computeMetrics(res, bars.map((b) => b.date));
  assert.equal(m.tradeCount, 2);
  assert.equal(typeof m.profitFactor, "number");
  assert.ok((m.profitFactor as number) > 0);
});

test("sortino is zero for a path with no down days", () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  const bars = makeBars(closes);
  const res = runBacktest(bars, bars.map(() => true), zeroCost);
  const m = computeMetrics(res, bars.map((b) => b.date));
  assert.equal(m.sortino, 0);
  assert.ok(m.sharpe > 0);
});

test("sortino is positive when the path has both up and down days with positive drift", () => {
  const closes = [100];
  for (let i = 1; i < 60; i++) closes.push(closes[i - 1] * (i % 3 === 0 ? 0.99 : 1.012));
  const bars = makeBars(closes);
  const res = runBacktest(bars, bars.map(() => true), zeroCost);
  const m = computeMetrics(res, bars.map((b) => b.date));
  assert.ok(m.sortino > 0, `sortino ${m.sortino}`);
});

test("a risk-free rate lowers Sharpe and Sortino", () => {
  const closes = [100];
  for (let i = 1; i < 120; i++) closes.push(closes[i - 1] * (i % 4 === 0 ? 0.995 : 1.004));
  const bars = makeBars(closes);
  const res = runBacktest(bars, bars.map(() => true), zeroCost);
  const dates = bars.map((b) => b.date);
  const base = computeMetrics(res, dates);
  const withRf = computeMetrics(res, dates, { riskFreeRatePct: 6 });
  assert.ok(withRf.sharpe < base.sharpe);
  assert.ok(withRf.sortino < base.sortino);
});

test("total fees paid is reported in metrics", () => {
  const bars = makeBars([100, 100, 100, 100]);
  const res = runBacktest(bars, [true, false, false, false], { ...zeroCost, commissionBps: 100 });
  const m = computeMetrics(res, bars.map((b) => b.date));
  assert.ok(Math.abs(m.totalFeesPaid - 198.02) < 0.01);
});

// ---------- Manifests ----------

const baseInputs: RunInputs = {
  symbol: "RELIANCE.NS",
  start: "2020-01-01",
  end: "2024-12-31",
  datasetHash: "abc",
  capital: 100_000,
  costProfile: "india-delivery",
  costModel: indiaDeliveryCostModel(),
  slippageBps: 5,
  riskFreeRatePct: 6.5,
  strategyId: "sma-crossover",
  params: { fast: 20, slow: 50 },
};

test("manifest run id is deterministic for identical inputs", () => {
  const a = buildManifest(baseInputs);
  const b = buildManifest({ ...baseInputs, params: { slow: 50, fast: 20 } }); // key order must not matter
  assert.equal(a.runId, b.runId);
  assert.equal(a.runId.length, 16);
  assert.equal(a.engineVersion, "1.1.0");
});

test("manifest run id changes when any input changes", () => {
  const base = buildManifest(baseInputs).runId;
  assert.notEqual(buildManifest({ ...baseInputs, params: { fast: 21, slow: 50 } }).runId, base);
  assert.notEqual(buildManifest({ ...baseInputs, datasetHash: "xyz" }).runId, base);
  assert.notEqual(buildManifest({ ...baseInputs, riskFreeRatePct: 0 }).runId, base);
});

test("canonical JSON sorts keys recursively", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } }), '{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}');
});

test("dataset hash changes when one price changes", () => {
  const bars = makeBars([100, 101, 102]);
  const changed = makeBars([100, 101.5, 102]);
  assert.equal(hashBars(bars), hashBars(makeBars([100, 101, 102])));
  assert.notEqual(hashBars(bars), hashBars(changed));
});

// ---------- Request validation ----------

const validRequest = {
  symbol: "reliance.ns",
  start: "2020-01-01",
  end: "2024-12-31",
  runs: [{ strategyId: "sma-crossover", params: {} }],
};

test("request accepts an explicit cost profile and normalises the symbol", () => {
  const parsed = requestSchema.parse({ ...validRequest, costProfile: "india-delivery" });
  assert.equal(parsed.symbol, "RELIANCE.NS");
  assert.equal(parsed.costProfile, "india-delivery");
  assert.equal(parsed.riskFreeRatePct, 0);
});

test("request leaves cost profile undefined when omitted, so the server can choose by symbol", () => {
  assert.equal(requestSchema.parse(validRequest).costProfile, undefined);
});

test("request rejects an unknown cost profile and an out-of-range risk-free rate", () => {
  assert.equal(requestSchema.safeParse({ ...validRequest, costProfile: "bogus" }).success, false);
  assert.equal(requestSchema.safeParse({ ...validRequest, riskFreeRatePct: 90 }).success, false);
});
