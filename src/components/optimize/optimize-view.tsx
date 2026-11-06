"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EquityChart } from "@/components/backtest/equity-chart";
import { errorFrom, useCustomStrategies } from "@/components/strategies/use-custom-strategies";
import { DEFAULT_BACKTEST, BENCHMARK_STRATEGY_ID } from "@/lib/backtest/config";
import { MAX_GRID_AXES, MAX_GRID_COMBOS, OPTIMIZE_METRICS, type OptimizeMetric, type OptimizeResult, type Stats } from "@/lib/backtest/optimize";
import type { OptimizeEvent } from "@/lib/backtest/optimize-events";
import { readNdjson } from "@/lib/ndjson";
import { strategies as builtin } from "@/lib/strategies";
import { fmtNum, fmtPct } from "@/lib/format";

interface Choice {
  id: string;
  name: string;
  params: { key: string; label: string; default: number; min: number; max: number; step: number }[];
}

interface AxisState {
  enabled: boolean;
  min: number;
  max: number;
  step: number;
}

type ValidationChoice = "none" | "split" | "walkForward";

const METRIC_LABEL: Record<OptimizeMetric, string> = {
  sharpe: "Sharpe",
  sortino: "Sortino",
  cagrPct: "CAGR %",
  calmar: "Calmar",
  totalReturnPct: "Total return %",
};

