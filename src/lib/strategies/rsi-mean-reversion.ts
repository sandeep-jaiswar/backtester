import type { Strategy } from "../backtest/types";
import { closesOf, rsi } from "../backtest/indicators";

export const rsiMeanReversion: Strategy = {
  id: "rsi-mean-reversion",
  name: "RSI Mean Reversion",
  description: "Buy when RSI drops below the oversold level, sell when it rises above overbought.",
  params: [
    { key: "period", label: "RSI period", default: 14, min: 2, max: 100, step: 1, integer: true },
    { key: "buyBelow", label: "Oversold (buy below)", default: 30, min: 5, max: 50, step: 1 },
    { key: "sellAbove", label: "Overbought (sell above)", default: 70, min: 50, max: 95, step: 1 },
  ],
  signals(bars, p) {
    const r = rsi(closesOf(bars), p.period);
    const out: boolean[] = new Array(bars.length);
    let holding = false;
    for (let i = 0; i < bars.length; i++) {
      if (!Number.isNaN(r[i])) {
        if (r[i] < p.buyBelow) holding = true;
        else if (r[i] > p.sellAbove) holding = false;
      }
      out[i] = holding;
    }
    return out;
  },
};
