"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EquityChart } from "@/components/backtest/equity-chart";
import { AnalyticsPanels } from "@/components/backtest/analytics-panels";
import { errorFrom } from "@/components/strategies/use-custom-strategies";
import { downloadText, toCsv } from "@/lib/csv";
import { downloadReport } from "@/lib/report-xlsx";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { verdict as summarise } from "@/lib/backtest/verdict";
import { Term } from "@/components/ui/term";
import type { GlossaryKey } from "@/lib/glossary";
import { readNdjson } from "@/lib/ndjson";
import type { StoredRun } from "@/lib/backtest/run-types";
import type { BacktestEvent } from "@/lib/backtest/stream-events";
import type { BacktestRequestBody } from "@/components/backtest/use-backtest-stream";
import { cn } from "@/lib/utils";

type Verdict =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; message: string }
  | { kind: "match" }
  | { kind: "dataChanged"; hashBefore: string; hashNow: string }
  | { kind: "differs"; runIdNow: string };

export function RunDetail({ runId }: { runId: string }) {
  const [run, setRun] = useState<StoredRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict>({ kind: "idle" });

  useEffect(() => {
    let alive = true;
    fetch(`/api/runs/${runId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await errorFrom(r, "Could not load this run"));
        return r.json() as Promise<StoredRun>;
      })
      .then((d) => alive && setRun(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [runId]);

  const currency = useMemo(() => (run && isIndian(run.symbol) ? "INR" : "USD"), [run]);
  const dates = useMemo(
    () => run?.dates ?? (run ? run.equity.map((_, i) => `#${i + 1}`) : []),
    [run],
  );

  if (error) {
    return (
      <main className="mx-auto max-w-4xl p-4 md:p-6">
        <Card className="border-negative/50">
          <CardContent>
            <p className="text-sm text-negative">{error}</p>
            <Link href="/runs" className="mt-3 inline-block text-sm underline">
              Back to history
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }
  if (!run) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  const m = run.metrics;
  const m2 = m as typeof m & { sortino?: number };
  const runVerdict = summarise(m, null);

  const exportReport = () =>
    downloadReport({
      fileName: `${run.runId}-report.xlsx`,
      manifest: run.manifest,
      metrics: run.metrics,
      trades: run.trades,
      dates: run.dates ?? dates,
      equity: run.equity,
    });

  const exportTrades = () =>
    downloadText(
      `${run.runId}-trades.csv`,
      toCsv([
        ["entry_date", "entry_price", "exit_date", "exit_price", "shares", "pnl", "return_pct", "bars_held", "fees", "open_at_end"],
        ...run.trades.map((t) => [t.entryDate, t.entryPrice, t.exitDate, t.exitPrice, t.shares, t.pnl, t.returnPct, t.barsHeld, t.fees, t.openAtEnd]),
      ]),
    );

  const exportEquity = () =>
    downloadText(
      `${run.runId}-equity.csv`,
      toCsv([["date", "equity"], ...run.equity.map((v, i) => [dates[i], v])]),
    );

  return (
    <main className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <Link href="/runs" className="text-sm text-muted-foreground underline underline-offset-4">
            ← History
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{run.strategyName}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge>{run.symbol}</Badge>
            <Badge variant="outline">
              {run.startDate} → {run.endDate}
            </Badge>
            <Badge variant="outline">{currency}</Badge>
            <Badge variant="secondary">Engine {run.manifest.engineVersion}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportReport}>Excel report</Button>
          <Button variant="outline" onClick={exportTrades}>Trades CSV</Button>
          <Button variant="outline" onClick={exportEquity}>Equity CSV</Button>
          <Button onClick={() => reproduce(run, setVerdict)} disabled={verdict.kind === "running"}>
            {verdict.kind === "running" ? "Re-running…" : "Reproduce"}
          </Button>
        </div>
      </div>

      <VerdictBanner verdict={verdict} runId={run.runId} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total return" value={fmtPct(m.totalReturnPct)} tone={m.totalReturnPct >= 0 ? "pos" : "neg"} />
        <Stat label="CAGR" value={fmtPct(m.cagrPct)} />
        <Stat term="maxDrawdown" label="Max drawdown" value={fmtPct(m.maxDrawdownPct)} tone="neg" />
        <Stat term="sharpe" label="Sharpe" value={fmtNum(m.sharpe)} />
        <Stat term="sortino" label="Sortino" value={m2.sortino !== undefined ? fmtNum(m2.sortino) : "—"} />
        <Stat term="calmar" label="Calmar" value={fmtNum(m.calmar)} />
        <Stat label="Trades" value={String(m.tradeCount)} />
        <Stat term="winRate" label="Win rate" value={`${fmtNum(m.winRatePct, 1)}%`} />
        <Stat term="profitFactor" label="Profit factor" value={m.profitFactor === null ? "no losses" : fmtNum(m.profitFactor)} />
        <Stat label="Fees paid" value={fmtMoney(m.totalFeesPaid, currency)} />
        <Stat term="exposure" label="Time in market" value={`${fmtNum(m.exposurePct, 1)}%`} />
        <Stat label="Final value" value={fmtMoney(m.endValue, currency)} />
      </div>

      <Card>
        <CardContent className="grid gap-2 text-sm">
          <p>{runVerdict.headline}</p>
          {runVerdict.caveats.map((c) => (
            <p key={c} className="text-xs text-muted-foreground">
              {c}
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Equity</CardTitle>
          <CardDescription>
            {run.dates ? "Portfolio value at each close." : "This run was saved before dates were stored, so the axis shows bar numbers."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EquityChart
            dates={dates}
            currency={currency}
            series={[{ key: "equity", name: run.strategyName, color: "var(--chart-1)", values: run.equity }]}
          />
        </CardContent>
      </Card>

      <AnalyticsPanels dates={run.dates} equity={run.equity} metrics={run.metrics} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Reproducibility</CardTitle>
            <CardDescription>Everything that determines this result. Same inputs give the same run ID.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Run ID</dt>
              <dd className="font-mono">{run.manifest.runId}</dd>
              <dt className="text-muted-foreground">Dataset hash</dt>
              <dd className="break-all font-mono text-xs">{run.manifest.datasetHash}</dd>
              <dt className="text-muted-foreground">Strategy id</dt>
              <dd className="font-mono">{run.manifest.strategyId}</dd>
              <dt className="text-muted-foreground">Parameters</dt>
              <dd className="font-mono">{JSON.stringify(run.manifest.params)}</dd>
              <dt className="text-muted-foreground">Capital</dt>
              <dd>{fmtMoney(run.manifest.capital, currency)}</dd>
              <dt className="text-muted-foreground">Cost profile</dt>
              <dd>{run.manifest.costProfile}</dd>
              <dt className="text-muted-foreground">Buy / sell fee</dt>
              <dd>
                {fmtPct(run.manifest.costModel.rateBuy * 100, 4)} / {fmtPct(run.manifest.costModel.rateSell * 100, 4)}
                {run.manifest.costModel.fixedPerSell ? ` + ${run.manifest.costModel.fixedPerSell} per sell` : ""}
              </dd>
              <dt className="text-muted-foreground">Slippage</dt>
              <dd>{run.manifest.slippageBps} bps per side</dd>
              <dt className="text-muted-foreground">Risk-free rate</dt>
              <dd>{run.manifest.riskFreeRatePct}%</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trades</CardTitle>
            <CardDescription>{run.trades.length} trades. Shows the first 200.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Entry</th>
                  <th className="p-2">Exit</th>
                  <th className="p-2 text-right">P&amp;L</th>
                  <th className="p-2 text-right">Return</th>
                  <th className="p-2 text-right">Bars</th>
                </tr>
              </thead>
              <tbody>
                {run.trades.slice(0, 200).map((t, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 whitespace-nowrap">{t.entryDate}</td>
                    <td className="p-2 whitespace-nowrap">
                      {t.exitDate}
                      {t.openAtEnd ? <span className="ml-1 text-xs text-muted-foreground">(open)</span> : null}
                    </td>
                    <td className={cn("p-2 text-right tabular-nums", t.pnl >= 0 ? "text-positive" : "text-negative")}>
                      {fmtMoney(t.pnl, currency)}
                    </td>
                    <td className="p-2 text-right tabular-nums">{fmtPct(t.returnPct)}</td>
                    <td className="p-2 text-right tabular-nums">{t.barsHeld}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Stat({ label, term, value, tone }: { label: string; term?: GlossaryKey; value: string; tone?: "pos" | "neg" }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="grid gap-1">
        <span className="text-xs text-muted-foreground">{term ? <Term id={term}>{label}</Term> : label}</span>
        <span className={cn("text-lg font-semibold tabular-nums", tone === "pos" && "text-positive", tone === "neg" && "text-negative")}>
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function VerdictBanner({ verdict, runId }: { verdict: Verdict; runId: string }) {
  if (verdict.kind === "idle" || verdict.kind === "running") return null;
  if (verdict.kind === "error") {
    return <p className="text-sm text-negative">Reproduce failed: {verdict.message}</p>;
  }
  if (verdict.kind === "match") {
    return (
      <p className="text-sm text-positive">
        Reproduced. Run {runId} came out identical from the same inputs and data.
      </p>
    );
  }
  if (verdict.kind === "dataChanged") {
    return (
      <p className="text-sm text-muted-foreground">
        The price data has changed since this run was saved, so the result can differ. Dataset hash {verdict.hashBefore.slice(0, 12)} is now {verdict.hashNow.slice(0, 12)}.
      </p>
    );
  }
  return (
    <p className="text-sm text-negative">
      Same data, different result. The run ID is now {verdict.runIdNow}. The engine or the strategy definition has changed since this run was saved.
    </p>
  );
}

/** Re-runs the saved inputs through /api/backtest and compares the new run ID and dataset hash. */
async function reproduce(run: StoredRun, setVerdict: (v: Verdict) => void) {
  setVerdict({ kind: "running" });
  const m = run.manifest;
  const body: BacktestRequestBody = {
    symbol: m.symbol,
    start: m.start,
    end: m.end,
    capital: m.capital,
    commissionBps: Math.round(m.costModel.rateBuy * 10_000 * 1000) / 1000,
    slippageBps: m.slippageBps,
    costProfile: m.costProfile as BacktestRequestBody["costProfile"],
    riskFreeRatePct: m.riskFreeRatePct,
    stopLossPct: m.stopLossPct,
    takeProfitPct: m.takeProfitPct,
    positionFraction: m.positionFraction,
    runs: [{ strategyId: m.strategyId, params: m.params }],
  };
  try {
    const res = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await errorFrom(res, "Re-run failed"));
    let newHash: string | null = null;
    let result: Extract<BacktestEvent, { type: "result" }> | null = null;
    let failure: string | null = null;
    await readNdjson<BacktestEvent>(res, (ev) => {
      if (ev.type === "data") newHash = ev.datasetHash;
      if (ev.type === "result" && ev.index === 0) result = ev;
      if (ev.type === "error") failure = ev.message;
    });
    if (failure) throw new Error(failure);
    const got = result as Extract<BacktestEvent, { type: "result" }> | null;
    if (!got || !newHash) throw new Error("No result came back");
    if (newHash !== m.datasetHash) {
      setVerdict({ kind: "dataChanged", hashBefore: m.datasetHash, hashNow: newHash });
    } else if (got.manifest.runId === m.runId) {
      setVerdict({ kind: "match" });
    } else {
      setVerdict({ kind: "differs", runIdNow: got.manifest.runId });
    }
  } catch (e) {
    setVerdict({ kind: "error", message: e instanceof Error ? e.message : "Unknown error" });
  }
}

function isIndian(symbol: string) {
  return /\.(NS|BO)$/.test(symbol);
}
