import type { Strategy } from "../backtest/types";
import { closesOf, sma } from "../backtest/indicators";

export const smaCrossover: Strategy = {
  id: "sma-crossover",
  name: "SMA Crossover",
  description: "Long while the fast simple moving average is above the slow one.",
  params: [
    { key: "fast", label: "Fast SMA", default: 20, min: 2, max: 200, step: 1, integer: true },
    { key: "slow", label: "Slow SMA", default: 50, min: 3, max: 400, step: 1, integer: true },
  ],
  signals(bars, p) {
    const closes = closesOf(bars);
    const fast = sma(closes, p.fast);
    const slow = sma(closes, p.slow);
    return bars.map((_, i) => fast[i] > slow[i]);
  },
};
