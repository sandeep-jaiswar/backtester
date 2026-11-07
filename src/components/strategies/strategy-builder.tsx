"use client";

import { NumberField } from "@/components/ui/number-field";
import { hasBlankNumber } from "@/lib/number-rules";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RuleEditor } from "./rule-editor";
import { errorFrom, type SavedParam, type SavedStrategy } from "./use-custom-strategies";
import { RULE_TEMPLATES } from "@/lib/backtest/rule-templates";
import type { Rule, RuleDefinition } from "@/lib/backtest/rules";

const MAX_PARAMS = 8;

interface Draft {
  id: string | null;
  name: string;
  description: string;
  params: SavedParam[];
  entry: Rule;
  exit: Rule;
}

const BLANK: Draft = {
  id: null,
  name: "My strategy",
  description: "",
  params: [],
  entry: { match: "all", conditions: [{ left: { type: "indicator", name: "close" }, op: "gt", right: { type: "number", value: 0 } }] },
  exit: { match: "all", conditions: [{ left: { type: "indicator", name: "close" }, op: "lt", right: { type: "number", value: 0 } }] },
};

function fromTemplate(id: string | null, name: string, def: RuleDefinition): Draft {
  return { id, name, description: "", params: def.params, entry: def.entry, exit: def.exit };
}

function fromSaved(s: SavedStrategy): Draft {
  const def = s.definition as unknown as RuleDefinition;
  return { id: s.id, name: s.name, description: s.description, params: def.params, entry: def.entry, exit: def.exit };
}

