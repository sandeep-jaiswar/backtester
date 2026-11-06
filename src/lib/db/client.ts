import "server-only";
import { neon } from "@neondatabase/serverless";

/** A tagged-template SQL function that resolves to plain row objects. */
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

let sql: Sql | null = null;

/**
 * Returns a Neon SQL client, or null when DATABASE_URL is not set. Callers treat null as
 * "persistence off" so the backtester keeps working without a database (for example, in local dev).
 */
export function getDb(): Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  sql ??= neon(url, { fullResults: false }) as unknown as Sql;
  return sql;
}

export function isDbConfigured(): boolean {
  return getDb() !== null;
}

/** Throws a clear error when a database call is made without DATABASE_URL. */
export function requireDb(): Sql {
  const sql = getDb();
  if (!sql) throw new Error("DATABASE_URL is not set");
  return sql;
}
