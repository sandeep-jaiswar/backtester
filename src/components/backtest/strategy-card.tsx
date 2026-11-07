import Link from "next/link";
import { Activity } from "@heroui/shared-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import type { ResultEvent } from "./use-backtest-stream";
import { cn } from "@/lib/utils";
import { Term } from "@/components/ui/term";
import type { GlossaryKey } from "@/lib/glossary";
import type { Verdict } from "@/lib/backtest/verdict";

interface Props {
  name: string;
  description?: string;
  result?: ResultEvent;
  error?: string;
  benchmark?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  currency?: string;
  verdict?: Verdict;
}

export function StrategyCard({ name, description, result, error, benchmark, selected, onSelect, currency, verdict }: Props) {
  const m = result?.metrics;
  const tone = m ? (m.totalReturnPct >= 0 ? "text-positive" : "text-negative") : "";

  return (
    <Card
      onClick={onSelect}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? selected : undefined}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      className={cn(
        "gap-3 transition-colors",
        onSelect && "cursor-pointer hover:border-foreground/30",
        onSelect && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-foreground/60 ring-1 ring-foreground/20",
      )}
    >
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="truncate">{name}</span>
          {benchmark ? <Badge variant="secondary">Benchmark</Badge> : null}
        </CardTitle>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        {result && Object.keys(result.params).length > 0 ? (
          <p className="font-mono text-xs text-muted-foreground">
            {Object.entries(result.params)
              .map(([k, v]) => `${k}=${v}`)
              .join("  ")}
          </p>
        ) : null}
      </CardHeader>

      <CardContent>
        {error ? (
          <p className="text-sm text-negative">{error}</p>
        ) : !m ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Activity className="size-4 animate-pulse" />
            Running…
          </div>
        ) : (
          <div className="grid gap-4">
            <div>
              <div className={cn("text-2xl font-semibold tabular-nums", tone)}>
                {fmtPct(m.totalReturnPct)}
              </div>
              <div className="text-xs text-muted-foreground">
                Total return · CAGR {fmtPct(m.cagrPct)}
              </div>
            </div>
            {verdict ? (
              <div className="grid gap-1 text-sm">
                <p>{verdict.headline}</p>
                {verdict.caveats.map((c) => (
                  <p key={c} className="text-xs text-muted-foreground">
                    {c}
                  </p>
                ))}
              </div>
            ) : null}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Stat term="maxDrawdown" label="Max drawdown" value={fmtPct(m.maxDrawdownPct)} negative />
              <Stat term="sharpe" label="Sharpe" value={fmtNum(m.sharpe)} />
              <Stat term="sortino" label="Sortino" value={fmtNum(m.sortino)} />
              <Stat term="volatility" label="Volatility" value={`${fmtNum(m.volatilityPct, 1)}%`} />
              <Stat term="calmar" label="Calmar" value={fmtNum(m.calmar)} />
              <Stat label="Trades" value={String(m.tradeCount)} />
              <Stat term="winRate" label="Win rate" value={`${fmtNum(m.winRatePct, 1)}%`} />
              <Stat
                term="profitFactor" label="Profit factor"
                value={m.profitFactor === null ? "no losses" : fmtNum(m.profitFactor)}
              />
              <Stat label="Fees paid" value={fmtMoney(m.totalFeesPaid, currency)} />
              <Stat term="exposure" label="Time in market" value={`${fmtNum(m.exposurePct, 1)}%`} />
            </dl>
            <Link
              href={`/runs/${result!.manifest.runId}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Saved run {result!.manifest.runId}
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, term, value, negative }: { label: string; term?: GlossaryKey; value: string; negative?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{term ? <Term id={term}>{label}</Term> : label}</dt>
      <dd className={cn("font-medium tabular-nums", negative && "text-negative")}>{value}</dd>
    </div>
  );
}
