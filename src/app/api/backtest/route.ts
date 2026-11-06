import { DataError, fetchDailyBars } from "@/lib/market-data/yahoo";
import { runBacktest } from "@/lib/backtest/engine";
import { computeMetrics } from "@/lib/backtest/metrics";
import { requestSchema } from "@/lib/backtest/request";
import { BENCHMARK_INDEX, type BacktestEvent } from "@/lib/backtest/stream-events";
import { BENCHMARK_STRATEGY_ID } from "@/lib/backtest/config";
import { getStrategy, resolveParams } from "@/lib/strategies";
import type { Strategy, BacktestConfig } from "@/lib/backtest/types";

/**
 * POST /api/backtest
 *
 * Fetches Yahoo Finance bars once, then runs every requested strategy concurrently and
 * streams each result as NDJSON the moment it finishes. Buy & hold is always included as the benchmark.
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

  const config: BacktestConfig = {
    initialCapital: input.capital,
    commissionBps: input.commissionBps,
    slippageBps: input.slippageBps,
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
        const series = await fetchDailyBars(input.symbol, input.start, input.end);
        const { bars } = series;
        const dates = bars.map((b) => b.date.toISOString().slice(0, 10));
        send({ type: "data", symbol: series.symbol, currency: series.currency, dates, barCount: bars.length });

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
            send({
              type: "result",
              index,
              strategyId: strategy.id,
              strategyName: strategy.name,
              params,
              metrics: computeMetrics(result, bars.map((b) => b.date)),
              equity: result.equity.map((v) => Math.round(v * 100) / 100),
              trades: result.trades,
              durationMs: Date.now() - t0,
            });
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
