"use client";

import { useMemo, useState } from "react";
import { Flash, Search, Scale } from "@heroui/shared-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { strategies } from "@/lib/strategies";
import type { BacktestRequestBody } from "./use-backtest-stream";
import { useCustomStrategies } from "@/components/strategies/use-custom-strategies";
import { BENCHMARK_STRATEGY_ID, DEFAULT_BACKTEST } from "@/lib/backtest/config";
import { todayIsoDate } from "@/lib/format";

// Buy & hold is always run as the benchmark, so it is not user-selectable.
const builtinSelectable = strategies.filter((s) => s.id !== BENCHMARK_STRATEGY_ID);

interface Selectable {
  id: string;
  name: string;
  description: string;
  params: { key: string; label: string; default: number; min: number; max: number; step: number }[];
}

type ParamValues = Record<string, number>;

function defaultParams(): Record<string, ParamValues> {
  return Object.fromEntries(
    builtinSelectable.map((s) => [s.id, Object.fromEntries(s.params.map((p) => [p.key, p.default]))]),
  );
}

interface Props {
  running: boolean;
  onRun: (body: BacktestRequestBody) => void;
  onCancel: () => void;
}

export function BacktestForm({ running, onRun, onCancel }: Props) {
  const custom = useCustomStrategies();
  const selectable: Selectable[] = useMemo(
    () => [
      ...builtinSelectable,
      ...custom.map((c) => ({ id: c.id, name: c.name, description: c.description, params: c.definition.params })),
    ],
    [custom],
  );
  const defaultsFor = (id: string): ParamValues =>
    Object.fromEntries((selectable.find((s) => s.id === id)?.params ?? []).map((p) => [p.key, p.default]));

  const [symbol, setSymbol] = useState<string>(DEFAULT_BACKTEST.symbol);
  const [start, setStart] = useState<string>(DEFAULT_BACKTEST.startDate);
  const [end, setEnd] = useState("");
  const [capital, setCapital] = useState<number>(DEFAULT_BACKTEST.capital);
  const [commissionBps, setCommissionBps] = useState<number>(DEFAULT_BACKTEST.commissionBps);
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_BACKTEST.slippageBps);
  const [costChoice, setCostChoice] = useState<"auto" | "flat" | "india-delivery">("auto");
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(selectable.map((s) => [s.id, true])),
  );
  const [params, setParams] = useState(defaultParams);

  const selectedCount = useMemo(() => Object.values(enabled).filter(Boolean).length, [enabled]);

  const setParam = (strategyId: string, key: string, value: number) =>
    setParams((prev) => ({
      ...prev,
      [strategyId]: { ...(prev[strategyId] ?? defaultsFor(strategyId)), [key]: value },
    }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const runs = selectable
      .filter((s) => enabled[s.id])
      .map((s) => ({ strategyId: s.id, params: params[s.id] ?? defaultsFor(s.id) }));
    onRun({
      symbol: symbol.trim().toUpperCase(),
      start,
      end: end || todayIsoDate(),
      capital,
      commissionBps,
      slippageBps,
      costProfile: costChoice === "auto" ? undefined : costChoice,
      runs,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="size-4" /> Market data
          </CardTitle>
          <CardDescription>Daily bars, fetched from Yahoo Finance at run time.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="symbol">Symbol</Label>
            <Input
              id="symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. AAPL, RELIANCE.NS, ^NSEI"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="start">Start</Label>
              <Input id="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="end">End (blank = today)</Label>
              <Input id="end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumberField id="capital" label="Capital" value={capital} onChange={setCapital} step={1000} />
            <NumberField id="commission" label="Commission bps" value={commissionBps} onChange={setCommissionBps} step={1} />
            <NumberField id="slippage" label="Slippage bps" value={slippageBps} onChange={setSlippageBps} step={1} />
            <div className="grid gap-2">
              <Label htmlFor="cost-profile">Cost profile</Label>
              <select
                id="cost-profile"
                value={costChoice}
                onChange={(e) => setCostChoice(e.target.value as typeof costChoice)}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="auto">Auto (by symbol)</option>
                <option value="flat">Flat bps</option>
                <option value="india-delivery">India delivery (NSE/BSE)</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="size-4" /> Strategies
          </CardTitle>
          <CardDescription>Selected strategies run in parallel against the same data.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {selectable.map((s) => {
            const on = enabled[s.id];
            return (
              <div key={s.id} className="grid gap-3 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground">{s.description}</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    onClick={() => setEnabled((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
                  >
                    {on ? "On" : "Off"}
                  </Button>
                </div>
                {on && s.params.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    {s.params.map((p) => (
                      <NumberField
                        key={p.key}
                        id={`${s.id}-${p.key}`}
                        label={p.label}
                        value={params[s.id]?.[p.key] ?? p.default}
                        min={p.min}
                        max={p.max}
                        step={p.step}
                        onChange={(v) => setParam(s.id, p.key, v)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        {running ? (
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button type="submit" className="flex-1" disabled={selectedCount === 0}>
            <Flash className="size-4" />
            Run {selectedCount} {selectedCount === 1 ? "strategy" : "strategies"}
          </Button>
        )}
        <Badge variant="secondary" className="self-center">
          + Buy & Hold
        </Badge>
      </div>
    </form>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </div>
  );
}
