import "server-only";
import { requireDb } from "./client";
import { ensureSchema } from "./schema";
import type { RunManifest } from "../backtest/manifest";
import type { Metrics, Trade } from "../backtest/types";

/** Everything stored for one run. `runId` is the manifest hash, so re-saving an identical run is a no-op. */
export interface StoredRunInput {
  manifest: RunManifest;
  strategyName: string;
  metrics: Metrics;
  trades: Trade[];
  dates: string[];
  equity: number[];
}

export type { RunSummary, StoredRun } from "../backtest/run-types";
import type { RunSummary, StoredRun } from "../backtest/run-types";

/** Saves a run. Returns true if it was inserted, false if an identical run was already stored. */
export async function saveRun(run: StoredRunInput): Promise<boolean> {
  const sql = requireDb();
  await ensureSchema();
  const m = run.manifest;
  const rows = await sql`
    INSERT INTO backtest_runs
      (run_id, symbol, strategy_id, strategy_name, start_date, end_date, engine_version,
       manifest, metrics, trades, equity, dates)
    VALUES
      (${m.runId}, ${m.symbol}, ${m.strategyId}, ${run.strategyName}, ${m.start}, ${m.end},
       ${m.engineVersion}, ${JSON.stringify(m)}::jsonb, ${JSON.stringify(run.metrics)}::jsonb,
       ${JSON.stringify(run.trades)}::jsonb, ${JSON.stringify(run.equity)}::jsonb,
       ${JSON.stringify(run.dates)}::jsonb)
    ON CONFLICT (run_id) DO NOTHING
    RETURNING run_id`;
  return rows.length > 0;
}

/** Most recent runs first. Heavy columns (equity, trades, dates) are left out of the listing. */
export async function listRuns(limit: number): Promise<RunSummary[]> {
  const sql = requireDb();
  await ensureSchema();
  const rows = await sql`
    SELECT run_id, created_at, symbol, strategy_id, strategy_name, start_date, end_date,
           metrics->>'totalReturnPct' AS total_return_pct,
           metrics->>'sharpe' AS sharpe,
           metrics->>'maxDrawdownPct' AS max_drawdown_pct,
           metrics->>'tradeCount' AS trade_count
    FROM backtest_runs
    ORDER BY created_at DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    runId: r.run_id as string,
    createdAt: new Date(r.created_at as string).toISOString(),
    symbol: r.symbol as string,
    strategyId: r.strategy_id as string,
    strategyName: r.strategy_name as string,
    startDate: toDateString(r.start_date),
    endDate: toDateString(r.end_date),
    totalReturnPct: Number(r.total_return_pct),
    sharpe: Number(r.sharpe),
    maxDrawdownPct: Number(r.max_drawdown_pct),
    tradeCount: Number(r.trade_count),
  }));
}

export async function getRun(runId: string): Promise<StoredRun | null> {
  const sql = requireDb();
  await ensureSchema();
  const rows = await sql`
    SELECT run_id, created_at, symbol, strategy_id, strategy_name, start_date, end_date,
           manifest, metrics, trades, equity, dates
    FROM backtest_runs WHERE run_id = ${runId}`;
  const r = rows[0];
  if (!r) return null;
  const metrics = r.metrics as Metrics;
  return {
    runId: r.run_id as string,
    createdAt: new Date(r.created_at as string).toISOString(),
    symbol: r.symbol as string,
    strategyId: r.strategy_id as string,
    strategyName: r.strategy_name as string,
    startDate: toDateString(r.start_date),
    endDate: toDateString(r.end_date),
    totalReturnPct: metrics.totalReturnPct,
    sharpe: metrics.sharpe,
    maxDrawdownPct: metrics.maxDrawdownPct,
    tradeCount: metrics.tradeCount,
    manifest: r.manifest as RunManifest,
    metrics,
    trades: r.trades as Trade[],
    dates: (r.dates as string[] | null) ?? null,
    equity: r.equity as number[],
  };
}

/** The driver returns DATE columns as Date objects or strings depending on the runtime. Normalise to YYYY-MM-DD. */
export function toDateString(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