export function StrategyBuilder() {
  const [list, setList] = useState<SavedStrategy[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/strategies");
      if (!r.ok) throw new Error(await errorFrom(r, "Could not load strategies"));
      const d = (await r.json()) as { strategies: SavedStrategy[] };
      setList(d.strategies);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load strategies");
      setList([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/strategies")
      .then(async (r) => {
        if (!r.ok) throw new Error(await errorFrom(r, "Could not load strategies"));
        return (await r.json()) as { strategies: SavedStrategy[] };
      })
      .then((d) => alive && setList(d.strategies))
      .catch((e: Error) => {
        if (!alive) return;
        setLoadError(e.message);
        setList([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const paramKeys = useMemo(() => (draft ? draft.params.map((p) => p.key) : []), [draft]);

  const setParam = (i: number, patch: Partial<SavedParam>) =>
    setDraft((d) => (d ? { ...d, params: d.params.map((p, j) => (j === i ? { ...p, ...patch } : p)) } : d));

  const addParam = () =>
    setDraft((d) => {
      if (!d || d.params.length >= MAX_PARAMS) return d;
      const n = d.params.length + 1;
      const p: SavedParam = { key: `param${n}`, label: `Parameter ${n}`, default: 10, min: 1, max: 100, step: 1 };
      return { ...d, params: [...d.params, p] };
    });

  const removeParam = (i: number) => setDraft((d) => (d ? { ...d, params: d.params.filter((_, j) => j !== i) } : d));

  const save = async () => {
    if (!draft) return;
    if (hasBlankNumber(draft)) {
      setMessage({ kind: "error", text: "Fill in every number field before saving." });
      return;
    }
    setSaving(true);
    setMessage(null);
    const body = {
      name: draft.name,
      description: draft.description,
      definition: { version: 1, params: draft.params, entry: draft.entry, exit: draft.exit },
    };
    try {
      const r = await fetch(draft.id ? `/api/strategies/${draft.id}` : "/api/strategies", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await errorFrom(r, "Could not save the strategy"));
      const saved = (await r.json()) as SavedStrategy;
      setDraft(fromSaved(saved));
      setMessage({ kind: "ok", text: "Saved. It now appears in the Backtest and Optimise strategy lists." });
      await refresh();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Could not save the strategy" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    if (!window.confirm(`Delete "${draft.name}"? Saved runs keep their results.`)) return;
    const r = await fetch(`/api/strategies/${draft.id}`, { method: "DELETE" });
    if (!r.ok) {
      setMessage({ kind: "error", text: await errorFrom(r, "Could not delete the strategy") });
      return;
    }
    setDraft(null);
    setMessage(null);
    await refresh();
  };

  return (
    <main className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6 p-4 md:p-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Strategies</h1>
          <p className="text-sm text-muted-foreground">Build rule-based strategies without code.</p>
        </div>
        <Button onClick={() => setDraft(BLANK)}>New strategy</Button>
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">Start from a template</span>
          {RULE_TEMPLATES.map((t) => (
            <Button
              key={t.id}
              variant="outline"
              className="justify-start"
              onClick={() => setDraft(fromTemplate(null, t.name, t.definition))}
            >
              {t.name}
            </Button>
          ))}
        </div>
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">Saved</span>
          {loadError ? <p className="text-sm text-negative">{loadError}</p> : null}
          {list === null ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {list?.length === 0 && !loadError ? <p className="text-sm text-muted-foreground">Nothing saved yet.</p> : null}
          {list?.map((s) => (
            <Button
              key={s.id}
              variant={draft?.id === s.id ? "default" : "ghost"}
              className="justify-start"
              onClick={() => {
                setDraft(fromSaved(s));
                setMessage(null);
              }}
            >
              {s.name}
            </Button>
          ))}
        </div>
        <Link href="/optimize" className="text-sm text-muted-foreground underline underline-offset-4">
          Optimise a saved strategy →
        </Link>
      </aside>

      <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
        {!draft ? (
          <Card>
            <CardHeader>
              <CardTitle>Pick a strategy</CardTitle>
              <CardDescription>
                Open one from the list, start a template, or create a new strategy. Entry rules buy and exit rules sell at the next open.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{draft.id ? "Edit strategy" : "New strategy"}</CardTitle>
                <CardDescription>
                  Parameters are the knobs you can change per run and sweep in the optimiser. Rules refer to them by key.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="strategy-name">Name</Label>
                    <Input id="strategy-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="strategy-desc">Description</Label>
                    <Input id="strategy-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={300} />
                  </div>
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Parameters</span>
                    <Button variant="outline" size="sm" onClick={addParam} disabled={draft.params.length >= MAX_PARAMS}>
                      Add parameter
                    </Button>
                  </div>
                  {draft.params.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No parameters. Rules will use fixed numbers.</p>
                  ) : null}
                  {draft.params.map((p, i) => (
                    <div key={i} className="grid gap-2 rounded-md border p-2 md:grid-cols-[1fr_1fr_repeat(4,_minmax(0,_5rem))_auto] md:items-end">
                      <LabeledInput label="Key" value={p.key} onChange={(v) => setParam(i, { key: v })} />
                      <LabeledInput label="Label" value={p.label} onChange={(v) => setParam(i, { label: v })} />
                      <LabeledNumber label="Default" value={p.default} onChange={(v) => setParam(i, { default: v })} />
                      <LabeledNumber label="Min" value={p.min} onChange={(v) => setParam(i, { min: v })} />
                      <LabeledNumber label="Max" value={p.max} onChange={(v) => setParam(i, { max: v })} />
                      <LabeledNumber label="Step" value={p.step} onChange={(v) => setParam(i, { step: v })} />
                      <Button variant="ghost" size="sm" onClick={() => removeParam(i)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <RuleEditor
              title="Entry rule"
              hint="When this is true, the strategy goes long at the next open."
              rule={draft.entry}
              paramKeys={paramKeys}
              onChange={(entry) => setDraft({ ...draft, entry })}
            />
            <RuleEditor
              title="Exit rule"
              hint="When this is true while long, the strategy sells at the next open."
              rule={draft.exit}
              paramKeys={paramKeys}
              onChange={(exit) => setDraft({ ...draft, exit })}
            />

            {message ? (
              <p className={message.kind === "ok" ? "text-sm text-positive" : "text-sm text-negative"}>{message.text}</p>
            ) : null}

            {draft && hasBlankNumber(draft) ? (
              <p className="text-sm text-muted-foreground">Fill in every number field to save.</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={saving || (!!draft && hasBlankNumber(draft))}>
                {saving ? "Saving…" : draft.id ? "Save changes" : "Save strategy"}
              </Button>
              {draft.id ? (
                <Button variant="outline" onClick={remove}>
                  Delete
                </Button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-9 text-foreground" />
    </label>
  );
}

function LabeledNumber({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <NumberField label={label} value={value} onChange={onChange} />;
}
