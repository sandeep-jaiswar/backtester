"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { errorFrom } from "@/components/strategies/use-custom-strategies";
import { downloadText, toCsv } from "@/lib/csv";
import { fmtNum, fmtPct } from "@/lib/format";
import type { StoredRun } from "@/lib/backtest/run-types";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const MAX = 5;

type Row = { label: string; key: string; fmt: (v: number | null | undefined) => string };

const ROWS: Row[] = [
  { label: "Total return", key: "totalReturnPct", fmt: (v) => fmtPct(v ?? NaN) },
  { label: "CAGR", key: "cagrPct", fmt: (v) => fmtPct(v ?? NaN) },
  { label: "Max drawdown", key: "maxDrawdownPct", fmt: (v) => fmtPct(v ?? NaN) },
  { label: "Volatility", key: "volatilityPct", fmt: (v) => (v === undefined || v === null ? "—" : `${fmtNum(v, 1)}%`) },
  { label: "Sharpe", key: "sharpe", fmt: (v) => fmtNum(v ?? NaN) },
  { label: "Sortino", key: "sortino", fmt: (v) => (v === undefined || v === null ? "—" : fmtNum(v)) },
  { label: "Calmar", key: "calmar", fmt: (v) => fmtNum(v ?? NaN) },
  { label: "Trades", key: "tradeCount", fmt: (v) => String(v ?? "—") },
  { label: "Win rate", key: "winRatePct", fmt: (v) => `${fmtNum(v ?? NaN, 1)}%` },
  { label: "Profit factor", key: "profitFactor", fmt: (v) => (v === null ? "no losses" : fmtNum(v ?? NaN)) },
  { label: "Fees paid", key: "totalFeesPaid", fmt: (v) => (v === undefined || v === null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 0 })) },
  { label: "Time in market", key: "exposurePct", fmt: (v) => `${fmtNum(v ?? NaN, 1)}%` },
];

export function CompareView() {
  const params = useSearchParams();
  const ids = useMemo(
    () => (params.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX),
    [params],
  );
  const [runs, setRuns] = useState<StoredRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tooFew = ids.length < 2;

  useEffect(() => {
    if (tooFew) return;
    let alive = true;
    Promise.all(
      ids.map(async (id) => {
        const r = await fetch(`/api/runs/${id}`);
        if (!r.ok) throw new Error(await errorFrom(r, `Could not load run ${id}`));
        return (await r.json()) as StoredRun;
      }),
    )
      .then((rs) => alive && setRuns(rs))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [ids, tooFew]);

  // Align curves by date. Runs saved without dates cannot be placed on a date axis, so they are left out of the chart.
  const chart = useMemo(() => {
    if (!runs) return { data: [] as Record<string, string | number | null>[], dropped: [] as string[] };
    const dropped = runs.filter((r) => !r.dates).map((r) => r.strategyName);
    const dated = runs.filter((r) => r.dates);
    const byDate = new Map<string, Record<string, string | number | null>>();
    for (const r of dated) {
      r.dates!.forEach((d, i) => {
        const row = byDate.get(d) ?? { date: d };
        row[r.runId] = r.equity[i];
        byDate.set(d, row);
      });
    }
    const data = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { data, dropped };
  }, [runs]);

  const shownError = tooFew ? "Pick at least two runs from History to compare." : error;
  if (shownError) {
    return (
      <main className="mx-auto max-w-4xl p-4 md:p-6">
        <Card className="border-negative/50">
          <CardContent>
            <p className="text-sm text-negative">{shownError}</p>
            <Link href="/runs" className="mt-3 inline-block text-sm underline">
              Back to history
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }
  if (!runs) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  const exportCsv = () =>
    downloadText(
      "comparison.csv",
      toCsv([
        ["metric", ...runs.map((r) => `${r.strategyName} (${r.runId})`)],
        ...ROWS.map((row) => [
          row.label,
          ...runs.map((r) => (r.metrics as unknown as Record<string, number | null | undefined>)[row.key] ?? ""),
        ]),
      ]),
    );

  return (
    <main className="mx-auto grid max-w-7xl gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <Link href="/runs" className="text-sm text-muted-foreground underline underline-offset-4">
            ← History
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Compare runs</h1>
        </div>
        <Button variant="outline" onClick={exportCsv}>
          Comparison CSV
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Equity</CardTitle>
          <CardDescription>
            {chart.dropped.length > 0
              ? `${chart.dropped.join(", ")} ${chart.dropped.length === 1 ? "was" : "were"} saved before dates were stored and cannot be placed on this chart.`
              : "Each curve is the portfolio value at each close, aligned by date."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart.data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" minTickGap={48} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis domain={["auto", "auto"]} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend />
                {runs.filter((r) => r.dates).map((r, i) => (
                  <Line
                    key={r.runId}
                    type="monotone"
                    dataKey={r.runId}
                    name={`${r.strategyName} · ${r.symbol}`}
                    stroke={COLORS[i % COLORS.length]}
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Metric</th>
              {runs.map((r, i) => (
                <th key={r.runId} className="p-3">
                  <span style={{ color: COLORS[i % COLORS.length] }}>■ </span>
                  {r.strategyName}
                  <div className="font-normal">
                    {r.symbol} · {r.startDate} → {r.endDate}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key} className="border-t">
                <td className="p-3 text-muted-foreground">{row.label}</td>
                {runs.map((r) => (
                  <td key={r.runId} className="p-3 tabular-nums">
                    {row.fmt((r.metrics as unknown as Record<string, number | null | undefined>)[row.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
