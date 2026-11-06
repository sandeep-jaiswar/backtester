import type { OptimizeResult } from "./optimize";

/** NDJSON events from POST /api/optimize. Order: progress (repeated), then one result or error, then done. */
export type OptimizeEvent =
  | { type: "progress"; done: number; total: number }
  | { type: "result"; result: OptimizeResult; symbol: string; currency: string; strategyName: string; barCount: number }
  | { type: "error"; message: string }
  | { type: "done"; elapsedMs: number };
