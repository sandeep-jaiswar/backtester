import "server-only";
import { requireDb } from "./client";

let ready: Promise<void> | null = null;

/** Creates all tables once per server instance. Retries on the next call if creation fails. */
export function ensureSchema(): Promise<void> {
  const sql = requireDb();
  ready ??= (async () => {
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
    // Added after the first release. Older rows keep NULL and the UI falls back to equity indices.
    await sql`ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS dates JSONB`;
    await sql`CREATE INDEX IF NOT EXISTS backtest_runs_created_idx ON backtest_runs (created_at DESC)`;
    await sql`
      CREATE TABLE IF NOT EXISTS custom_strategies (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        definition  JSONB NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}
