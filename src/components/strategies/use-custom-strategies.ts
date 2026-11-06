"use client";

import { useEffect, useState } from "react";

export interface SavedParam {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
}

/** A saved no-code strategy as returned by GET /api/strategies. */
export interface SavedStrategy {
  id: string;
  name: string;
  description: string;
  definition: { version: 1; params: SavedParam[]; entry: unknown; exit: unknown };
  updatedAt: string;
}

/** Loads saved custom strategies. Returns an empty list when storage is off or the request fails. */
export function useCustomStrategies(): SavedStrategy[] {
  const [list, setList] = useState<SavedStrategy[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/strategies")
      .then((r) => (r.ok ? r.json() : { strategies: [] }))
      .then((d: { strategies?: SavedStrategy[] }) => {
        if (alive) setList(d.strategies ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

/** Reads an error message from a non-OK API response, falling back to a generic one. */
export async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}
