import { createHash } from "node:crypto";
import type { Bar, CostModel } from "./types";
import { ENGINE_VERSION } from "./config";

/** Everything that determines a run's output. Two requests with equal inputs must produce equal results. */
export interface RunInputs {
  symbol: string;
  start: string;
  end: string;
  datasetHash: string;
  capital: number;
  costProfile: string;
  costModel: CostModel;
  slippageBps: number;
  riskFreeRatePct: number;
  strategyId: string;
  params: Record<string, number>;
}

export interface RunManifest extends RunInputs {
  engineVersion: string;
  /** First 16 hex chars of the SHA-256 of the canonical inputs. Stable across processes. */
  runId: string;
}

/** Hashes the bar series, so a dataset that changes (for example a restated price) yields a new hash. */
export function hashBars(bars: Bar[]): string {
  const h = createHash("sha256");
  for (const b of bars) {
    h.update(
      `${b.date.toISOString().slice(0, 10)}|${b.open}|${b.high}|${b.low}|${b.close}|${b.volume}\n`,
    );
  }
  return h.digest("hex");
}

export function buildManifest(inputs: RunInputs): RunManifest {
  const payload = canonicalJson({ engineVersion: ENGINE_VERSION, ...inputs });
  const runId = createHash("sha256").update(payload).digest("hex").slice(0, 16);
  return { ...inputs, engineVersion: ENGINE_VERSION, runId };
}

/** JSON with object keys sorted at every level, so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
