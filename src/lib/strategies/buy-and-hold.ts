import type { Strategy } from "../backtest/types";
import { BENCHMARK_STRATEGY_ID } from "../backtest/config";

/** Benchmark: buy at the first open and never sell. */
export const buyAndHold: Strategy = {
  id: BENCHMARK_STRATEGY_ID,
  name: "Buy & Hold",
  description: "Buy on the first bar and hold to the end. Used as the benchmark.",
  params: [],
  signals(bars) {
    return bars.map(() => true);
  },
};
