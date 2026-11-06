/** Port of nselib/libutil.py trading_holiday_calendar. */
import { fetchJson, NseError } from "../core/http";
import type { Row } from "../core/csv";
import { type MethodDef } from "./types";

/** nselib maps product codes to names; anything else is 'Unknown'. */
const PRODUCTS: Record<string, string> = {
  CBM: "Corporate Bonds",
  CD: "Currency Derivatives",
  CM: "Equities",
  CMOT: "CMOT",
  COM: "Commodity Derivatives",
  FO: "Equity Derivatives",
  IRD: "Interest Rate Derivatives",
  MF: "Mutual Funds",
  NDM: "New Debt Segment",
  NTRP: "Negotiated Trade Reporting Platform",
  SLBS: "Securities Lending & Borrowing Schemes",
};

export const utilityMethods: MethodDef[] = [
  {
    name: "trading_holiday_calendar",
    module: "utilities",
    description: "NSE trading holidays for every product segment.",
    params: [],
    run: async () => {
      let data: Record<string, unknown>;
      try {
        data = await fetchJson<Record<string, unknown>>("https://www.nseindia.com/api/holiday-master?type=trading");
      } catch {
        throw new NseError("Calender data Not found try after some time", 502);
      }
      const rows: Row[] = [];
      for (const [code, entries] of Object.entries(data)) {
        for (const entry of (entries as Row[]) ?? []) {
          rows.push({ Product: PRODUCTS[code] ?? "Unknown", ...entry });
        }
      }
      return rows;
    },
  },
];
