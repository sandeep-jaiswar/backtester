import type { Strategy } from "../backtest/types";
import { priorHighest, priorLowest } from "../backtest/indicators";

export const donchianBreakout: Strategy = {
  id: "donchian-breakout",
  name: "Donchian Channel Breakout",
  description:
    "Buy when the close breaks above the highest high of the entry window; exit when it breaks below the lowest low of the exit window (turtle-style).",
  params: [
    { key: "entry", label: "Entry window (days)", default: 20, min: 5, max: 200, step: 1, integer: true },
    { key: "exit", label: "Exit window (days)", default: 10, min: 2, max: 100, step: 1, integer: true },
  ],
  signals(bars, p) {
    const entryHigh = priorHighest(bars, p.entry);
    const exitLow = priorLowest(bars, p.exit);
    const out: boolean[] = new Array(bars.length);
    let holding = false;
    for (let i = 0; i < bars.length; i++) {
      if (!holding && !Number.isNaN(entryHigh[i]) && bars[i].close > entryHigh[i]) {
        holding = true;
      } else if (holding && !Number.isNaN(exitLow[i]) && bars[i].close < exitLow[i]) {
        holding = false;
      }
      out[i] = holding;
    }
    return out;
  },
};
