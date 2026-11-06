"use client";

import { useMemo } from "react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import type { Trade } from "@/lib/backtest/types";
import { fmtPct } from "@/lib/format";

// AG Grid Community v33+ requires explicit module registration.
ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 13,
  headerFontWeight: 600,
});

const columnDefs: ColDef<Trade>[] = [
  { field: "entryDate", headerName: "Entry", width: 120 },
  { field: "entryPrice", headerName: "Entry price", type: "numericColumn", valueFormatter: (p) => p.value?.toFixed(2) },
  { field: "exitDate", headerName: "Exit", width: 120 },
  { field: "exitPrice", headerName: "Exit price", type: "numericColumn", valueFormatter: (p) => p.value?.toFixed(2) },
  { field: "shares", headerName: "Shares", type: "numericColumn", valueFormatter: (p) => p.value?.toLocaleString("en-US") },
  {
    field: "pnl",
    headerName: "P&L",
    type: "numericColumn",
    valueFormatter: (p) => (p.value == null ? "" : p.value.toLocaleString("en-US", { maximumFractionDigits: 2 })),
    cellClassRules: { "text-positive": (p) => (p.value ?? 0) > 0, "text-negative": (p) => (p.value ?? 0) < 0 },
  },
  {
    field: "returnPct",
    headerName: "Return",
    type: "numericColumn",
    valueFormatter: (p) => fmtPct(p.value ?? 0),
    cellClassRules: { "text-positive": (p) => (p.value ?? 0) > 0, "text-negative": (p) => (p.value ?? 0) < 0 },
  },
  { field: "barsHeld", headerName: "Bars held", type: "numericColumn" },
  {
    field: "openAtEnd",
    headerName: "Status",
    valueFormatter: (p) => (p.value ? "Open (marked)" : "Closed"),
    width: 130,
  },
];

export function TradesGrid({ trades }: { trades: Trade[] }) {
  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, resizable: true, flex: 1, minWidth: 100 }),
    [],
  );

  return (
    <div style={{ height: 380 }} className="w-full">
      <AgGridReact<Trade>
        theme={theme}
        rowData={trades}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        pagination
        paginationPageSize={15}
        paginationPageSizeSelector={[15, 30, 60]}
        overlayNoRowsTemplate="<span>No trades. The strategy stayed flat for this period.</span>"
      />
    </div>
  );
}
