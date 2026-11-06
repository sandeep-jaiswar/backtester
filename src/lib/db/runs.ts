import "server-only";
import { getDb } from "./client";
import type { RunManifest } from "../backtest/manifest";
import type { Metrics, Trade } from "../backtest/types";

/** Everything stored for one run. `runId` is the manifest hash, so re-saving an identical run is a no-op. */
export interface StoredRunInput {
  manifest: RunManifest;
  strategyName: string;
  metrics: Metrics;
  trades: Trade[];
  equity: number[];
}

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
  equity: number[];
}

let schemaReady: Promise<void> | null = null;

/** Creates the table once per server instance. Retries on the next call if creation fails. */
export function ensureSchema(): Promise<void> {
  const sql = getDb();
  if (!sql) return Promise.reject(new Error("DATABASE_URL is not set"));
  schemaReady ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS backtest_runs (
        run_id         TEXT PRIMARY KEY,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        symbol         TEXT NOT NULL,
        strategy_id    TEXT NOT NULL,
        strategy_name  TEXT NOT NULL,
        start_date     DATE NOT NULL,
        end_date       DATE NOT NULL,
        engine_version TEXT NOT NULL,
        manifest       JSONB NOT NULL,
        metrics        JSONB NOT NULL,
        trades         JSONB NOT NULL,
        equity         JSONB NOT NULL
      )`;
    await sql`CREATE INDEX IF NOT EXISTS backtest_runs_created_idx ON backtest_runs (created_at DESC)`;
  })().catch((err) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

export function isDbConfigured(): boolean {
  return getDb() !== null;
}

/** Saves a run. Returns true if it was inserted, false if an identical run was already stored. */
export async function saveRun(run: StoredRunInput): Promise<boolean> {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL is not set");
  await ensureSchema();
  const m = run.manifest;
  const rows = await sql`
    INSERT INTO backtest_runs
      (run_id, symbol, strategy_id, strategy_name, start_date, end_date, engine_version,
       manifest, metrics, trades, equity)
    VALUES
      (${m.runId}, ${m.symbol}, ${m.strategyId}, ${run.strategyName}, ${m.start}, ${m.end},
       ${m.engineVersion}, ${JSON.stringify(m)}::jsonb, ${JSON.stringify(run.metrics)}::jsonb,
       ${JSON.stringify(run.trades)}::jsonb, ${JSON.stringify(run.equity)}::jsonb)
    ON CONFLICT (run_id) DO NOTHING
    RETURNING run_id`;
  return rows.length > 0;
}

/** Most recent runs first. Heavy columns (equity, trades) are left out of the listing. */
export async function listRuns(limit: number): Promise<RunSummary[]> {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL is not set");
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
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL is not set");
  await ensureSchema();
  const rows = await sql`
    SELECT run_id, created_at, symbol, strategy_id, strategy_name, start_date, end_date,
           manifest, metrics, trades, equity
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
    equity: r.equity as number[],
  };
}

/** The driver returns DATE columns as Date objects or strings depending on the runtime. Normalise to YYYY-MM-DD. */
function toDateString(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
