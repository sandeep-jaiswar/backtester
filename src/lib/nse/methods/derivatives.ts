/**
 * Port of nselib/derivatives/derivative_data.py and get_func.py.
 * NOTE: nselib's option_price_volume_data raises when a chunk is empty, which aborts the whole call.
 * This port skips empty chunks instead.
 */
import { fetchFile, fetchJson, nseFetch, NseError } from "../core/http";
import { parseCsv, type Row } from "../core/csv";
import { cleaningColumnName, cleaningNseSymbol, future_price_volume_data_column, OPTION_INDICES } from "../core/constants";
import { fmtDMonY, fmtDdmmyy, fmtDdmmyyyy, fmtYyyymmdd, parseDmy } from "../core/dates";
import {
  categoryTurnoverRows,
  chunkedRows,
  readXlsMatrix,
  resolveRange,
  selectColumns,
  unzipLastCsv,
} from "./shared";
import { type MethodDef, P, type ParamDef } from "./types";
import { dailyVolatilityReport } from "./volatility";
import { cleanBusinessGrowth, fetchBusinessGrowth, normDailyArgs, normFinancialYear } from "./business-growth";

type DateArgs = Parameters<typeof resolveRange>[0];
const dateArgs = (p: Record<string, unknown>) => p as DateArgs;

const FO_PAGE = "https://www.nseindia.com/report-detail/fo_eq_security";
const DATE_PARAMS: ParamDef[] = [P.fromDate, P.toDate, P.period];
const TRADE_DATE: ParamDef[] = [P.tradeDate];
const FUTURE_INSTRUMENTS = ["FUTIDX", "FUTSTK"] as const;
const OPTION_INSTRUMENTS = ["OPTIDX", "OPTSTK"] as const;
const OPTION_TYPES = ["PE", "CE"] as const;

const cleanKeys = (r: Row): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => [cleaningColumnName(k), v]));

/** nselib get_future_price_volume_data / get_option_price_volume_data. */
async function foCpv(symbol: string, instrument: string, from: string, to: string, optionType?: string): Promise<Row[]> {
  const opt = optionType ? `&optionType=${optionType}` : "";
  const url =
    "https://www.nseindia.com/api/historicalOR/foCPV?" +
    `from=${from}&to=${to}&instrumentType=${instrument}&symbol=${symbol}${opt}&csv=true`;
  const json = await fetchJson<{ data: Row[] }>(url, FO_PAGE);
  return (json.data ?? []).map(cleanKeys);
}

/** NSE returns a zip for bhavcopy; falls back to the reports API on 403, as nselib does. */
async function bhavZip(primary: string, fallback: string | null, notFound: string): Promise<Buffer> {
  const first = await nseFetch(primary);
  if (first.ok) return Buffer.from(await first.arrayBuffer());
  if (first.status === 403 && fallback) {
    const second = await nseFetch(fallback);
    if (second.ok) return Buffer.from(await second.arrayBuffer());
  }
  throw new NseError(notFound, 404);
}

/** Participant-wise CSVs: skiprows=1, pandas raw headers. Falls back to the archives host on 404. */
async function participantCsv(urls: string[], label: string, tradeDate: Date): Promise<Row[]> {
  for (const url of urls) {
    const res = await nseFetch(url);
    if (res.status === 404) continue;
    if (!res.ok) break;
    const text = Buffer.from(await res.arrayBuffer()).toString("utf-8");
    return parseCsv(text, { skipRows: 1, stripHeaderSpaces: false }).rows;
  }
  throw new NseError(`No ${label} data available for ${fmtDMonY(tradeDate)}`, 404);
}

/** nselib get_nse_option_chain: index symbols use type=Indices, everything else type=Equity. */
async function optionChainPayload(symbol: string, expiry: string): Promise<Record<string, any>> {
  const isIndex = OPTION_INDICES.some((x) => symbol.includes(x));
  const url = `https://www.nseindia.com/api/option-chain-v3?type=${isIndex ? "Indices" : "Equity"}&symbol=${symbol}&expiry=${expiry}`;
  return fetchJson<Record<string, any>>(url, "https://www.nseindia.com/option-chain");
}

/**
 * nselib nse_live_option_chain row builder. Missing sides are zero, as in nselib.
 * NOTE: nselib sends the literal "None" in the expiry parameter when no expiry is given. This keeps that.
 */