export function OptimizeView() {
  const custom = useCustomStrategies();
  const choices: Choice[] = useMemo(
    () => [
      ...builtin.filter((s) => s.id !== BENCHMARK_STRATEGY_ID).map((s) => ({ id: s.id, name: s.name, params: s.params })),
      ...custom.map((c) => ({ id: c.id, name: c.name, params: c.definition.params })),
    ],
    [custom],
  );

  const [symbol, setSymbol] = useState<string>(DEFAULT_BACKTEST.symbol);
  const [start, setStart] = useState<string>(DEFAULT_BACKTEST.startDate);
  const [end, setEnd] = useState("");
  const [capital, setCapital] = useState<number>(DEFAULT_BACKTEST.capital);
  const [commissionBps, setCommissionBps] = useState<number>(DEFAULT_BACKTEST.commissionBps);
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_BACKTEST.slippageBps);
  const [riskFreeRatePct, setRiskFreeRatePct] = useState<number>(DEFAULT_BACKTEST.riskFreeRatePct);
  const [strategyId, setStrategyId] = useState<string>("sma-crossover");
  // Per-strategy overrides. Anything not overridden falls back to the parameter's own range, so no effect is needed to reset it.
  const [overrides, setOverrides] = useState<Record<string, Record<string, AxisState>>>({});
  const [validation, setValidation] = useState<ValidationChoice>("walkForward");
  const [trainFraction, setTrainFraction] = useState(0.7);
  const [folds, setFolds] = useState(4);
  const [metric, setMetric] = useState<OptimizeMetric>("sharpe");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<Extract<OptimizeEvent, { type: "result" }> | null>(null);

  // The default end date is set on the client to avoid a server/client mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only value, avoids a hydration mismatch
    setEnd(new Date().toISOString().slice(0, 10));
  }, []);

  const strategy = choices.find((c) => c.id === strategyId) ?? choices[0];

  const axes: Record<string, AxisState> = useMemo(
    () =>
      strategy
        ? Object.fromEntries(
            strategy.params.map((p, i) => [
              p.key,
              overrides[strategy.id]?.[p.key] ?? { enabled: i === 0, min: p.min, max: p.max, step: p.step },
            ]),
          )
        : {},
    [strategy, overrides],
  );

  const enabledAxes = strategy ? strategy.params.filter((p) => axes[p.key]?.enabled) : [];
  const combos = enabledAxes.reduce((n, p) => {
    const a = axes[p.key];
    if (!a || !(a.step > 0) || a.min > a.max) return NaN;
    return n * (Math.floor((a.max - a.min) / a.step + 1e-9) + 1);
  }, 1);
  const gridError =
    enabledAxes.length === 0
      ? "Pick at least one parameter to optimise."
      : enabledAxes.length > MAX_GRID_AXES
        ? `Optimise at most ${MAX_GRID_AXES} parameters at once.`
        : !Number.isFinite(combos)
          ? "Check the ranges: min must not exceed max and step must be positive."
          : combos > MAX_GRID_COMBOS
            ? `The grid has ${combos.toLocaleString("en-US")} combinations. The limit is ${MAX_GRID_COMBOS}. Narrow a range or widen a step.`
            : null;

  const setAxis = (key: string, patch: Partial<AxisState>) => {
    if (!strategy) return;
    setOverrides((prev) => ({
      ...prev,
      [strategy.id]: { ...axes, [key]: { ...axes[key], ...patch } },
    }));
  };

  const run = async () => {
    if (!strategy || gridError) return;
    setRunning(true);
    setError(null);
    setOutput(null);
    setProgress({ done: 0, total: combos * (validation === "walkForward" ? folds + 1 : 1) });

    const validationBody =
      validation === "none"
        ? { mode: "none" as const }
        : validation === "split"
          ? { mode: "split" as const, trainFraction }
          : { mode: "walkForward" as const, folds };

    const body = {
      symbol: symbol.trim().toUpperCase(),
      start,
      end,
      capital,
      commissionBps,
      slippageBps,
      riskFreeRatePct,
      strategyId: strategy.id,
      axes: enabledAxes.map((p) => ({ key: p.key, ...axes[p.key] })),
      validation: validationBody,
      metric,
    };

    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errorFrom(res, "Optimisation failed"));
      await readNdjson<OptimizeEvent>(res, (ev) => {
        if (ev.type === "progress") setProgress({ done: ev.done, total: ev.total });
        if (ev.type === "result") setOutput(ev);
        if (ev.type === "error") setError(ev.message);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Optimisation failed");
    } finally {
      setRunning(false);
    }
  };

  const currency = /\.(NS|BO)$/.test(symbol.trim().toUpperCase()) ? "INR" : "USD";

  return (
    <main className="mx-auto grid max-w-7xl gap-6 p-4 md:p-6 lg:grid-cols-[400px_1fr]">
      <aside className="grid content-start gap-4 lg:sticky lg:top-6 lg:self-start">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Optimise</h1>
          <p className="text-sm text-muted-foreground">
            Search a parameter grid and check whether the best result holds on data it was not fitted to.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Market and costs</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Symbol"><Input value={symbol} onChange={(e) => setSymbol(e.target.value)} /></Field>
              <Field label="Capital"><Input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} /></Field>
              <Field label="Start"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="End"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
              <Field label="Commission bps"><Input type="number" value={commissionBps} onChange={(e) => setCommissionBps(Number(e.target.value))} /></Field>
              <Field label="Slippage bps"><Input type="number" value={slippageBps} onChange={(e) => setSlippageBps(Number(e.target.value))} /></Field>
              <Field label="Risk-free %"><Input type="number" value={riskFreeRatePct} onChange={(e) => setRiskFreeRatePct(Number(e.target.value))} /></Field>
              <Field label="Rank by">
                <select value={metric} onChange={(e) => setMetric(e.target.value as OptimizeMetric)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                  {OPTIMIZE_METRICS.map((m) => (
                    <option key={m} value={m}>{METRIC_LABEL[m]}</option>
                  ))}
                </select>
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Strategy and grid</CardTitle>
            <CardDescription>Tick the parameters to sweep, then set each range.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Strategy">
              <select value={strategy?.id ?? ""} onChange={(e) => setStrategyId(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>

            {strategy?.params.map((p) => {
              const a = axes[p.key];
              if (!a) return null;
              return (
                <div key={p.key} className="grid gap-2 rounded-md border p-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={a.enabled} onChange={(e) => setAxis(p.key, { enabled: e.target.checked })} />
                    {p.label}
                    <span className="text-xs font-normal text-muted-foreground">default {p.default}</span>
                  </label>
                  {a.enabled && (
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Min"><Input type="number" value={a.min} onChange={(e) => setAxis(p.key, { min: Number(e.target.value) })} /></Field>
                      <Field label="Max"><Input type="number" value={a.max} onChange={(e) => setAxis(p.key, { max: Number(e.target.value) })} /></Field>
                      <Field label="Step"><Input type="number" value={a.step} onChange={(e) => setAxis(p.key, { step: Number(e.target.value) })} /></Field>
                    </div>
                  )}
                </div>
              );
            })}

            <p className={gridError ? "text-sm text-negative" : "text-sm text-muted-foreground"}>
              {gridError ?? `${Number.isFinite(combos) ? combos.toLocaleString("en-US") : "—"} combinations`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Validation</CardTitle>
            <CardDescription>Out-of-sample testing shows whether the best result is more than luck in the sample.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Mode">
              <select value={validation} onChange={(e) => setValidation(e.target.value as ValidationChoice)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                <option value="none">None (full range, in-sample only)</option>
                <option value="split">Train / test split</option>
                <option value="walkForward">Walk-forward (anchored folds)</option>
              </select>
            </Field>
            {validation === "split" && (
              <Field label="Train fraction (0.3–0.9)">
                <Input type="number" step={0.05} min={0.3} max={0.9} value={trainFraction} onChange={(e) => setTrainFraction(Number(e.target.value))} />
              </Field>
            )}
            {validation === "walkForward" && (
              <Field label="Folds (2–10)">
                <Input type="number" min={2} max={10} value={folds} onChange={(e) => setFolds(Number(e.target.value))} />
              </Field>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-2">
          <Button onClick={run} disabled={running || !!gridError || !strategy}>
            {running ? "Optimising…" : "Run optimisation"}
          </Button>
          {progress && running ? (
            <div className="grid gap-1">
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
              </div>
              <span className="text-xs text-muted-foreground">{progress.done} / {progress.total} evaluations</span>
            </div>
          ) : null}
          <Link href="/strategies" className="text-sm text-muted-foreground underline underline-offset-4">
            Edit strategies →
          </Link>
        </div>
      </aside>

      <section className="grid min-w-0 content-start gap-6">
        {error ? (
          <Card className="border-negative/50">
            <CardContent>
              <p className="text-sm text-negative">{error}</p>
            </CardContent>
          </Card>
        ) : null}

        {!output && !running && !error ? (
          <Card>
            <CardHeader>
              <CardTitle>No results yet</CardTitle>
              <CardDescription>
                Choose a strategy, pick the parameters to sweep, and run. Walk-forward is the most honest check: each fold is tested on data after the window it was tuned on.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {output ? <Results ev={output} currency={currency} metric={metric} /> : null}
      </section>
    </main>
  );
}

function Results({ ev, currency, metric }: { ev: Extract<OptimizeEvent, { type: "result" }>; currency: string; metric: OptimizeMetric }) {
  const r: OptimizeResult = ev.result;
  const best = r.ranking[0];
  const oos = r.outOfSample;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge>{ev.symbol}</Badge>
        <Badge variant="outline">{ev.strategyName}</Badge>
        <Badge variant="outline">{ev.barCount} daily bars</Badge>
        <Badge variant="secondary">{r.trialCount} combinations</Badge>
        <Badge variant="secondary">{r.mode === "none" ? "in-sample only" : r.mode === "split" ? "train / test" : "walk-forward"}</Badge>
      </div>

      {r.warnings.length > 0 ? (
        <Card className="border-amber-500/50">
          <CardContent className="grid gap-2">
            {r.warnings.map((w, i) => (
              <p key={i} className="text-sm">{w}</p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Best parameters</CardTitle>
            <CardDescription>
              {r.mode === "walkForward" ? "Best across the full range. Each fold also picks its own, below." : `Best in ${r.mode === "split" ? "the training window" : "the sample"}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(r.bestParams).map(([k, v]) => (
                <Badge key={k} variant="outline" className="font-mono">{k} = {v}</Badge>
              ))}
            </div>
            {best ? <StatLine label={`In-sample ${METRIC_LABEL[metric]}`} stats={best.inSample} /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Out-of-sample</CardTitle>
            <CardDescription>
              {r.mode === "none"
                ? "Not measured. Run with train/test or walk-forward to get this."
                : r.mode === "split"
                  ? "The best combination on the held-out tail of the data."
                  : "All out-of-sample windows chained together."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {oos ? <StatLine label={METRIC_LABEL[metric]} stats={oos.stats} /> : <p className="text-sm text-muted-foreground">—</p>}
          </CardContent>
        </Card>
      </div>

      {oos && oos.dates.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Out-of-sample equity</CardTitle>
          </CardHeader>
          <CardContent>
            <EquityChart dates={oos.dates} currency={currency} series={[{ key: "oos", name: "Out-of-sample", color: "var(--chart-1)", values: oos.equity }]} />
          </CardContent>
        </Card>
      ) : null}

      {r.folds && r.folds.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Walk-forward folds</CardTitle>
            <CardDescription>Each fold picks the best parameters on everything before its test window, then trades that window.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Fold</th>
                  <th className="p-2">Trained to</th>
                  <th className="p-2">Tested</th>
                  <th className="p-2">Parameters</th>
                  <th className="p-2 text-right">Train {METRIC_LABEL[metric]}</th>
                  <th className="p-2 text-right">Test return</th>
                  <th className="p-2 text-right">Test {METRIC_LABEL[metric]}</th>
                  <th className="p-2 text-right">Trades</th>
                </tr>
              </thead>
              <tbody>
                {r.folds.map((f) => (
                  <tr key={f.fold} className="border-t">
                    <td className="p-2">{f.fold}</td>
                    <td className="p-2 whitespace-nowrap">{f.trainEnd}</td>
                    <td className="p-2 whitespace-nowrap">{f.testStart} → {f.testEnd}</td>
                    <td className="p-2 font-mono text-xs">{Object.entries(f.bestParams).map(([k, v]) => `${k}=${v}`).join(" ")}</td>
                    <td className="p-2 text-right tabular-nums">{fmtNum(f.trainMetric)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtPct(f.outOfSample.totalReturnPct)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtNum(f.outOfSample.metric)}</td>
                    <td className="p-2 text-right tabular-nums">{f.outOfSample.tradeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Ranking</CardTitle>
          <CardDescription>Top {r.ranking.length} by {METRIC_LABEL[metric]} {r.mode === "walkForward" ? "over the full range" : r.mode === "split" ? "on the training window" : ""}.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">#</th>
                <th className="p-2">Parameters</th>
                <th className="p-2 text-right">In-sample {METRIC_LABEL[metric]}</th>
                <th className="p-2 text-right">In-sample return</th>
                {r.mode === "split" ? <th className="p-2 text-right">Test {METRIC_LABEL[metric]}</th> : null}
                <th className="p-2 text-right">Max DD</th>
                <th className="p-2 text-right">Trades</th>
              </tr>
            </thead>
            <tbody>
              {r.ranking.map((row, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2 text-muted-foreground">{i + 1}</td>
                  <td className="p-2 font-mono text-xs">{Object.entries(row.params).map(([k, v]) => `${k}=${v}`).join(" ")}</td>
                  <td className="p-2 text-right tabular-nums">{fmtNum(row.inSample.metric)}</td>
                  <td className="p-2 text-right tabular-nums">{fmtPct(row.inSample.totalReturnPct)}</td>
                  {r.mode === "split" ? <td className="p-2 text-right tabular-nums">{row.outOfSample ? fmtNum(row.outOfSample.metric) : "—"}</td> : null}
                  <td className="p-2 text-right tabular-nums">{fmtPct(row.inSample.maxDrawdownPct)}</td>
                  <td className="p-2 text-right tabular-nums">{row.inSample.tradeCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

function StatLine({ label, stats }: { label: string; stats: Stats }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold tabular-nums">{fmtNum(stats.metric)}</span>
      <span className="text-muted-foreground">Return</span>
      <span className="text-right tabular-nums">{fmtPct(stats.totalReturnPct)}</span>
      <span className="text-muted-foreground">Max drawdown</span>
      <span className="text-right tabular-nums">{fmtPct(stats.maxDrawdownPct)}</span>
      <span className="text-muted-foreground">Trades</span>
      <span className="text-right tabular-nums">{stats.tradeCount}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

