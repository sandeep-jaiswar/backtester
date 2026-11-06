import { z } from "zod";
import type { Bar, ParamSpec, Strategy } from "./types";
import { atr, closesOf, ema, priorHighest, priorLowest, rsi, sma } from "./indicators";

/**
 * No-code strategies. A definition has parameters, an entry rule and an exit rule.
 * Each rule is a list of comparisons joined by AND ("all") or OR ("any").
 *
 * Semantics: the position goes long on the first bar where the entry rule is true and stays long
 * until the exit rule is true. Every value used on bar i is computed from bars 0..i, so the
 * engine's next-open execution keeps the no-look-ahead guarantee.
 */

export const INDICATORS = [
  "close",
  "open",
  "high",
  "low",
  "volume",
  "sma",
  "ema",
  "rsi",
  "atr",
  "priorHigh",
  "priorLow",
] as const;
export type IndicatorName = (typeof INDICATORS)[number];

/** Indicators that take a period. The others read the bar directly. */
export const PERIOD_INDICATORS: ReadonlySet<IndicatorName> = new Set([
  "sma",
  "ema",
  "rsi",
  "atr",
  "priorHigh",
  "priorLow",
]);

export const COMPARISON_OPS = ["gt", "lt", "gte", "lte", "crossesAbove", "crossesBelow"] as const;
export type ComparisonOp = (typeof COMPARISON_OPS)[number];

const paramKey = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]{0,31}$/, "Parameter names start with a lowercase letter and use letters or digits");

export const paramSpecSchema = z
  .object({
    key: paramKey,
    label: z.string().trim().min(1).max(40),
    default: z.number().finite(),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().finite().positive(),
    integer: z.boolean().optional(),
  })
  .refine((p) => p.min <= p.max, { message: "min must be <= max" })
  .refine((p) => p.default >= p.min && p.default <= p.max, { message: "default must be within min and max" });

const indicatorOperand = z
  .object({
    type: z.literal("indicator"),
    name: z.enum(INDICATORS),
    /** Literal period, used when `periodParam` is not set. Required for period indicators. */
    period: z.number().int().min(2).max(400).optional(),
    /** Name of a parameter that supplies the period. */
    periodParam: paramKey.optional(),
  })
  .superRefine((op, ctx) => {
    const needsPeriod = PERIOD_INDICATORS.has(op.name);
    if (needsPeriod && op.period === undefined && op.periodParam === undefined) {
      ctx.addIssue({ code: "custom", message: `${op.name} needs a period or a period parameter` });
    }
    if (!needsPeriod && (op.period !== undefined || op.periodParam !== undefined)) {
      ctx.addIssue({ code: "custom", message: `${op.name} does not take a period` });
    }
  });

const numberOperand = z.object({ type: z.literal("number"), value: z.number().finite() });
const paramOperand = z.object({ type: z.literal("param"), key: paramKey });

export const operandSchema = z.discriminatedUnion("type", [indicatorOperand, numberOperand, paramOperand]);

export const comparisonSchema = z.object({
  left: operandSchema,
  op: z.enum(COMPARISON_OPS),
  right: operandSchema,
});

export const ruleSchema = z.object({
  match: z.enum(["all", "any"]),
  conditions: z.array(comparisonSchema).min(1).max(6),
});

export const ruleDefinitionSchema = z
  .object({
    version: z.literal(1),
    params: z.array(paramSpecSchema).max(8),
    entry: ruleSchema,
    exit: ruleSchema,
  })
  .superRefine((def, ctx) => {
    const declared = new Set<string>();
    for (const p of def.params) {
      if (declared.has(p.key)) ctx.addIssue({ code: "custom", message: `Duplicate parameter ${p.key}` });
      declared.add(p.key);
    }
    const paramSpecs = new Map(def.params.map((p) => [p.key, p]));
    const checkOperand = (op: z.infer<typeof operandSchema>) => {
      if (op.type === "param" && !declared.has(op.key)) {
        ctx.addIssue({ code: "custom", message: `Unknown parameter ${op.key}` });
      }
      if (op.type === "indicator" && op.periodParam !== undefined) {
        const spec = paramSpecs.get(op.periodParam);
        if (!spec) {
          ctx.addIssue({ code: "custom", message: `Unknown period parameter ${op.periodParam}` });
        } else if (spec.min < 2) {
          ctx.addIssue({ code: "custom", message: `Period parameter ${op.periodParam} must have min >= 2` });
        }
      }
    };
    for (const rule of [def.entry, def.exit]) {
      for (const c of rule.conditions) {
        checkOperand(c.left);
        checkOperand(c.right);
      }
    }
  });

