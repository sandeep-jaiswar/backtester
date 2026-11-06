import { DataError, fetchDailyBarsCached } from "@/lib/market-data/yahoo";
import { runBacktest } from "@/lib/backtest/engine";
import { computeMetrics } from "@/lib/backtest/metrics";
import { requestSchema } from "@/lib/backtest/request";
import { BENCHMARK_INDEX, type BacktestEvent } from "@/lib/backtest/stream-events";
import { BENCHMARK_STRATEGY_ID } from "@/lib/backtest/config";
import { costModelFor, defaultCostProfileFor } from "@/lib/backtest/costs";
import { buildManifest, hashBars } from "@/lib/backtest/manifest";
import { getStrategy, resolveParams } from "@/lib/strategies";
import type { Strategy, BacktestConfig } from "@/lib/backtest/types";
import { isDbConfigured, saveRun, type StoredRunInput } from "@/lib/db/runs";

/**
 * Saves a finished run when a database is configured. A failure is logged and never fails the
 * backtest: the client already has its result, and the run can be recomputed from its manifest.
 */
async function persist(run: StoredRunInput): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    await saveRun(run);
  } catch (err) {
    console.error("Failed to persist backtest run", run.manifest.runId, err);
  }
}

/**
 * POST /api/backtest
 *
 * Fetches daily bars once (cached per server instance), then runs every requested strategy
 * concurrently and streams each result as NDJSON the moment it finishes. Buy & hold is always
 * included as the benchmark. Every result carries a manifest that reproduces it.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const input = parsed.data;

  const resolved = input.runs.map((run) => ({ run, strategy: getStrategy(run.strategyId) }));
  const unknown = resolved.find((r) => !r.strategy);
  if (unknown) {
    return Response.json({ error: `Unknown strategy: ${unknown.run.strategyId}` }, { status: 400 });
  }

  const costProfile = input.costProfile ?? defaultCostProfileFor(input.symbol);
  const costModel = costModelFor(costProfile, input.commissionBps);

  const config: BacktestConfig = {
    initialCapital: input.capital,
    commissionBps: input.commissionBps,
    slippageBps: input.slippageBps,
    costModel,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: BacktestEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Client disconnected; stop emitting.
          open = false;
        }
      };
      const started = Date.now();

      try {
        const series = await fetchDailyBarsCached(input.symbol, input.start, input.end);
        const { bars } = series;
        const dates = bars.map((b) => b.date.toISOString().slice(0, 10));
        const datasetHash = hashBars(bars);
        send({
          type: "data",
          symbol: series.symbol,
          currency: series.currency,
          dates,
          barCount: bars.length,
          datasetHash,
        });

        const runOne = async (
          index: number,
          strategy: Strategy,
          rawParams: Record<string, number>,
        ) => {
          // Yield to the event loop so every run starts before any finishes its CPU work.
          await new Promise((resolve) => setTimeout(resolve, 0));
          const t0 = Date.now();
          try {
            const params = resolveParams(strategy, rawParams);
            const signals = strategy.signals(bars, params);
            const result = runBacktest(bars, signals, config);
            const manifest = buildManifest({
              symbol: series.symbol,
              start: input.start,
              end: input.end,
              datasetHash,
              capital: input.capital,
              costProfile,
              costModel,
              slippageBps: input.slippageBps,
              riskFreeRatePct: input.riskFreeRatePct,
              strategyId: strategy.id,
              params,
            });
            const metrics = computeMetrics(result, bars.map((b) => b.date), {
              riskFreeRatePct: input.riskFreeRatePct,
            });
            const equity = result.equity.map((v) => Math.round(v * 100) / 100);
            send({
              type: "result",
              index,
              strategyId: strategy.id,
              strategyName: strategy.name,
              params,
              metrics,
              equity,
              trades: result.trades,
              durationMs: Date.now() - t0,
              manifest,
            });
            await persist({ manifest, strategyName: strategy.name, metrics, trades: result.trades, equity });
          } catch (err) {
            send({
              type: "error",
              index,
              message: err instanceof Error ? err.message : "Strategy failed",
            });
          }
        };

        const benchmark = getStrategy(BENCHMARK_STRATEGY_ID)!;
        await Promise.all([
          runOne(BENCHMARK_INDEX, benchmark, {}),
          ...resolved.map(({ run, strategy }, i) => runOne(i, strategy!, run.params)),
        ]);

        send({ type: "done", elapsedMs: Date.now() - started });
      } catch (err) {
        send({
          type: "error",
          message:
            err instanceof DataError
              ? err.message
              : "Could not fetch price data from Yahoo Finance. Check the symbol and try again.",
        });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