export function buildOptionChainRows(payload: Record<string, any>, expiryFmt: string | null, oiMode: string): Row[] {
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const rows: Row[] = [];
  for (const rec of (payload.records?.data ?? []) as Array<Record<string, any>>) {
    if (expiryFmt && rec.expiryDates !== expiryFmt) continue;
    const ce = rec.CE ?? {};
    const pe = rec.PE ?? {};
    const full = oiMode === "full";
    rows.push({
      Fetch_Time: null,
      Symbol: null,
      Expiry_Date: rec.expiryDates ?? null,
      CALLS_OI: n(ce.openInterest),
      CALLS_Chng_in_OI: n(ce.changeinOpenInterest),
      CALLS_Volume: n(ce.totalTradedVolume),
      CALLS_IV: n(ce.impliedVolatility),
      CALLS_LTP: n(ce.lastPrice),
      CALLS_Net_Chng: n(ce.change),
      CALLS_Bid_Qty: full ? n(ce.buyQuantity1) : 0,
      CALLS_Bid_Price: full ? n(ce.buyPrice1) : 0,
      CALLS_Ask_Price: full ? n(ce.sellPrice1) : 0,
      CALLS_Ask_Qty: full ? n(ce.sellQuantity1) : 0,
      Strike_Price: n(rec.strikePrice),
      PUTS_OI: n(pe.openInterest),
      PUTS_Chng_in_OI: n(pe.changeinOpenInterest),
      PUTS_Volume: n(pe.totalTradedVolume),
      PUTS_IV: n(pe.impliedVolatility),
      PUTS_LTP: n(pe.lastPrice),
      PUTS_Net_Chng: n(pe.change),
      PUTS_Bid_Qty: full ? n(pe.buyQuantity1) : 0,
      PUTS_Bid_Price: full ? n(pe.buyPrice1) : 0,
      PUTS_Ask_Price: full ? n(pe.sellPrice1) : 0,
      PUTS_Ask_Qty: full ? n(pe.sellQuantity1) : 0,
    });
  }
  return rows;
}

/** Securities in the F&O ban period: first CSV column, header line skipped. */
function banSymbols(text: string): string[] {
  return text
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(",")[1])
    .filter((s): s is string => s !== undefined);
}

