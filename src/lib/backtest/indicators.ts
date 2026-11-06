import type { Bar } from "./types";

/**
 * Indicator helpers. Every function returns an array aligned with its input.
 * Positions inside the warm-up window hold NaN, so comparisons against them are false.
 */

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      // Seed with the SMA of the first `period` values.
      let s = 0;
      for (let j = 0; j < period; j++) s += values[j];
      prev = s / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(closes: number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const g = change > 0 ? change : 0;
    const l = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * Highest high / lowest low over the `lookback` bars ENDING at i-1 (excludes bar i),
 * so a breakout check against it never uses the current bar's own extremes.
 */
export function priorHighest(bars: Bar[], lookback: number): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  for (let i = lookback; i < bars.length; i++) {
    let max = -Infinity;
    for (let j = i - lookback; j < i; j++) max = Math.max(max, bars[j].high);
    out[i] = max;
  }
  return out;
}

export function priorLowest(bars: Bar[], lookback: number): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  for (let i = lookback; i < bars.length; i++) {
    let min = Infinity;
    for (let j = i - lookback; j < i; j++) min = Math.min(min, bars[j].low);
    out[i] = min;
  }
  return out;
}

export function closesOf(bars: Bar[]): number[] {
  return bars.map((b) => b.close);
}
