import type { Metrics, Trade } from "./types";

/**
 * Newline-delimited JSON events sent by POST /api/backtest.
 * Shared by the server (producer) and the client (consumer).
 *
 * Order: one `data` event, then `result` events in completion order (not request order),
 * one per run plus the buy-and-hold benchmark (index -1), then a single `done`.
 */
export type BacktestEvent =
  | {
      type: "data";
      symbol: string;
      currency: string;
      dates: string[];
      barCount: number;
    }
  | {
      type: "result";
      /** Position of the run in the request, or -1 for the benchmark. */
      index: number;
      strategyId: string;
      strategyName: string;
      params: Record<string, number>;
      metrics: Metrics;
      equity: number[];
      trades: Trade[];
      durationMs: number;
    }
  | { type: "error"; index?: number; message: string }
  | { type: "done"; elapsedMs: number };

export const BENCHMARK_INDEX = -1;
