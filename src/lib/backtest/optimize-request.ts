import { z } from "zod";
import { DEFAULT_BACKTEST } from "./config";
import { COST_PROFILES } from "./costs";
import { MAX_GRID_AXES, OPTIMIZE_METRICS, type GridAxis, type ValidationMode } from "./optimize";

const symbolPattern = /^[A-Z0-9.\-^=]{1,20}$/;

const axisSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().finite().positive(),
  })
  .refine((a) => a.min <= a.max, { message: "min must be <= max" });

const validationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("split"), trainFraction: z.number().min(0.3).max(0.9) }),
  z.object({ mode: z.literal("walkForward"), folds: z.number().int().min(2).max(10) }),
]);

export const optimizeRequestSchema = z
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
    costProfile: z.enum(COST_PROFILES).optional(),
    riskFreeRatePct: z.number().min(0).max(50).default(DEFAULT_BACKTEST.riskFreeRatePct),
    strategyId: z.string().min(1).max(64),
    axes: z.array(axisSchema).min(1).max(MAX_GRID_AXES),
    validation: validationSchema,
    metric: z.enum(OPTIMIZE_METRICS).default("sharpe"),
  })
  .superRefine((v, ctx) => {
    if (v.start >= v.end) ctx.addIssue({ code: "custom", path: ["end"], message: "End date must be after start date" });
    const today = new Date().toISOString().slice(0, 10);
    if (v.end > today) ctx.addIssue({ code: "custom", path: ["end"], message: "End date cannot be in the future" });
  });

export type OptimizeRequest = z.output<typeof optimizeRequestSchema>;

export function toGridAxes(axes: OptimizeRequest["axes"]): GridAxis[] {
  return axes.map((a) => ({ key: a.key, min: a.min, max: a.max, step: a.step }));
}

export function toValidation(v: OptimizeRequest["validation"]): ValidationMode {
  return v;
}
