import type { Strategy } from "../backtest/types";
import { buyAndHold } from "./buy-and-hold";
import { donchianBreakout } from "./donchian-breakout";
import { macdTrend } from "./macd-trend";
import { rsiMeanReversion } from "./rsi-mean-reversion";
import { smaCrossover } from "./sma-crossover";

/**
 * Strategy registry. To add a custom algorithm: create a file in this folder that exports a
 * `Strategy`, then add it to this array. It becomes available in the API and the UI automatically.
 */
export const strategies: Strategy[] = [
  smaCrossover,
  rsiMeanReversion,
  donchianBreakout,
  macdTrend,
  buyAndHold,
];

export function getStrategy(id: string): Strategy | undefined {
  return strategies.find((s) => s.id === id);
}

/** Fills missing params with defaults, clamps to the spec range, and rounds integer params. */
export function resolveParams(
  strategy: Strategy,
  input: Record<string, number> = {},
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of strategy.params) {
    const raw = Number.isFinite(input[spec.key]) ? input[spec.key] : spec.default;
    const clamped = Math.min(spec.max, Math.max(spec.min, raw));
    out[spec.key] = spec.integer ? Math.round(clamped) : clamped;
  }
  return out;
}
