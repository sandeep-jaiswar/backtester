import "server-only";
import { randomBytes } from "node:crypto";
import { requireDb } from "./client";
import { ensureSchema } from "./schema";
import { ruleDefinitionSchema, type RuleDefinition } from "../backtest/rules";

export const CUSTOM_PREFIX = "custom:";
const CUSTOM_ID = /^custom:[a-z0-9]{8}$/;

export function isCustomId(id: string): boolean {
  return CUSTOM_ID.test(id);
}

export interface CustomStrategy {
  id: string;
  name: string;
  description: string;
  definition: RuleDefinition;
  updatedAt: string;
}

function newId(): string {
  return `${CUSTOM_PREFIX}${randomBytes(4).toString("hex")}`;
}

export async function listCustomStrategies(): Promise<CustomStrategy[]> {
  const sql = requireDb();
  await ensureSchema();
  const rows = await sql`SELECT id, name, description, definition, updated_at FROM custom_strategies ORDER BY updated_at DESC`;
  return rows.map(toStrategy);
}

export async function getCustomStrategy(id: string): Promise<CustomStrategy | null> {
  if (!isCustomId(id)) return null;
  const sql = requireDb();
  await ensureSchema();
  const rows = await sql`SELECT id, name, description, definition, updated_at FROM custom_strategies WHERE id = ${id}`;
  return rows[0] ? toStrategy(rows[0]) : null;
}

export async function createCustomStrategy(input: { name: string; description: string; definition: RuleDefinition }): Promise<CustomStrategy> {
  const sql = requireDb();
  await ensureSchema();
  const id = newId();
  const rows = await sql`
    INSERT INTO custom_strategies (id, name, description, definition)
    VALUES (${id}, ${input.name}, ${input.description}, ${JSON.stringify(input.definition)}::jsonb)
    RETURNING id, name, description, definition, updated_at`;
  return toStrategy(rows[0]);
}

export async function updateCustomStrategy(
  id: string,
  input: { name: string; description: string; definition: RuleDefinition },
): Promise<CustomStrategy | null> {
  if (!isCustomId(id)) return null;
  const sql = requireDb();
  await ensureSchema();
  const rows = await sql`
    UPDATE custom_strategies
    SET name = ${input.name}, description = ${input.description},
        definition = ${JSON.stringify(input.definition)}::jsonb, updated_at = now()
    WHERE id = ${id}
    RETURNING id, name, description, definition, updated_at`;
  return rows[0] ? toStrategy(rows[0]) : null;
}

export async function deleteCustomStrategy(id: string): Promise<boolean> {
  if (!isCustomId(id)) return false;
  const sql = requireDb();
  await ensureSchema();
  const rows = await sql`DELETE FROM custom_strategies WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

function toStrategy(r: Record<string, unknown>): CustomStrategy {
  // Re-validate on read, so a row written by an older schema cannot crash the engine.
  const parsed = ruleDefinitionSchema.parse(r.definition);
  return {
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    definition: parsed,
    updatedAt: new Date(r.updated_at as string).toISOString(),
  };
}

