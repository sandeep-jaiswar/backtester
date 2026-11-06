// Types shared by server and client for saved runs. Type-only imports, so this file is safe in the browser.
import type { RunManifest } from "./manifest";
import type { Metrics, Trade } from "./types";

export interface RunSummary {
  runId: string;
  createdAt: string;
  symbol: string;
  strategyId: string;
  strategyName: string;
  startDate: string;
  endDate: string;
  totalReturnPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  tradeCount: number;
}

export interface StoredRun extends RunSummary {
  manifest: RunManifest;
  metrics: Metrics;
  trades: Trade[];
  /** Null for runs saved before dates were stored. */
  dates: string[] | null;
  equity: number[];
}
