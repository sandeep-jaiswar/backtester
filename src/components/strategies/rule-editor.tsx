"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  COMPARISON_OPS,
  INDICATORS,
  PERIOD_INDICATORS,
  type Comparison,
  type ComparisonOp,
  type IndicatorName,
  type Operand,
  type Rule,
} from "@/lib/backtest/rules";

const OP_LABEL: Record<ComparisonOp, string> = {
  gt: "is above",
  lt: "is below",
  gte: "is at or above",
  lte: "is at or below",
  crossesAbove: "crosses above",
  crossesBelow: "crosses below",
};

const MAX_CONDITIONS = 6;

/** Editor for one rule (entry or exit): a list of comparisons joined by AND or OR. */
export function RuleEditor({
  title,
  hint,
  rule,
  paramKeys,
  onChange,
}: {
  title: string;
  hint: string;
  rule: Rule;
  paramKeys: string[];
  onChange: (rule: Rule) => void;
}) {
  const setCondition = (i: number, c: Comparison) =>
    onChange({ ...rule, conditions: rule.conditions.map((x, j) => (j === i ? c : x)) });
  const removeCondition = (i: number) =>
    onChange({ ...rule, conditions: rule.conditions.filter((_, j) => j !== i) });
  const addCondition = () =>
    onChange({
      ...rule,
      conditions: [
        ...rule.conditions,
        { left: { type: "indicator", name: "close" }, op: "gt", right: { type: "number", value: 0 } },
      ],
    });

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">{hint}</span>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Match
          <select
            aria-label={`${title} match`}
            value={rule.match}
            onChange={(e) => onChange({ ...rule, match: e.target.value as "all" | "any" })}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="all">all conditions</option>
            <option value="any">any condition</option>
          </select>
        </label>
      </div>

      {rule.conditions.map((c, i) => (
        <div key={i} className="grid gap-2 rounded-md bg-muted/40 p-2 md:grid-cols-[1fr_auto_1fr_auto] md:items-center">
          <OperandField label="Left" operand={c.left} paramKeys={paramKeys} onChange={(left) => setCondition(i, { ...c, left })} />
          <select
            aria-label="Comparison"
            value={c.op}
            onChange={(e) => setCondition(i, { ...c, op: e.target.value as ComparisonOp })}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {COMPARISON_OPS.map((op) => (
              <option key={op} value={op}>
                {OP_LABEL[op]}
              </option>
            ))}
          </select>
          <OperandField label="Right" operand={c.right} paramKeys={paramKeys} onChange={(right) => setCondition(i, { ...c, right })} />
          <Button type="button" variant="ghost" size="sm" onClick={() => removeCondition(i)} aria-label="Remove condition">
            Remove
          </Button>
        </div>
      ))}

      <div>
        <Button type="button" variant="outline" size="sm" onClick={addCondition} disabled={rule.conditions.length >= MAX_CONDITIONS}>
          Add condition
        </Button>
      </div>
    </div>
  );
}

/** One side of a comparison: an indicator (with optional period), a fixed number, or a parameter. */
function OperandField({
  label,
  operand,
  paramKeys,
  onChange,
}: {
  label: string;
  operand: Operand;
  paramKeys: string[];
  onChange: (o: Operand) => void;
}) {
  const kind = operand.type;
  const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

  const changeKind = (next: string) => {
    if (next === "number") onChange({ type: "number", value: 0 });
    else if (next === "param") onChange({ type: "param", key: paramKeys[0] ?? "" });
    else onChange({ type: "indicator", name: "close" });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="sr-only">{label}</span>
      <select aria-label={`${label} kind`} value={kind} onChange={(e) => changeKind(e.target.value)} className={selectClass}>
        <option value="indicator">Indicator</option>
        <option value="number">Number</option>
        <option value="param">Parameter</option>
      </select>

      {operand.type === "indicator" && (
        <>
          <select
            aria-label={`${label} indicator`}
            value={operand.name}
            onChange={(e) => onChange(withIndicator(operand, e.target.value as IndicatorName))}
            className={selectClass}
          >
            {INDICATORS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {PERIOD_INDICATORS.has(operand.name) && (
            <PeriodField label={label} operand={operand} paramKeys={paramKeys} onChange={onChange} />
          )}
        </>
      )}

      {operand.type === "number" && (
        <Input
          aria-label={`${label} value`}
          type="number"
          value={operand.value}
          onChange={(e) => onChange({ type: "number", value: Number(e.target.value) })}
          className="h-9 w-28"
        />
      )}

      {operand.type === "param" && (
        <select
          aria-label={`${label} parameter`}
          value={operand.key}
          onChange={(e) => onChange({ type: "param", key: e.target.value })}
          className={selectClass}
          disabled={paramKeys.length === 0}
        >
          {paramKeys.length === 0 ? <option value="">Add a parameter first</option> : null}
          {paramKeys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function PeriodField({
  label,
  operand,
  paramKeys,
  onChange,
}: {
  label: string;
  operand: Extract<Operand, { type: "indicator" }>;
  paramKeys: string[];
  onChange: (o: Operand) => void;
}) {
  const usingParam = operand.periodParam !== undefined;
  return (
    <>
      <select
        aria-label={`${label} period source`}
        value={usingParam ? "param" : "fixed"}
        onChange={(e) =>
          onChange(
            e.target.value === "param"
              ? { type: "indicator", name: operand.name, periodParam: paramKeys[0] ?? "period" }
              : { type: "indicator", name: operand.name, period: 14 },
          )
        }
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="fixed">period</option>
        <option value="param">period from parameter</option>
      </select>
      {usingParam ? (
        <select
          aria-label={`${label} period parameter`}
          value={operand.periodParam}
          onChange={(e) => onChange({ type: "indicator", name: operand.name, periodParam: e.target.value })}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {paramKeys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      ) : (
        <Input
          aria-label={`${label} period`}
          type="number"
          min={2}
          max={400}
          value={operand.period ?? 14}
          onChange={(e) => onChange({ type: "indicator", name: operand.name, period: Number(e.target.value) })}
          className="h-9 w-20"
        />
      )}
    </>
  );
}

/** Switching indicator keeps a sensible period when the new one needs it, and drops it when it does not. */
function withIndicator(prev: Extract<Operand, { type: "indicator" }>, name: IndicatorName): Operand {
  if (PERIOD_INDICATORS.has(name)) {
    return prev.periodParam !== undefined
      ? { type: "indicator", name, periodParam: prev.periodParam }
      : { type: "indicator", name, period: prev.period ?? 14 };
  }
  return { type: "indicator", name };
}
