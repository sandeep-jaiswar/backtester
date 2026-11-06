import { z } from "zod";

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
    capital: z.number().positive().max(1e12).default(100_000),
    commissionBps: z.number().min(0).max(500).default(10),
    slippageBps: z.number().min(0).max(500).default(5),
    runs: z.array(runSchema).min(1).max(10),
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
