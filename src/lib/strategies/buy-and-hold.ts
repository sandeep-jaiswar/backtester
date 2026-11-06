import type { Strategy } from "../backtest/types";

/** Benchmark: buy at the first open and never sell. */
export const buyAndHold: Strategy = {
  id: "buy-and-hold",
  name: "Buy & Hold",
  description: "Buy on the first bar and hold to the end. Used as the benchmark.",
  params: [],
  signals(bars) {
    return bars.map(() => true);
  },
};
