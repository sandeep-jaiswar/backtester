import { Activity } from "@heroui/shared-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import type { ResultEvent } from "./use-backtest-stream";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  description?: string;
  result?: ResultEvent;
  error?: string;
  benchmark?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  currency?: string;
}

export function StrategyCard({ name, description, result, error, benchmark, selected, onSelect, currency }: Props) {
  const m = result?.metrics;
  const tone = m ? (m.totalReturnPct >= 0 ? "text-positive" : "text-negative") : "";

  return (
    <Card
      onClick={onSelect}
      className={cn(
        "gap-3 transition-colors",
        onSelect && "cursor-pointer hover:border-foreground/30",
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
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Stat label="Max drawdown" value={fmtPct(m.maxDrawdownPct)} negative />
              <Stat label="Sharpe" value={fmtNum(m.sharpe)} />
              <Stat label="Sortino" value={fmtNum(m.sortino)} />
              <Stat label="Volatility" value={`${fmtNum(m.volatilityPct, 1)}%`} />
              <Stat label="Calmar" value={fmtNum(m.calmar)} />
              <Stat label="Trades" value={String(m.tradeCount)} />
              <Stat label="Win rate" value={`${fmtNum(m.winRatePct, 1)}%`} />
              <Stat
                label="Profit factor"
                value={m.profitFactor === null ? "no losses" : fmtNum(m.profitFactor)}
              />
              <Stat label="Fees paid" value={fmtMoney(m.totalFeesPaid, currency)} />
              <Stat label="Time in market" value={`${fmtNum(m.exposurePct, 1)}%`} />
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium tabular-nums", negative && "text-negative")}>{value}</dd>
    </div>
  );
}
