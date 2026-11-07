"use client";

import { useMemo, useState } from "react";
import { BacktestForm } from "./backtest-form";
import { EquityChart, type EquitySeries } from "./equity-chart";
import { StrategyCard } from "./strategy-card";
import { TradesGrid } from "./trades-grid";
import { useBacktestStream, type BacktestRequestBody } from "./use-backtest-stream";
import { BENCHMARK_INDEX } from "@/lib/backtest/stream-events";
import { BENCHMARK_STRATEGY_ID } from "@/lib/backtest/config";
import { verdict } from "@/lib/backtest/verdict";
import { cn } from "@/lib/utils";
import { getStrategy } from "@/lib/strategies";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnalyticsPanels } from "./analytics-panels";
import { downloadReport } from "@/lib/report-xlsx";

export function BacktestDashboard() {
  const { state, run, cancel } = useBacktestStream();
  const [runs, setRuns] = useState<BacktestRequestBody["runs"]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  // On small screens the settings form collapses once a run starts, so results come first.
  const [formOpen, setFormOpen] = useState(true);

  const running = state.status === "running";
  const settled = Object.keys(state.results).length + Object.keys(state.runErrors).length;
  const total = runs.length + 1; // +1 for the benchmark

  const submit = (body: BacktestRequestBody) => {
    setRuns(body.runs);
    setSelected(null);
    setFormOpen(false);
    run(body);
  };

  const hasResults = Object.keys(state.results).length > 0;

  const series = useMemo<EquitySeries[]>(() => {
    const out: EquitySeries[] = [];
    const bench = state.results[BENCHMARK_INDEX];
    if (bench) {
      out.push({ key: "benchmark", name: bench.strategyName, color: "var(--muted-foreground)", values: bench.equity, dashed: true });
    }
    runs.forEach((_, i) => {
      const r = state.results[i];
      if (r) out.push({ key: `s${i}`, name: r.strategyName, color: `var(--chart-${(i % 5) + 1})`, values: r.equity });
    });
    return out;
  }, [state.results, runs]);

  const tradeSource = useMemo(() => {
    if (selected !== null && state.results[selected]) return state.results[selected];
    const firstDone = [BENCHMARK_INDEX, ...runs.map((_, i) => i)].find((i) => state.results[i]);
    return firstDone !== undefined ? state.results[firstDone] : undefined;
  }, [selected, state.results, runs]);

  return (
    <main className="mx-auto grid max-w-7xl gap-6 p-4 md:p-6 lg:grid-cols-[400px_1fr]">
      <aside className={cn("lg:sticky lg:top-6 lg:self-start", !formOpen && "hidden lg:block")}>
        <div className="mb-6 grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Backtester</h1>
          <p className="text-sm text-muted-foreground">
            Test trading rules on historical prices. Strategies run in parallel and results stream in as they finish.
          </p>
        </div>
        <BacktestForm running={running} onRun={submit} onCancel={cancel} />
      </aside>

      <section className="grid min-w-0 content-start gap-6">
        {!formOpen && state.dates.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm lg:hidden">
            <span className="text-muted-foreground">
              {state.symbol} · {state.dates[0]} → {state.dates[state.dates.length - 1]} · {runs.length}{" "}
              {runs.length === 1 ? "strategy" : "strategies"}
            </span>
            {running ? (
              <Button variant="outline" size="sm" onClick={cancel}>
                Cancel
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
                Edit settings
              </Button>
            )}
          </div>
        ) : null}
        {state.status === "error" && state.error ? (
          <Card className="border-negative/50" role="alert">
            <CardContent>
              <p className="text-sm text-negative">{state.error}</p>
            </CardContent>
          </Card>
        ) : null}

        {state.status === "idle" && (
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Choose a symbol, date range and strategies, then run the backtest.
              </p>
            </CardContent>
          </Card>
        )}

        {state.status !== "idle" && (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="status" aria-live="polite">
            {state.symbol ? <Badge>{state.symbol}</Badge> : null}
            {state.barCount ? <Badge variant="outline">{state.barCount} daily bars</Badge> : null}
            {state.currency ? <Badge variant="outline">{state.currency}</Badge> : null}
            {running ? (
              <Badge variant="secondary">
                {settled} / {total} complete
              </Badge>
            ) : state.status === "done" && state.elapsedMs !== undefined ? (
              <Badge variant="secondary">Finished in {(state.elapsedMs / 1000).toFixed(2)}s</Badge>
            ) : null}
          </div>
        )}

        {state.dates.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StrategyCard
              name={getStrategy(BENCHMARK_STRATEGY_ID)?.name ?? "Benchmark"}
              description="Benchmark"
              benchmark
              result={state.results[BENCHMARK_INDEX]}
              currency={state.currency}
              selected={selected === BENCHMARK_INDEX}
              onSelect={() => setSelected(BENCHMARK_INDEX)}
            />
            {runs.map((r, i) => {
              const def = getStrategy(r.strategyId);
              return (
                <StrategyCard
                  key={`${r.strategyId}-${i}`}
                  name={state.results[i]?.strategyName ?? def?.name ?? r.strategyId}
                  description={def?.description}
                  result={state.results[i]}
                  error={state.runErrors[i]}
                  currency={state.currency}
                  verdict={state.results[i] ? verdict(state.results[i].metrics, state.results[BENCHMARK_INDEX]?.metrics) : undefined}
                  selected={selected === i}
                  onSelect={() => setSelected(i)}
                />
              );
            })}
          </div>
        )}

        {hasResults && state.dates.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Equity curve</CardTitle>
              <CardDescription>Portfolio value at each close, compared with buy & hold.</CardDescription>
            </CardHeader>
            <CardContent>
              <EquityChart dates={state.dates} series={series} currency={state.currency ?? "USD"} />
            </CardContent>
          </Card>
        )}

        {tradeSource && (
          <Card>
            <CardHeader>
              <CardTitle>Trades · {tradeSource.strategyName}</CardTitle>
              <CardDescription>
                {tradeSource.trades.length} round trips. Click a strategy card to switch.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TradesGrid trades={tradeSource.trades} />
            </CardContent>
          </Card>
        )}

        {tradeSource && (
          <Card>
            <CardHeader>
              <CardTitle>Analytics · {tradeSource.strategyName}</CardTitle>
              <CardDescription>Benchmark comparison, drawdowns and monthly returns for the selected strategy.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadReport({
                      fileName: `${tradeSource.manifest.runId}-report.xlsx`,
                      manifest: tradeSource.manifest,
                      metrics: tradeSource.metrics,
                      trades: tradeSource.trades,
                      dates: state.dates,
                      equity: tradeSource.equity,
                    })
                  }
                >
                  Excel report
                </Button>
              </div>
              <AnalyticsPanels
                dates={state.dates.length > 0 ? state.dates : null}
                equity={tradeSource.equity}
                metrics={tradeSource.metrics}
              />
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}