export const derivativesMethods: MethodDef[] = [
  {
    name: "future_price_volume_data",
    module: "derivatives",
    description: "Futures price and volume history (FUTIDX or FUTSTK), chunked by 91 days.",
    params: [
      P.symbol,
      { name: "instrument", type: "string", required: true, options: FUTURE_INSTRUMENTS, description: "FUTIDX or FUTSTK" },
      ...DATE_PARAMS,
    ],
    run: async (p) => {
      const instrument = String(p.instrument).toUpperCase();
      if (!(FUTURE_INSTRUMENTS as readonly string[]).includes(instrument)) {
        throw new NseError(`${instrument} is not a future instrument`, 400);
      }
      const symbol = cleaningNseSymbol(String(p.symbol));
      const range = await resolveRange(dateArgs(p));
      return chunkedRows(range, "fo", (s, e) => foCpv(symbol, instrument, s, e));
    },
  },
  {
    name: "option_price_volume_data",
    module: "derivatives",
    description: "Options price and volume history (OPTIDX or OPTSTK), PE and CE by default, chunked by 91 days.",
    params: [
      P.symbol,
      { name: "instrument", type: "string", required: true, options: OPTION_INSTRUMENTS, description: "OPTIDX or OPTSTK" },
      { name: "option_type", type: "string", options: OPTION_TYPES, description: "PE or CE. Omit for both" },
      ...DATE_PARAMS,
    ],
    run: async (p) => {
      const instrument = String(p.instrument).toUpperCase();
      if (!(OPTION_INSTRUMENTS as readonly string[]).includes(instrument)) {
        throw new NseError(`${instrument} is not an option instrument`, 400);
      }
      const symbol = cleaningNseSymbol(String(p.symbol));
      const types = p.option_type ? [String(p.option_type)] : [...OPTION_TYPES];
      const range = await resolveRange(dateArgs(p));
      const rows = await chunkedRows(range, "fo", async (s, e) => {
        const out: Row[] = [];
        for (const t of types) out.push(...(await foCpv(symbol, instrument, s, e, t)));
        return out;
      });
      return selectColumns(rows, future_price_volume_data_column);
    },
  },
  {
    name: "fno_bhav_copy",
    module: "derivatives",
    description: "F&O bhavcopy (zip archive) for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      const fallback =
        "https://www.nseindia.com/api/reports?archives=" +
        encodeURIComponent(JSON.stringify([{ name: "F&O - Bhavcopy(csv)", type: "archives", category: "derivatives", section: "equity" }])) +
        `&date=${fmtDMonY(d)}&type=equity&mode=single`;
      const buf = await bhavZip(
        `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${fmtYyyymmdd(d)}_F_0000.csv.zip`,
        fallback,
        "Data not found, change the date",
      );
      return parseCsv(unzipLastCsv(buf), { stripHeaderSpaces: false }).rows;
    },
  },
  {
    name: "participant_wise_open_interest",
    module: "derivatives",
    description: "Participant-wise open interest for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      const file = `fao_participant_oi_${fmtDdmmyyyy(d)}.csv`;
      return participantCsv(
        [`https://nsearchives.nseindia.com/content/nsccl/${file}`, `https://archives.nseindia.com/content/nsccl/${file}`],
        "participant open interest",
        d,
      );
    },
  },
  {
    name: "participant_wise_trading_volume",
    module: "derivatives",
    description: "Participant-wise trading volume for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      return participantCsv(
        [`https://nsearchives.nseindia.com/content/nsccl/fao_participant_vol_${fmtDdmmyyyy(d)}.csv`],
        "participant trading volume",
        d,
      );
    },
  },
  {
    name: "fo_daily_volatility",
    module: "derivatives",
    description: "F&O daily volatility report for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const tradeDate = parseDmy(String(p.trade_date), "trade_date");
      return dailyVolatilityReport({
        tradeDate,
        filename: `FOVOLT_${fmtDdmmyyyy(tradeDate)}.csv`,
        origin: "https://www.nseindia.com/all-reports-derivatives",
        reportName: "F&O - Daily Volatility",
        category: "derivatives",
      });
    },
  },
  {
    name: "category_turnover_fo",
    module: "derivatives",
    description: "F&O turnover by investor category for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      const buf = await fetchFile(
        `https://archives.nseindia.com/archives/fo/cat/fo_cat_turnover_${fmtDdmmyy(d)}.xls`,
        undefined,
        "No data available for this date",
      );
      const raw = readXlsMatrix(buf);
      // nselib only looks for the header in the first 16 rows and reads that single block.
      const headerRow = raw.slice(0, 16).findIndex((row) => {
        const a = String(row?.[0] ?? "").trim().toLowerCase();
        const b = String(row?.[1] ?? "").trim().toLowerCase();
        return a === "trade date" && (b === "category" || b === "client categories");
      });
      if (headerRow < 0) throw new NseError("Category turnover FO data not found for this date", 404);
      const rows = categoryTurnoverRows(raw, (r) => r === headerRow);
      if (rows.length === 0) throw new NseError("Category turnover FO data not found for this date", 404);
      return rows;
    },
  },
  {
    name: "fii_derivatives_statistics",
    module: "derivatives",
    description: "FII derivatives statistics for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      const buf = await fetchFile(
        `https://nsearchives.nseindia.com/content/fo/fii_stats_${fmtDMonY(d)}.xls`,
        undefined,
        "No data available for this date",
      );
      // pd.read_excel(skiprows=3): row 4 becomes the header and is replaced by the 7 names below.
      // skipfooter=10 drops the last 10 rows. dropna() drops any row with a blank cell.
      const cols = [
        "fii_derivatives", "buy_contracts", "buy_value_in_Cr", "sell_contracts", "sell_value_in_Cr",
        "open_contracts", "open_contracts_value_in_Cr",
      ];
      let body = readXlsMatrix(buf).slice(4);
      if (body.length > 10) body = body.slice(0, body.length - 10);
      return body
        .filter((r) => cols.every((_, i) => r?.[i] !== null && r?.[i] !== undefined && String(r[i]).trim() !== ""))
        .map((r) => Object.fromEntries(cols.map((c, i) => [c, (r as unknown[])[i] as string | number])));
    },
  },
  {
    name: "expiry_dates_future",
    module: "derivatives",
    description: "Expiry dates for futures. nselib uses TCS as the reference symbol; the symbol parameter defaults to it.",
    params: [{ name: "symbol", type: "string", default: "TCS", description: "Reference symbol, default TCS (as nselib)" }],
    run: async (p) => {
      const payload = await fetchJson<{ expiryDates: string[] }>(
        `https://www.nseindia.com/api/option-chain-contract-info?symbol=${cleaningNseSymbol(String(p.symbol ?? "TCS"))}`,
        "https://www.nseindia.com/option-chain",
      );
      return payload.expiryDates;
    },
  },
  {
    name: "expiry_dates_option_index",
    module: "derivatives",
    description: "Option expiry dates for NIFTY, FINNIFTY and BANKNIFTY.",
    params: [],
    run: async () => {
      const out: Record<string, string[]> = {};
      for (const ind of OPTION_INDICES) {
        const payload = await fetchJson<{ expiryDates: string[] }>(
          `https://www.nseindia.com/api/option-chain-contract-info?symbol=${ind}`,
          "https://www.nseindia.com/option-chain",
        );
        out[ind] = payload.expiryDates;
      }
      return out;
    },
  },
  {
    name: "nse_live_option_chain",
    module: "derivatives",
    description: "Live option chain for a symbol, optionally for one expiry (dd-mm-yyyy).",
    params: [
      P.symbol,
      { name: "expiry_date", type: "string", description: "dd-mm-yyyy. Omit for all expiries" },
      { name: "oi_mode", type: "string", default: "full", options: ["full", "compact"], description: "full includes bid and ask" },
    ],
    run: async (p) => {
      const symbol = cleaningNseSymbol(String(p.symbol));
      const expiryFmt = p.expiry_date ? fmtDMonY(parseDmy(String(p.expiry_date), "expiry_date")) : null;
      const payload = await optionChainPayload(symbol, expiryFmt ?? "None");
      const rows = buildOptionChainRows(payload, expiryFmt, String(p.oi_mode ?? "full"));
      const timestamp = payload.records?.timestamp ?? null;
      return rows.map((r) => ({ ...r, Symbol: symbol, Fetch_Time: timestamp }));
    },
  },
  {
    name: "fno_security_in_ban_period",
    module: "derivatives",
    description: "Securities in the F&O ban period for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      const first = await nseFetch(`https://nsearchives.nseindia.com/archives/fo/sec_ban/fo_secban_${fmtDdmmyyyy(d)}.csv`);
      if (first.ok) return banSymbols(Buffer.from(await first.arrayBuffer()).toString("utf-8"));
      if (first.status !== 403) return [];
      const fallback =
        "https://www.nseindia.com/api/reports?archives=" +
        encodeURIComponent(JSON.stringify([{ name: "F&O - Security in ban period", type: "archives", category: "derivatives", section: "equity" }])) +
        `&date=${fmtDMonY(d)}&type=equity&mode=single`;
      const second = await nseFetch(fallback);
      if (second.ok) return banSymbols(Buffer.from(await second.arrayBuffer()).toString("utf-8"));
      if (second.status === 403) throw new NseError("Data not found, change the date", 404);
      return [];
    },
  },
  {
    name: "live_most_active_underlying",
    module: "derivatives",
    description: "Most active F&O underlyings in the live market.",
    params: [],
    run: async () => {
      const data = await fetchJson<{ data: Row[] }>(
        "https://www.nseindia.com/api/live-analysis-most-active-underlying",
        "https://www.nseindia.com/market-data/most-active-underlying",
      );
      return data.data;
    },
  },
  {
    name: "business_growth_fo_segment",
    module: "derivatives",
    description: "Business growth statistics for the F&O segment.",
    params: [
      { name: "data_type", type: "string", default: "yearly", options: ["yearly", "monthly", "daily"], description: "yearly, monthly or daily" },
      { name: "from_year", type: "string", description: "monthly: start financial year, e.g. 2025" },
      { name: "to_year", type: "string", description: "monthly: end financial year, e.g. 2026" },
      { name: "month", type: "string", description: "daily: month, e.g. Mar" },
      { name: "year", type: "string", description: "daily: year, e.g. 26 or 2026" },
    ],
    run: async (p) => {
      const type = String(p.data_type ?? "yearly");
      let path: string;
      if (type === "yearly") {
        path = "/api/historicalOR/fo/tbg/yearly";
      } else if (type === "monthly") {
        const [f, t] = normFinancialYear(p.from_year as string, p.to_year as string);
        path = `/api/historicalOR/fo/tbg/monthly?from=${f}&to=${t}`;
      } else {
        const [m, y] = normDailyArgs(p.month as string, p.year as string, "fo");
        path = `/api/historicalOR/fo/tbg/daily?month=${m}&year=${y}`;
      }
      return cleanBusinessGrowth(await fetchBusinessGrowth("fo", path), "fo");
    },
  },
];
