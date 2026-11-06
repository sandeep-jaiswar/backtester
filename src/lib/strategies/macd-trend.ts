import type { Strategy } from "../backtest/types";
import { closesOf, ema } from "../backtest/indicators";

export const macdTrend: Strategy = {
  id: "macd-trend",
  name: "MACD Trend",
  description: "Long while the MACD line is above its signal line.",
  params: [
    { key: "fast", label: "Fast EMA", default: 12, min: 2, max: 100, step: 1, integer: true },
    { key: "slow", label: "Slow EMA", default: 26, min: 3, max: 200, step: 1, integer: true },
    { key: "signal", label: "Signal EMA", default: 9, min: 2, max: 50, step: 1, integer: true },
  ],
  signals(bars, p) {
    const closes = closesOf(bars);
    const fast = ema(closes, p.fast);
    const slow = ema(closes, p.slow);
    const macd = closes.map((_, i) => fast[i] - slow[i]);
    // Signal line = EMA of the MACD line, seeded only once the MACD line exists.
    const firstValid = macd.findIndex((v) => !Number.isNaN(v));
    const signalLine = new Array<number>(bars.length).fill(NaN);
    if (firstValid >= 0) {
      const tail = ema(macd.slice(firstValid), p.signal);
      tail.forEach((v, j) => (signalLine[firstValid + j] = v));
    }
    return bars.map((_, i) => macd[i] > signalLine[i]);
  },
};
