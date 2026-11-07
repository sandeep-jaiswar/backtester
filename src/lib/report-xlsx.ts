import * as XLSX from "xlsx";
import { drawdownEpisodes, monthlyReturns } from "@/lib/backtest/analytics";
import { drawdownSeries } from "@/lib/backtest/metrics";
import type { RunManifest } from "@/lib/backtest/manifest";
import type { Metrics, Trade } from "@/lib/backtest/types";

export interface ReportInput {
  fileName: string;
  manifest: RunManifest;
  metrics: Metrics;
  trades: Trade[];
  dates: string[];
  equity: number[];
}

/**
 * Builds a multi-sheet Excel workbook for one run and downloads it. Runs in the browser.
 * Sheets: Summary (metrics, benchmark, reproducibility), Trades, Equity, Drawdowns, Monthly.
 */
export function downloadReport(input: ReportInput): void {
  const { manifest: m, metrics, trades, dates, equity } = input;
  const wb = XLSX.utils.book_new();

  const summary: (string | number | boolean | null)[][] = [["Section", "Item", "Value"]];
  const { benchmark, ...scalarMetrics } = metrics;
  for (const [k, v] of Object.entries(scalarMetrics)) summary.push(["Metrics", k, v]);
  if (benchmark) {
    for (const [k, v] of Object.entries(benchmark)) summary.push(["Benchmark (buy & hold)", k, v]);
  }
  summary.push(["Reproducibility", "runId", m.runId]);
  summary.push(["Reproducibility", "datasetHash", m.datasetHash]);
  summary.push(["Reproducibility", "engineVersion", m.engineVersion]);
  summary.push(["Reproducibility", "strategyId", m.strategyId]);
  summary.push(["Reproducibility", "params", JSON.stringify(m.params)]);
  summary.push(["Reproducibility", "symbol", m.symbol]);
  summary.push(["Reproducibility", "start", m.start]);
  summary.push(["Reproducibility", "end", m.end]);
  summary.push(["Reproducibility", "capital", m.capital]);
  summary.push(["Reproducibility", "costProfile", m.costProfile]);
  summary.push(["Reproducibility", "slippageBps", m.slippageBps]);
  summary.push(["Reproducibility", "riskFreeRatePct", m.riskFreeRatePct]);
  if (m.stopLossPct !== undefined) summary.push(["Reproducibility", "stopLossPct", m.stopLossPct]);
  if (m.takeProfitPct !== undefined) summary.push(["Reproducibility", "takeProfitPct", m.takeProfitPct]);
  if (m.positionFraction !== undefined) summary.push(["Reproducibility", "positionFraction", m.positionFraction]);
  summary.push([]);
  summary.push(["Disclaimer", "", "Backtested results are hypothetical, use historical data, and have inherent limitations. They do not represent actual trading and do not guarantee future results. This is not investment advice."]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

  const tradeRows = [
    ["Entry date", "Entry price", "Exit date", "Exit price", "Shares", "P&L", "Return %", "Bars held", "Fees", "Exit reason", "Open at end"],
    ...trades.map((t) => [
      t.entryDate, t.entryPrice, t.exitDate, t.exitPrice, t.shares, t.pnl, t.returnPct, t.barsHeld, t.fees,
      t.exitReason ?? "", t.openAtEnd,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tradeRows), "Trades");

  const dd = drawdownSeries(equity);
  const equityRows = [
    ["Date", "Equity", "Drawdown %"],
    ...equity.map((v, i) => [dates[i] ?? `#${i + 1}`, v, Math.round(dd[i] * 10_000) / 100]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(equityRows), "Equity");

  const episodes = drawdownEpisodes(equity, dates, 5);
  const ddRows = [
    ["Peak", "Trough", "Recovered", "Depth %", "Bars"],
    ...episodes.map((e) => [e.startDate, e.troughDate, e.recoveryDate ?? "not yet", e.depthPct, e.bars]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ddRows), "Drawdowns");

  const monthRows = [
    ["Year", "Month", "Return %"],
    ...monthlyReturns(equity, dates).map((x) => [x.year, x.month, x.returnPct]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(monthRows), "Monthly");

  XLSX.writeFile(wb, input.fileName);
}
