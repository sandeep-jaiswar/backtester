// Sanity checks for the backtest engine and strategies, using synthetic price paths.
// Run with: npm run verify
import assert from "node:assert/strict";
import { runBacktest } from "../src/lib/backtest/engine";
import { computeMetrics } from "../src/lib/backtest/metrics";
import { sma, rsi } from "../src/lib/backtest/indicators";
import type { Bar } from "../src/lib/backtest/types";
import { strategies, getStrategy, resolveParams } from "../src/lib/strategies";

function makeBars(closes: number[]): Bar[] {
  const start = Date.UTC(2020, 0, 1);
  return closes.map((c, i) => ({
    date: new Date(start + i * 86_400_000),
    open: c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: 1000,
  }));
}

const zeroCost = { initialCapital: 10_000, commissionBps: 0, slippageBps: 0 };

// 1. Buy & hold on a doubling series with zero costs: value should double.
{
  const bars = makeBars([100, 110, 120, 150, 200]);
  const res = runBacktest(bars, bars.map(() => true), zeroCost);
  // Signal on bar 0 fills at bar 1's open (110), so the position compounds from 110 to 200.
  const expected = 10_000 * (200 / 110);
  assert.ok(Math.abs(res.equity[res.equity.length - 1] - expected) < 1e-6, "buy & hold fills at next open");
  assert.equal(res.trades.length, 1);
  assert.equal(res.trades[0].openAtEnd, true);
}

// 2. Look-ahead: a signal on bar i must execute at open of bar i+1, not bar i.
{
  const bars = makeBars([100, 100, 200, 200]);
  bars[2].open = 150; // distinct open on the bar AFTER the signal
  const signals = [false, true, true, true];
  const res = runBacktest(bars, signals, zeroCost);
  assert.equal(res.trades[0].entryPrice, 150, "entry should use open of bar 2");
  assert.equal(res.trades[0].entryDate, bars[2].date.toISOString().slice(0, 10));
}

// 3. Commission and slippage reduce the result versus zero cost.
{
  const bars = makeBars([100, 100, 110, 110]);
  const cheap = runBacktest(bars, [true, false, false, false], zeroCost);
  const costly = runBacktest(bars, [true, false, false, false], { ...zeroCost, commissionBps: 50, slippageBps: 50 });
  assert.ok(costly.equity[3] < cheap.equity[3], "costs must reduce equity");
}

// 4. Flat strategy: no trades, equity constant, zero exposure.
{
  const bars = makeBars([100, 90, 80, 70]);
  const res = runBacktest(bars, bars.map(() => false), zeroCost);
  const m = computeMetrics(res, bars.map((b) => b.date));
  assert.equal(m.tradeCount, 0);
  assert.equal(m.exposurePct, 0);
  assert.equal(m.totalReturnPct, 0);
}

// 5. Max drawdown on a known path: 100 -> 200 -> 100 is a 50% drawdown.
{
  const bars = makeBars([100, 100, 200, 100]);
  const res = runBacktest(bars, bars.map(() => true), zeroCost);
  const m = computeMetrics(res, bars.map((b) => b.date));
  assert.equal(m.maxDrawdownPct, -50);
}

// 6. Indicators on a known series.
{
  const s = sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(s.slice(2), [2, 3, 4]);
  assert.ok(Number.isNaN(s[0]) && Number.isNaN(s[1]));
  const up = rsi(Array.from({ length: 30 }, (_, i) => 100 + i), 14);
  assert.equal(up[29], 100, "RSI of a pure uptrend is 100");
}

// 7. Every registered strategy returns one boolean per bar, without throwing, on a random walk.
{
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const closes: number[] = [100];
  for (let i = 1; i < 800; i++) closes.push(closes[i - 1] * (1 + (rand() - 0.5) * 0.04));
  const bars = makeBars(closes);
  for (const s of strategies) {
    const params = resolveParams(s, {});
    const sig = s.signals(bars, params);
    assert.equal(sig.length, bars.length, `${s.id} length`);
    const res = runBacktest(bars, sig, { initialCapital: 10_000, commissionBps: 10, slippageBps: 5 });
    const m = computeMetrics(res, bars.map((b) => b.date));
    assert.ok(Number.isFinite(m.endValue) && m.endValue > 0, `${s.id} end value`);
    console.log(
      `${s.id.padEnd(20)} return ${String(m.totalReturnPct).padStart(8)}%  maxDD ${String(m.maxDrawdownPct).padStart(8)}%  trades ${m.tradeCount}`,
    );
  }
}

// 8. Param clamping and integer rounding.
{
  const s = getStrategy("sma-crossover")!;
  assert.deepEqual(resolveParams(s, { fast: 9999, slow: 10.7 }), { fast: 200, slow: 11 });
}

console.log("\nAll engine checks passed.");
