import { DataError, fetchDailyBarsCached } from "@/lib/market-data/yahoo";
import { optimizeRequestSchema, toGridAxes, toValidation } from "@/lib/backtest/optimize-request";
import { runOptimization } from "@/lib/backtest/optimize";
import { costModelFor, defaultCostProfileFor } from "@/lib/backtest/costs";
import { resolveStrategy } from "@/lib/strategies/resolve";
import type { OptimizeEvent } from "@/lib/backtest/optimize-events";

/**
 * POST /api/optimize
 *
 * Runs a parameter search over the requested grid with the chosen validation mode. Streams
 * progress events while it works, then one result event. Nothing is saved: run a result
 * through /api/backtest to store it in the run history.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = optimizeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const input = parsed.data;

  let strategy;
  try {
    strategy = await resolveStrategy(input.strategyId);
  } catch (err) {
    console.error("Failed to load strategy", err);
    return Response.json({ error: "Could not load the strategy. Try again." }, { status: 502 });
  }
  if (!strategy) return Response.json({ error: `Unknown strategy: ${input.strategyId}` }, { status: 400 });

  const costProfile = input.costProfile ?? defaultCostProfileFor(input.symbol);
  const config = {
    initialCapital: input.capital,
    commissionBps: input.commissionBps,
    slippageBps: input.slippageBps,
    costModel: costModelFor(costProfile, input.commissionBps),
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: OptimizeEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false;
        }
      };
      const started = Date.now();
      try {
        const series = await fetchDailyBarsCached(input.symbol, input.start, input.end);
        const result = runOptimization({
          bars: series.bars,
          strategy,
          config,
          riskFreeRatePct: input.riskFreeRatePct,
          axes: toGridAxes(input.axes),
          validation: toValidation(input.validation),
          metric: input.metric,
          onProgress: (done, total) => send({ type: "progress", done, total }),
        });
        send({
          type: "result",
          result,
          symbol: series.symbol,
          currency: series.currency,
          strategyName: strategy.name,
          barCount: series.bars.length,
        });
        send({ type: "done", elapsedMs: Date.now() - started });
      } catch (err) {
        send({
          type: "error",
          message:
            err instanceof DataError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Optimisation failed",
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
