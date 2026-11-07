"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtNum, fmtPct } from "@/lib/format";
import type { RunSummary } from "@/lib/backtest/run-types";
import { errorFrom } from "@/components/strategies/use-custom-strategies";

const MAX_COMPARE = 5;

export function RunsList() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [strategyFilter, setStrategyFilter] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/runs?limit=100")
      .then(async (r) => {
        if (!r.ok) throw new Error(await errorFrom(r, "Could not load run history"));
        return r.json() as Promise<{ runs: RunSummary[] }>;
      })
      .then((d) => alive && setRuns(d.runs))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const visible = useMemo(() => {
    if (!runs) return [];
    const q = strategyFilter.trim().toLowerCase();
    return q ? runs.filter((r) => `${r.strategyName} ${r.symbol}`.toLowerCase().includes(q)) : runs;
  }, [runs, strategyFilter]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });

  return (
    <main className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Run history</h1>
          <p className="text-sm text-muted-foreground">
            Every backtest you run is saved. Pick two to {MAX_COMPARE} runs to compare them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            aria-label="Filter runs"
            placeholder="Filter by strategy or symbol"
            value={strategyFilter}
            onChange={(e) => setStrategyFilter(e.target.value)}
            className="h-9 w-56 rounded-md border border-input bg-transparent px-3 text-sm"
          />
          {picked.length >= 2 ? (
            <Link
              href={`/compare?ids=${picked.join(",")}`}
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Compare {picked.length}
            </Link>
          ) : (
            <Button variant="outline" disabled>
              Compare
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <Card className="border-negative/50">
          <CardContent>
            <p className="text-sm text-negative">{error}</p>
          </CardContent>
        </Card>
      ) : runs === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : runs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No saved runs yet</CardTitle>
            <CardDescription>Run a backtest from the Backtest page and it will appear here.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-10 p-3" aria-label="Select" />
                <th className="p-3">Saved</th>
                <th className="p-3">Strategy</th>
                <th className="p-3">Symbol</th>
                <th className="p-3">Period</th>
                <th className="p-3 text-right">Return</th>
                <th className="p-3 text-right">Sharpe</th>
                <th className="p-3 text-right">Max DD</th>
                <th className="p-3 text-right">Trades</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const checked = picked.includes(r.runId);
                const disabled = !checked && picked.length >= MAX_COMPARE;
                return (
                  <tr key={r.runId} className="border-t hover:bg-accent/40">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label={`Select run ${r.runId}`}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(r.runId)}
                      />
                    </td>
                    <td className="p-3 whitespace-nowrap text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                    </td>
                    <td className="p-3">{r.strategyName}</td>
                    <td className="p-3">{r.symbol}</td>
                    <td className="p-3 whitespace-nowrap">
                      {r.startDate} → {r.endDate}
                    </td>
                    <td className="p-3 text-right tabular-nums">{fmtPct(r.totalReturnPct)}</td>
                    <td className="p-3 text-right tabular-nums">{fmtNum(r.sharpe)}</td>
                    <td className="p-3 text-right tabular-nums">{fmtPct(r.maxDrawdownPct)}</td>
                    <td className="p-3 text-right tabular-nums">{r.tradeCount}</td>
                    <td className="p-3 text-right">
                      <Link href={`/runs/${r.runId}`} className="underline underline-offset-4">
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
