/**
 * A plain-English summary of one run, so a user does not have to read a metric grid to get the point.
 * Pure: safe on the server and in the browser.
 */
export interface VerdictInput {
  totalReturnPct: number;
  maxDrawdownPct: number;
  tradeCount: number;
}

export interface Verdict {
  headline: string;
  caveats: string[];
}

export function verdict(run: VerdictInput, benchmark?: VerdictInput | null): Verdict {
  const caveats: string[] = [];
  if (run.tradeCount === 0) {
    caveats.push("No trades were made, so this is the same as holding cash.");
  } else if (run.tradeCount < 10) {
    caveats.push(`Only ${run.tradeCount} trades. That is too few to rely on.`);
  }

  if (!benchmark) {
    return {
      headline: `Returned ${fmt(run.totalReturnPct)}% with a max drawdown of ${fmt(run.maxDrawdownPct)}%.`,
      caveats,
    };
  }

  const gap = run.totalReturnPct - benchmark.totalReturnPct;
  const verb = gap > 0 ? "Beat" : gap < 0 ? "Trailed" : "Matched";
  const headline =
    verb === "Matched"
      ? `Matched buy & hold at ${fmt(run.totalReturnPct)}%.`
      : `${verb} buy & hold by ${fmt(Math.abs(gap))} points: ${fmt(run.totalReturnPct)}% against ${fmt(benchmark.totalReturnPct)}%.`;
  return {
    headline: `${headline} Max drawdown was ${fmt(run.maxDrawdownPct)}% against ${fmt(benchmark.maxDrawdownPct)}%.`,
    caveats,
  };
}

function fmt(n: number): string {
  return n.toFixed(1);
}
