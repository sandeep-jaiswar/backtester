"use client";

import { useEffect, useMemo, useState } from "react";
import { Flash, Search, Scale } from "@heroui/shared-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { strategies } from "@/lib/strategies";
import type { BacktestRequestBody } from "./use-backtest-stream";

// Buy & hold is always run as the benchmark, so it is not user-selectable.
const selectable = strategies.filter((s) => s.id !== "buy-and-hold");

type ParamValues = Record<string, number>;

function defaultParams(): Record<string, ParamValues> {
  return Object.fromEntries(
    selectable.map((s) => [s.id, Object.fromEntries(s.params.map((p) => [p.key, p.default]))]),
  );
}

interface Props {
  running: boolean;
  onRun: (body: BacktestRequestBody) => void;
  onCancel: () => void;
}

export function BacktestForm({ running, onRun, onCancel }: Props) {
  const [symbol, setSymbol] = useState("AAPL");
  const [start, setStart] = useState("2019-01-01");
  const [end, setEnd] = useState("");
  const [capital, setCapital] = useState(100_000);
  const [commissionBps, setCommissionBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(selectable.map((s) => [s.id, true])),
  );
  const [params, setParams] = useState(defaultParams);

  // Set the default end date on the client to avoid a server/client hydration mismatch.
  useEffect(() => {
    setEnd(new Date().toISOString().slice(0, 10));
  }, []);

  const selectedCount = useMemo(() => Object.values(enabled).filter(Boolean).length, [enabled]);

  const setParam = (strategyId: string, key: string, value: number) =>
    setParams((prev) => ({ ...prev, [strategyId]: { ...prev[strategyId], [key]: value } }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const runs = selectable
      .filter((s) => enabled[s.id])
      .map((s) => ({ strategyId: s.id, params: params[s.id] }));
    onRun({
      symbol: symbol.trim().toUpperCase(),
      start,
      end,
      capital,
      commissionBps,
      slippageBps,
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
              placeholder="AAPL, RELIANCE.NS, ^NSEI"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="start">Start</Label>
              <Input id="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="end">End</Label>
              <Input id="end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <NumberField id="capital" label="Capital" value={capital} onChange={setCapital} step={1000} />
            <NumberField id="commission" label="Commission bps" value={commissionBps} onChange={setCommissionBps} step={1} />
            <NumberField id="slippage" label="Slippage bps" value={slippageBps} onChange={setSlippageBps} step={1} />
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
                        value={params[s.id][p.key]}
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