export type RuleDefinition = z.output<typeof ruleDefinitionSchema>;
export type Operand = z.output<typeof operandSchema>;
export type Comparison = z.output<typeof comparisonSchema>;
export type Rule = z.output<typeof ruleSchema>;

/** Evaluates a definition into a long/flat signal per bar. `params` must already be resolved. */
export function evaluateRuleSignals(
  bars: Bar[],
  def: RuleDefinition,
  params: Record<string, number>,
): boolean[] {
  const cache = new Map<string, number[]>();
  const entry = evaluateRule(bars, def.entry, params, cache);
  const exit = evaluateRule(bars, def.exit, params, cache);

  const out = new Array<boolean>(bars.length);
  let inPosition = false;
  for (let i = 0; i < bars.length; i++) {
    if (!inPosition && entry[i]) inPosition = true;
    else if (inPosition && exit[i]) inPosition = false;
    out[i] = inPosition;
  }
  return out;
}

function evaluateRule(
  bars: Bar[],
  rule: Rule,
  params: Record<string, number>,
  cache: Map<string, number[]>,
): boolean[] {
  const results = rule.conditions.map((c) => {
    const a = operandSeries(bars, c.left, params, cache);
    const b = operandSeries(bars, c.right, params, cache);
    return compareSeries(a, b, c.op);
  });
  const out = new Array<boolean>(bars.length);
  for (let i = 0; i < bars.length; i++) {
    out[i] = rule.match === "all" ? results.every((r) => r[i]) : results.some((r) => r[i]);
  }
  return out;
}

function compareSeries(a: number[], b: number[], op: ComparisonOp): boolean[] {
  const out = new Array<boolean>(a.length).fill(false);
  for (let i = 0; i < a.length; i++) {
    // NaN in either side makes every comparison false, so warm-up bars never trigger a rule.
    switch (op) {
      case "gt":
        out[i] = a[i] > b[i];
        break;
      case "lt":
        out[i] = a[i] < b[i];
        break;
      case "gte":
        out[i] = a[i] >= b[i];
        break;
      case "lte":
        out[i] = a[i] <= b[i];
        break;
      case "crossesAbove":
        out[i] = i > 0 && a[i - 1] <= b[i - 1] && a[i] > b[i];
        break;
      case "crossesBelow":
        out[i] = i > 0 && a[i - 1] >= b[i - 1] && a[i] < b[i];
        break;
    }
  }
  return out;
}

function operandSeries(
  bars: Bar[],
  op: Operand,
  params: Record<string, number>,
  cache: Map<string, number[]>,
): number[] {
  if (op.type === "number") return new Array<number>(bars.length).fill(op.value);
  if (op.type === "param") return new Array<number>(bars.length).fill(params[op.key]);

  const period = op.periodParam !== undefined ? Math.round(params[op.periodParam]) : op.period;
  const key = `${op.name}:${period ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let series: number[];
  switch (op.name) {
    case "close":
      series = bars.map((b) => b.close);
      break;
    case "open":
      series = bars.map((b) => b.open);
      break;
    case "high":
      series = bars.map((b) => b.high);
      break;
    case "low":
      series = bars.map((b) => b.low);
      break;
    case "volume":
      series = bars.map((b) => b.volume);
      break;
    case "sma":
      series = sma(closesOf(bars), period!);
      break;
    case "ema":
      series = ema(closesOf(bars), period!);
      break;
    case "rsi":
      series = rsi(closesOf(bars), period!);
      break;
    case "atr":
      series = atr(bars, period!);
      break;
    case "priorHigh":
      series = priorHighest(bars, period!);
      break;
    case "priorLow":
      series = priorLowest(bars, period!);
      break;
  }
  cache.set(key, series);
  return series;
}

/** Wraps a definition as a Strategy the engine, API and optimiser already understand. */
export function ruleStrategy(
  id: string,
  name: string,
  description: string,
  def: RuleDefinition,
  definitionHash?: string,
): Strategy {
  return {
    id,
    name,
    description,
    params: def.params as ParamSpec[],
    signals: (bars, params) => evaluateRuleSignals(bars, def, params),
    definitionHash,
  };
}
