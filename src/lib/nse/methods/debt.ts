/** Port of nselib/debt/debt_data.py. */
import { fetchFile } from "../core/http";
import { parseCsv } from "../core/csv";
import { parseDmy, fmtDdmmyyyy } from "../core/dates";
import { type MethodDef, P } from "./types";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export const debtMethods: MethodDef[] = [
  {
    name: "securities_available_for_trading",
    module: "debt",
    description: "Debt securities available for trading (WDM list) for a trade date.",
    params: [P.tradeDate],
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      const month = MONTHS[d.getUTCMonth()];
      const year = d.getUTCFullYear();
      const url = `https://nsearchives.nseindia.com/content/historical/WDM/${year}/${month}/wdmlist_${fmtDdmmyyyy(d)}.csv`;
      const buf = await fetchFile(url, "https://www.nseindia.com/all-reports-debt", "No data available");
      // nselib: pd.read_csv with raw headers
      return parseCsv(buf.toString("utf-8"), { stripHeaderSpaces: false }).rows;
    },
  },
];
