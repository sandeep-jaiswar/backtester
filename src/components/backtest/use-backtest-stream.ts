"use client";

import { useCallback, useRef, useState } from "react";
import type { BacktestEvent } from "@/lib/backtest/stream-events";

export type ResultEvent = Extract<BacktestEvent, { type: "result" }>;

export interface StreamState {
  status: "idle" | "running" | "done" | "error";
  symbol?: string;
  currency?: string;
  dates: string[];
  barCount?: number;
  /** Results keyed by run index (-1 = benchmark). */
  results: Record<number, ResultEvent>;
  /** Per-run errors keyed by run index. */
  runErrors: Record<number, string>;
  error?: string;
  elapsedMs?: number;
}

const initial: StreamState = { status: "idle", dates: [], results: {}, runErrors: {} };

export interface BacktestRequestBody {
  symbol: string;
  start: string;
  end: string;
  capital: number;
  commissionBps: number;
  slippageBps: number;
  /** Omit to choose by symbol: Indian exchange suffixes get delivery charges. */
  costProfile?: "flat" | "india-delivery";
  riskFreeRatePct?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  /** Share of available cash per entry, 0 < x <= 1. */
  positionFraction?: number;
  runs: { strategyId: string; params: Record<string, number> }[];
}

/**
 * Posts a backtest and applies each NDJSON event as it arrives, so results render
 * one by one while the other strategies are still running on the server.
 */
export function useBacktestStream() {
  const [state, setState] = useState<StreamState>(initial);
  const abortRef = useRef<AbortController | null>(null);

  const apply = useCallback((event: BacktestEvent) => {
    setState((prev) => {
      switch (event.type) {
        case "data":
          return {
            ...initial,
            status: "running",
            symbol: event.symbol,
            currency: event.currency,
            dates: event.dates,
            barCount: event.barCount,
          };
        case "result":
          return { ...prev, results: { ...prev.results, [event.index]: event } };
        case "error":
          if (event.index !== undefined) {
            return { ...prev, runErrors: { ...prev.runErrors, [event.index]: event.message } };
          }
          return { ...prev, status: "error", error: event.message };
        case "done":
          return { ...prev, status: prev.status === "error" ? "error" : "done", elapsedMs: event.elapsedMs };
      }
    });
  }, []);

  const run = useCallback(
    async (body: BacktestRequestBody) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ ...initial, status: "running" });

      try {
        const res = await fetch("/api/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const json = await res.json().catch(() => null);
          throw new Error(json?.error ?? `Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) apply(JSON.parse(line) as BacktestEvent);
          }
        }
        const tail = buffer.trim();
        if (tail) apply(JSON.parse(tail) as BacktestEvent);
      } catch (err) {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          status: "error",
          error: err instanceof Error ? err.message : "Backtest failed",
        }));
      }
    },
    [apply],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, status: prev.status === "running" ? "done" : prev.status }));
  }, []);

  return { state, run, cancel };
}
