import type { RuleDefinition } from "./rules";

/** Starter definitions for the strategy builder. Each one is a valid RuleDefinition. */
export const RULE_TEMPLATES: { id: string; name: string; description: string; definition: RuleDefinition }[] = [
  {
    id: "sma-cross",
    name: "SMA crossover",
    description: "Long when the fast average crosses above the slow one. Exit when it crosses back below.",
    definition: {
      version: 1,
      params: [
        { key: "fast", label: "Fast period", default: 20, min: 2, max: 200, step: 1, integer: true },
        { key: "slow", label: "Slow period", default: 50, min: 3, max: 400, step: 1, integer: true },
      ],
      entry: {
        match: "all",
        conditions: [
          {
            left: { type: "indicator", name: "sma", periodParam: "fast" },
            op: "crossesAbove",
            right: { type: "indicator", name: "sma", periodParam: "slow" },
          },
        ],
      },
      exit: {
        match: "all",
        conditions: [
          {
            left: { type: "indicator", name: "sma", periodParam: "fast" },
            op: "crossesBelow",
            right: { type: "indicator", name: "sma", periodParam: "slow" },
          },
        ],
      },
    },
  },
  {
    id: "rsi-reversion",
    name: "RSI mean reversion",
    description: "Buy when RSI dips below the buy level. Sell when it rises above the sell level.",
    definition: {
      version: 1,
      params: [
        { key: "period", label: "RSI period", default: 14, min: 2, max: 50, step: 1, integer: true },
        { key: "buyBelow", label: "Buy below", default: 30, min: 5, max: 50, step: 1 },
        { key: "sellAbove", label: "Sell above", default: 70, min: 50, max: 95, step: 1 },
      ],
      entry: {
        match: "all",
        conditions: [
          {
            left: { type: "indicator", name: "rsi", periodParam: "period" },
            op: "lt",
            right: { type: "param", key: "buyBelow" },
          },
        ],
      },
      exit: {
        match: "all",
        conditions: [
          {
            left: { type: "indicator", name: "rsi", periodParam: "period" },
            op: "gt",
            right: { type: "param", key: "sellAbove" },
          },
        ],
      },
    },
  },
  {
    id: "donchian",
    name: "Donchian breakout",
    description: "Buy when the close breaks above the prior high over the lookback. Exit below the prior low.",
    definition: {
      version: 1,
      params: [
        { key: "lookback", label: "Entry lookback", default: 20, min: 5, max: 200, step: 1, integer: true },
        { key: "exitLookback", label: "Exit lookback", default: 10, min: 3, max: 100, step: 1, integer: true },
      ],
      entry: {
        match: "all",
        conditions: [
          {
            left: { type: "indicator", name: "close" },
            op: "gt",
            right: { type: "indicator", name: "priorHigh", periodParam: "lookback" },
          },
        ],
      },
      exit: {
        match: "all",
        conditions: [
          {
            left: { type: "indicator", name: "close" },
            op: "lt",
            right: { type: "indicator", name: "priorLow", periodParam: "exitLookback" },
          },
        ],
      },
    },
  },
];
