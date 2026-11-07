// Tests for the plain-English verdict and the number rules behind the form validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict } from "../src/lib/backtest/verdict";
import { hasBlankNumber, numberProblem } from "../src/lib/number-rules";

test("verdict: beating the benchmark says so with both returns", () => {
  const v = verdict({ totalReturnPct: 42.5, maxDrawdownPct: -12, tradeCount: 20 }, { totalReturnPct: 30, maxDrawdownPct: -25, tradeCount: 0 });
  assert.match(v.headline, /^Beat buy & hold by 12\.5 points: 42\.5% against 30\.0%\./);
  assert.match(v.headline, /Max drawdown was -12\.0% against -25\.0%\.$/);
  assert.deepEqual(v.caveats, []);
});

test("verdict: trailing the benchmark uses the right verb", () => {
  const v = verdict({ totalReturnPct: 5, maxDrawdownPct: -10, tradeCount: 30 }, { totalReturnPct: 9, maxDrawdownPct: -10, tradeCount: 0 });
  assert.match(v.headline, /^Trailed buy & hold by 4\.0 points/);
});

test("verdict: an exact tie is reported as matched", () => {
  const v = verdict({ totalReturnPct: 9, maxDrawdownPct: -10, tradeCount: 30 }, { totalReturnPct: 9, maxDrawdownPct: -10, tradeCount: 0 });
  assert.match(v.headline, /^Matched buy & hold at 9\.0%/);
});

test("verdict: without a benchmark it reports return and drawdown only", () => {
  const v = verdict({ totalReturnPct: -3.456, maxDrawdownPct: -8, tradeCount: 12 }, null);
  assert.equal(v.headline, "Returned -3.5% with a max drawdown of -8.0%.");
});

test("verdict: caveats for no trades and for a small sample", () => {
  assert.deepEqual(verdict({ totalReturnPct: 0, maxDrawdownPct: 0, tradeCount: 0 }).caveats, [
    "No trades were made, so this is the same as holding cash.",
  ]);
  assert.deepEqual(verdict({ totalReturnPct: 1, maxDrawdownPct: -1, tradeCount: 4 }).caveats, [
    "Only 4 trades. That is too few to rely on.",
  ]);
});

test("numberProblem: blank and non-numeric are problems, never zero", () => {
  assert.equal(numberProblem(Number.NaN), "Enter a number.");
  assert.equal(numberProblem(Number.NaN, { optional: true }), null);
});

test("numberProblem: range and integer rules", () => {
  assert.equal(numberProblem(5, { min: 1, max: 10 }), null);
  assert.equal(numberProblem(0, { min: 1 }), "Must be at least 1.");
  assert.equal(numberProblem(11, { max: 10 }), "Must be at most 10.");
  assert.equal(numberProblem(2.5, { integer: true }), "Enter a whole number.");
});

test("hasBlankNumber: finds a blank anywhere in a nested value", () => {
  assert.equal(hasBlankNumber({ a: 1, b: [{ c: Number.NaN }] }), true);
  assert.equal(hasBlankNumber({ a: 1, b: [{ c: 2 }], d: "x" }), false);
});
