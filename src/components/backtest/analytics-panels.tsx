"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { drawdownEpisodes, monthlyReturns } from "@/lib/backtest/analytics";
import { drawdownSeries } from "@/lib/backtest/metrics";
import type { Metrics } from "@/lib/backtest/types";
import { fmtNum, fmtPct } from "@/lib/format";
import { Term } from "@/components/ui/term";
import type { GlossaryKey } from "@/lib/glossary";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Props {
  /** Null for runs saved before dates were stored. Drawdown dates and monthly returns need them. */
  dates: string[] | null;
  equity: number[];
  metrics: Metrics;
}

/** Benchmark comparison, underwater curve, worst drawdowns and monthly returns for one run. */
export function AnalyticsPanels({ dates, equity, metrics }: Props) {
  const bench = metrics.benchmark ?? null;
  return (
    <div className="grid gap-6">
      {bench ? (
        <Card>
          <CardHeader>
            <CardTitle>Versus buy &amp; hold</CardTitle>
            <CardDescription>
              Compared with buy &amp; hold on the same symbol and dates. Alpha is annualised with the risk-free rate.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Tile term="alpha" label="Alpha (ann.)" value={fmtPct(bench.alphaPct)} tone={bench.alphaPct >= 0 ? "pos" : "neg"} />
            <Tile term="beta" label="Beta" value={fmtNum(bench.beta, 2)} />
            <Tile term="informationRatio" label="Information ratio" value={fmtNum(bench.informationRatio)} />
            <Tile term="trackingError" label="Tracking error" value={fmtPct(bench.trackingErrorPct)} />
            <Tile term="upCapture" label="Up capture" value={bench.upCapturePct === null ? "—" : `${fmtNum(bench.upCapturePct, 1)}%`} />
            <Tile term="downCapture" label="Down capture" value={bench.downCapturePct === null ? "—" : `${fmtNum(bench.downCapturePct, 1)}%`} />
          </CardContent>
        </Card>
      ) : null}

      {dates ? (
        <>
          <UnderwaterChart dates={dates} equity={equity} />
          <DrawdownTable dates={dates} equity={equity} />
          <MonthlyTable dates={dates} equity={equity} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This run was saved before dates were stored, so the drawdown and monthly views are not available.
        </p>
      )}
    </div>
  );
}

function UnderwaterChart({ dates, equity }: { dates: string[]; equity: number[] }) {
  const data = useMemo(() => {
    const dd = drawdownSeries(equity);
    return dates.map((date, i) => ({ date, drawdownPct: round2(dd[i] * 100) }));
  }, [dates, equity]);
  const worst = Math.min(0, ...data.map((d) => d.drawdownPct));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Underwater</CardTitle>
        <CardDescription>Distance below the previous peak at each close. Worst: {fmtPct(worst)}.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} width={56} />
              <Tooltip formatter={(v) => `${fmtNum(Number(v), 2)}%`} />
              <Area type="monotone" dataKey="drawdownPct" name="Drawdown" stroke="var(--negative)" fill="var(--negative)" fillOpacity={0.2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function DrawdownTable({ dates, equity }: { dates: string[]; equity: number[] }) {
  const episodes = useMemo(() => drawdownEpisodes(equity, dates, 5), [dates, equity]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Worst drawdowns</CardTitle>
        <CardDescription>The five deepest falls from a peak, with the trough and the day the peak was regained.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {episodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No drawdowns: equity never fell below a previous peak.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-medium">Peak</th>
                <th className="py-2 pr-4 font-medium">Trough</th>
                <th className="py-2 pr-4 font-medium">Recovered</th>
                <th className="py-2 pr-4 text-right font-medium">Depth</th>
                <th className="py-2 text-right font-medium">Bars</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((e) => (
                <tr key={`${e.startDate}-${e.troughDate}`} className="border-t">
                  <td className="py-2 pr-4 font-mono text-xs">{e.startDate}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{e.troughDate}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{e.recoveryDate ?? "not yet"}</td>
                  <td className="py-2 pr-4 text-right text-negative">{fmtPct(e.depthPct)}</td>
                  <td className="py-2 text-right">{e.bars}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function MonthlyTable({ dates, equity }: { dates: string[]; equity: number[] }) {
  const { years, cells } = useMemo(() => {
    const monthly = monthlyReturns(equity, dates);
    const map = new Map<string, number>();
    const yearSet = new Set<number>();
    for (const m of monthly) {
      map.set(`${m.year}-${m.month}`, m.returnPct);
      yearSet.add(m.year);
    }
    const yearTotals = [...yearSet].sort((a, b) => a - b).map((year) => {
      const rs = monthly.filter((m) => m.year === year).map((m) => m.returnPct / 100);
      return { year, totalPct: round2((rs.reduce((acc, r) => acc * (1 + r), 1) - 1) * 100) };
    });
    return { years: yearTotals, cells: map };
  }, [dates, equity]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly returns</CardTitle>
        <CardDescription>Month-end to month-end. The year column compounds the months shown, so a partial year is partial.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {years.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not enough data for monthly returns.</p>
        ) : (
          <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-center text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Year</th>
                {MONTHS.map((m) => (
                  <th key={m} className="py-1 font-medium">{m}</th>
                ))}
                <th className="py-1 font-medium">Year</th>
              </tr>
            </thead>
            <tbody>
              {years.map(({ year, totalPct }) => (
                <tr key={year}>
                  <td className="py-1 text-left font-mono">{year}</td>
                  {MONTHS.map((_, i) => {
                    const r = cells.get(`${year}-${i + 1}`);
                    return (
                      <td key={i} className="rounded py-1.5" style={heatStyle(r)} title={r === undefined ? "" : `${fmtPct(r)}`}>
                        {r === undefined ? "" : fmtNum(r, 1)}
                      </td>
                    );
                  })}
                  <td className="rounded py-1.5 font-semibold" style={heatStyle(totalPct)}>{fmtNum(totalPct, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/** Background intensity grows with the size of the month's return, capped at 10%. */
function heatStyle(r: number | undefined): React.CSSProperties {
  if (r === undefined || r === 0) return {};
  const strength = Math.round(Math.min(Math.abs(r) / 10, 1) * 55);
  const colour = r > 0 ? "var(--positive)" : "var(--negative)";
  return { backgroundColor: `color-mix(in oklch, ${colour} ${strength}%, transparent)` };
}

function Tile({ label, term, value, tone }: { label: string; term?: GlossaryKey; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="grid gap-1 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{term ? <Term id={term}>{label}</Term> : label}</span>
      <span className={tone === "pos" ? "font-semibold text-positive" : tone === "neg" ? "font-semibold text-negative" : "font-semibold"}>
        {value}
      </span>
    </div>
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
