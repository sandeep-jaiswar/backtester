import "server-only";
import { createHash } from "node:crypto";
import { getStrategy } from "./index";
import { canonicalJson } from "../backtest/manifest";
import { ruleStrategy } from "../backtest/rules";
import { isCustomId, getCustomStrategy } from "../db/strategies";
import { isDbConfigured } from "../db/client";
import type { Strategy } from "../backtest/types";

/**
 * Resolves a strategy id to a runnable Strategy. Built-in ids come from the code registry.
 * Custom ids ("custom:xxxxxxxx") load a saved rule definition from the database.
 * Returns null when the id is unknown or the custom strategy is not stored.
 */
export async function resolveStrategy(id: string): Promise<Strategy | null> {
  if (isCustomId(id)) {
    if (!isDbConfigured()) return null;
    const saved = await getCustomStrategy(id);
    if (!saved) return null;
    const definitionHash = createHash("sha256").update(canonicalJson(saved.definition)).digest("hex");
    return ruleStrategy(saved.id, saved.name, saved.description, saved.definition, definitionHash);
  }
  return getStrategy(id) ?? null;
}

/** Resolves every id, or returns the first unknown one. */
export async function resolveStrategies(
  ids: string[],
): Promise<{ strategies: Map<string, Strategy>; unknown: string | null }> {
  const strategies = new Map<string, Strategy>();
  for (const id of new Set(ids)) {
    const s = await resolveStrategy(id);
    if (!s) return { strategies, unknown: id };
    strategies.set(id, s);
  }
  return { strategies, unknown: null };
}
