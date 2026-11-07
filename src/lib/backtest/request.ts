import { z } from "zod";
import { DEFAULT_BACKTEST, MAX_RUNS_PER_REQUEST } from "./config";
import { COST_PROFILES } from "./costs";

// Yahoo symbols: letters, digits, dot, dash, caret, equals. e.g. AAPL, RELIANCE.NS, ^NSEI, BTC-USD
const symbolPattern = /^[A-Z0-9.\-^=]{1,20}$/;

export const runSchema = z.object({
  strategyId: z.string().min(1).max(64),
  params: z.record(z.string(), z.number().finite()).default({}),
});

export const requestSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .toUpperCase()
      .regex(symbolPattern, "Use a Yahoo Finance symbol such as AAPL or RELIANCE.NS"),
    start: z.iso.date(),
    end: z.iso.date(),
    capital: z.number().positive().max(1e12).default(DEFAULT_BACKTEST.capital),
    commissionBps: z.number().min(0).max(500).default(DEFAULT_BACKTEST.commissionBps),
    slippageBps: z.number().min(0).max(500).default(DEFAULT_BACKTEST.slippageBps),
    /** Omit to pick by symbol: .NS and .BO get Indian delivery charges, everything else gets flat bps. */
    costProfile: z.enum(COST_PROFILES).optional(),
    riskFreeRatePct: z.number().min(0).max(50).default(DEFAULT_BACKTEST.riskFreeRatePct),
    /** Protective exits and sizing. Omit to leave them off, which keeps the run identical to a plain run. */
    stopLossPct: z.number().positive().max(99).optional(),
    takeProfitPct: z.number().positive().max(1000).optional(),
    positionFraction: z.number().gt(0).max(1).optional(),
    runs: z.array(runSchema).min(1).max(MAX_RUNS_PER_REQUEST),
  })
  .superRefine((v, ctx) => {
    if (v.start >= v.end) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "End date must be after start date" });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (v.end > today) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "End date cannot be in the future" });
    }
  });

export type BacktestRequest = z.infer<typeof requestSchema>;
