/**
 * Port of nselib/capital_market/capital_market_data.py and get_func.py.
 * Each export mirrors one nselib function: same URL, same origin header, same column handling.
 * Deviations from nselib are marked with "NOTE:".
 */
import { fetchFile, fetchJson, fetchText, NseError } from "../core/http";
import { parseCsv, type Row } from "../core/csv";
import {
  cleaningColumnName,
  cleaningNseSymbol,
  india_vix_data_column,
  index_data_columns,
  var_columns,
} from "../core/constants";
import {
  fmtDdmmyy,
  fmtDdmmyyyy,
  fmtDmy,
  fmtYyyymmdd,
  parseDmy,
} from "../core/dates";
import {
  categoryTurnoverRows,
  chunkedRows,
  readXlsMatrix,
  renamePositional,
  resolveRange,
  selectColumns,
  strOrNull,
  toNum,
  unzipLastCsv,
} from "./shared";
import { type MethodDef, P, type ParamDef } from "./types";
import { dailyVolatilityReport } from "./volatility";
import { cleanBusinessGrowth, fetchBusinessGrowth, normDailyArgs, normFinancialYear } from "./business-growth";

type DateArgs = Parameters<typeof resolveRange>[0];
const dateArgs = (p: Record<string, unknown>) => p as DateArgs;

const NSE = "https://www.nseindia.com";
const ARCHIVES = "https://archives.nseindia.com";
const NSEARCHIVES = "https://nsearchives.nseindia.com";
const STAGING_ORIGIN = "https://nsewebsite-staging.nseindia.com";
const PV_ORIGIN = "https://nsewebsite-staging.nseindia.com/report-detail/eq_security";
const DATE_PARAMS: ParamDef[] = [P.fromDate, P.toDate, P.period];
const TRADE_DATE: ParamDef[] = [P.tradeDate];

/** Python's `name.replace(' ', '')` on every header, i.e. remove all spaces. */
const stripAll = (rows: Row[]): Row[] => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/ /g, ""), v])));

/** Downloads a CSV and parses it the way pd.read_csv does. Missing file -> 404 error. */
async function csvFile(url: string, opts: { origin?: string; skipRows?: number; stripHeaders: boolean; notFound?: string }): Promise<Row[]> {
  const buf = await fetchFile(url, opts.origin, opts.notFound ?? "Data not found, change the trade_date");
  return parseCsv(buf.toString("utf-8"), { skipRows: opts.skipRows ?? 0, stripHeaderSpaces: opts.stripHeaders }).rows;
}

/** Raw CSV text for the security-wise history endpoint (nselib get_* helpers). */
async function securityHistory(symbol: string, from: string, to: string, type: string): Promise<Row[]> {
  const url =
    "https://www.nseindia.com/api/historicalOR/generateSecurityWiseHistoricalData?" +
    `from=${from}&to=${to}&symbol=${symbol}&type=${type}&series=ALL&csv=true`;
  let text = await fetchText(url, PV_ORIGIN);
  if (type === "priceVolumeDeliverable") text = text.replace(/\x82/g, "").replace(/â¹/g, "In Rs");
  return parseCsv(text, { stripHeaderSpaces: type === "priceVolumeDeliverable" || type === "deliverable" || type === "priceVolume" }).rows;
}

/** nselib get_bulk_deal_data / get_block_deals_data / get_short_selling_data. */
async function bulkBlockShort(optionType: "bulk_deals" | "block_deals" | "short_selling", from: string, to: string): Promise<Row[]> {
  const url = `${NSE}/api/historicalOR/bulk-block-short-deals?optionType=${optionType}&from=${from}&to=${to}&csv=true`;
  const buf = await fetchFile(url, STAGING_ORIGIN, `Resource not available for ${optionType}`);
  return stripAll(parseCsv(buf.toString("utf-8"), { stripHeaderSpaces: false }).rows);
}

/** nselib VaR files: C_VAR1_{ddmmyyyy}_{n}.DAT, skiprows=1, positional var_columns. */
async function varFile(tradeDate: string, n: number): Promise<Row[]> {
  const d = parseDmy(tradeDate, "trade_date");
  const rows = await csvFile(`${NSEARCHIVES}/archives/nsccl/var/C_VAR1_${fmtDdmmyyyy(d)}_${n}.DAT`, {
    skipRows: 1,
    stripHeaders: false,
  });
  return renamePositional(rows, var_columns);
}

/** nselib get_financial_results_master: corporates-financial-results endpoint. */
async function financialResultsMaster(args: DateArgs & { fo_sec?: boolean; fin_period?: string }) {
  const range = await resolveRange(args);
  const origin = "https://www.nseindia.com/companies-listing/corporate-filings-financial-results";
  const payload =
    `from_date=${fmtDmy(range.from)}&to_date=${fmtDmy(range.to)}` +
    (args.fo_sec ? "&fo_sec=true" : "") +
    `&period=${args.fin_period ?? "Quarterly"}`;
  const data = await fetchJson<Row[]>(`https://www.nseindia.com/api/corporates-financial-results?index=equities&${payload}`, origin);
  return stripAll(data);
}

/** Keys read from each XBRL filing, identical to nselib's keys_to_extract list (duplicate OtherExpenses dropped). */
const FINANCIAL_KEYS = [
  "ScripCode", "Symbol", "MSEISymbol", "NameOfTheCompany", "ClassOfSecurity",
  "DateOfStartOfFinancialYear", "DateOfEndOfFinancialYear",
  "DateOfBoardMeetingWhenFinancialResultsWereApproved",
  "DateOnWhichPriorIntimationOfTheMeetingForConsideringFinancialResultsWasInformedToTheExchange",
  "DescriptionOfPresentationCurrency", "LevelOfRoundingUsedInFinancialStatements",
  "ReportingQuarter", "StartTimeOfBoardMeeting", "EndTimeOfBoardMeeting",
  "DateOfStartOfBoardMeeting", "DateOfEndOfBoardMeeting",
  "DeclarationOfUnmodifiedOpinionOrStatementOnImpactOfAuditQualification",
  "IsCompanyReportingMultisegmentOrSingleSegment", "DescriptionOfSingleSegment",
  "DateOfStartOfReportingPeriod", "DateOfEndOfReportingPeriod",
  "WhetherResultsAreAuditedOrUnaudited", "NatureOfReportStandaloneConsolidated",
  "RevenueFromOperations", "OtherIncome", "Income", "CostOfMaterialsConsumed",
  "PurchasesOfStockInTrade", "ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade",
  "EmployeeBenefitExpense", "FinanceCosts", "DepreciationDepletionAndAmortisationExpense",
  "OtherExpenses", "Expenses", "ProfitBeforeExceptionalItemsAndTax", "ExceptionalItemsBeforeTax",
  "ProfitBeforeTax", "CurrentTax", "DeferredTax", "TaxExpense",
  "NetMovementInRegulatoryDeferralAccountBalancesRelatedToProfitOrLossAndTheRelatedDeferredTaxMovement",
  "ProfitLossForPeriodFromContinuingOperations", "ProfitLossFromDiscontinuedOperationsBeforeTax",
  "TaxExpenseOfDiscontinuedOperations", "ProfitLossFromDiscontinuedOperationsAfterTax",
  "ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod",
  "ProfitLossForPeriod", "OtherComprehensiveIncomeNetOfTaxes",
  "ComprehensiveIncomeForThePeriod", "ProfitOrLossAttributableToOwnersOfParent",
  "ProfitOrLossAttributableToNonControllingInterests",
  "ComprehensiveIncomeForThePeriodAttributableToOwnersOfParent",
  "ComprehensiveIncomeForThePeriodAttributableToOwnersOfParentNonControllingInterests",
  "PaidUpValueOfEquityShareCapital", "FaceValueOfEquityShareCapital",
  "BasicEarningsLossPerShareFromContinuingOperations",
  "DilutedEarningsLossPerShareFromContinuingOperations",
  "BasicEarningsLossPerShareFromDiscontinuedOperations",
  "DilutedEarningsLossPerShareFromDiscontinuedOperations",
  "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
  "DilutedEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
  "DescriptionOfOtherExpenses",
  "DescriptionOfItemThatWillNotBeReclassifiedToProfitAndLoss",
  "AmountOfItemThatWillNotBeReclassifiedToProfitAndLoss",
  "IncomeTaxRelatingToItemsThatWillNotBeReclassifiedToProfitOrLoss",
  "DescriptionOfItemThatWillBeReclassifiedToProfitAndLoss",
  "AmountOfItemThatWillBeReclassifiedToProfitAndLoss",
  "IncomeTaxRelatingToItemsThatWillBeReclassifiedToProfitOrLoss",
];

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * Equivalent of ElementTree `root.find(".//in-bse-fin:KEY")`: first element with that local name.
 * NOTE: matched by the literal `in-bse-fin:` prefix, not by namespace URI.
 */
export function xbrlValue(xml: string, key: string): string | null {
  const m = xml.match(new RegExp(`<in-bse-fin:${key}\\b[^>]*>([^<]*)</in-bse-fin:${key}\\s*>`));
  if (!m) return null;
  const v = decodeXml(m[1].trim());
  return v === "" ? null : v;
}

/** nselib financial_results_for_equity. NOTE: a failed XBRL file yields nulls plus an xbrl_error column; nselib aborts the whole call. */
async function financialResultsForEquity(args: DateArgs & { fo_sec?: boolean; fin_period?: string }): Promise<Row[]> {
  const master = await financialResultsMaster(args);
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.nseindia.com/",
  };
  const out: Row[] = new Array(master.length);
  let next = 0;
  const worker = async () => {
    while (next < master.length) {
      const i = next++;
      const link = strOrNull(master[i].xbrl);
      const row: Row = {};
      try {
        if (!link) throw new Error("no xbrl link");
        const res = await fetch(link, { headers, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`XBRL request failed (${res.status})`);
        const xml = await res.text();
        for (const key of FINANCIAL_KEYS) row[key] = xbrlValue(xml, key);
        row.xbrl_error = null;
      } catch (e) {
        for (const key of FINANCIAL_KEYS) row[key] = null;
        row.xbrl_error = (e as Error).message;
      }
      out[i] = row;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}

/** Corporate actions and event calendar share one shape. */
async function corporateFeed(
  args: DateArgs & { fno_only?: boolean },
  endpoint: string,
  origin: string,
): Promise<Row[]> {
  const range = await resolveRange(args);
  const base = `from_date=${fmtDmy(range.from)}&to_date=${fmtDmy(range.to)}`;
  const data = await fetchJson<Row[]>(
    `https://www.nseindia.com/api/${endpoint}?index=equities&${args.fno_only ? `${base}&fo_sec=true` : base}`,
    origin,
  );
  return stripAll(data);
}

/** nselib get_top_gainers_or_losers + top_gainers_or_losers. */
async function topGainersOrLosers(toGet: string): Promise<Row[]> {
  // NOTE: nselib validates 'loosers' (its spelling) and rejects 'losers'. This accepts both.
  const apiName = toGet === "losers" ? "loosers" : toGet;
  const data = await fetchJson<Record<string, unknown>>(
    `https://www.nseindia.com/api/live-analysis-variations?index=${apiName}`,
    "https://www.nseindia.com/market-data/top-gainers-losers",
  );
  const legends = (data.legends as Array<[string, string]>) ?? [];
  const out: Row[] = [];
  for (const [key] of legends) {
    const section = data[key] as { data?: Row[] } | undefined;
    for (const r of section?.data ?? []) out.push({ ...r, legend: key });
  }
  return out;
}

export const capitalMarketMethods: MethodDef[] = [
  {
    name: "price_volume_and_deliverable_position_data",
    module: "capital_market",
    description: "Security-wise price, volume and deliverable position history (daily).",
    params: [P.symbol, ...DATE_PARAMS],
    run: async (p) => {
      const args = dateArgs(p);
      const range = await resolveRange(args);
      const sym = cleaningNseSymbol(String(p.symbol));
      const rows = await chunkedRows(range, "cm", (s, e) => securityHistory(sym, s, e, "priceVolumeDeliverable"));
      // nselib converts these four columns with pd.to_numeric after removing commas
      return rows.map((r) => ({
        ...r,
        TotalTradedQuantity: toNum(r.TotalTradedQuantity),
        TurnoverInRs: toNum(r.TurnoverInRs),
        "No.ofTrades": toNum(r["No.ofTrades"]),
        DeliverableQty: toNum(r.DeliverableQty),
      }));
    },
  },
  {
    name: "price_volume_data",
    module: "capital_market",
    description: "Security-wise price and volume history (daily).",
    params: [P.symbol, ...DATE_PARAMS],
    run: async (p) => {
      const range = await resolveRange(dateArgs(p));
      const sym = cleaningNseSymbol(String(p.symbol));
      return chunkedRows(range, "cm", (s, e) => securityHistory(sym, s, e, "priceVolume"));
    },
  },
  {
    name: "deliverable_position_data",
    module: "capital_market",
    description: "Security-wise deliverable quantity history.",
    params: [P.symbol, ...DATE_PARAMS],
    run: async (p) => {
      const range = await resolveRange(dateArgs(p));
      const sym = cleaningNseSymbol(String(p.symbol));
      return chunkedRows(range, "cm", (s, e) => securityHistory(sym, s, e, "deliverable"));
    },
  },
  {
    name: "india_vix_data",
    module: "capital_market",
    description: "India VIX historical values.",
    params: DATE_PARAMS,
    run: async (p) => {
      const range = await resolveRange(dateArgs(p));
      const rows = await chunkedRows(range, "cm", async (s, e) => {
        const data = await fetchJson<{ data: Row[] }>(
          `https://www.nseindia.com/api/historicalOR/vixhistory?from=${s}&to=${e}&csv=true`,
          PV_ORIGIN,
        );
        return (data.data ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [cleaningColumnName(k), v])));
      });
      return selectColumns(rows, india_vix_data_column);
    },
  },
  {
    name: "index_data",
    module: "capital_market",
    description: "Historical index values, e.g. index='NIFTY 50'.",
    params: [{ name: "index", type: "string", required: true, description: "Index name as on NSE, e.g. NIFTY 50" }, ...DATE_PARAMS],
    run: async (p) => {
      const range = await resolveRange(dateArgs(p));
      const index = String(p.index).replace(/ /g, "%20").toUpperCase();
      return chunkedRows(range, "cm", async (s, e) => {
        const data = await fetchJson<{ data: Row[] }>(
          `https://www.nseindia.com/api/historicalOR/indicesHistory?indexType=${index}&from=${s}&to=${e}`,
          "https://www.nseindia.com/reports-indices-historical-index-data",
        );
        const recs = (data.data ?? []).map((r) => {
          const copy = { ...r };
          delete copy.HI_TIMESTAMP;
          return copy;
        });
        return renamePositional(recs, index_data_columns);
      });
    },
  },
  {
    name: "bulk_deal_data",
    module: "capital_market",
    description: "Bulk deals. Columns are the CSV's own headers, spaces removed.",
    params: DATE_PARAMS,
    run: async (p) => {
      const range = await resolveRange(dateArgs(p));
      return chunkedRows(range, "cm", (s, e) => bulkBlockShort("bulk_deals", s, e));
    },
  },
  {
    name: "block_deals_data",
    module: "capital_market",
    description: "Block deals. Columns are the CSV's own headers, spaces removed.",
    params: DATE_PARAMS,
    run: async (p) => {
      const range = await resolveRange(dateArgs(p));
      return chunkedRows(range, "cm", (s, e) => bulkBlockShort("block_deals", s, e));
    },
  },
  {
    name: "short_selling_data",
    module: "capital_market",
    description: "Short selling disclosures. Columns are the CSV's own headers, spaces removed.",
    params: DATE_PARAMS,
    run: async (p) => {
      const range = await resolveRange(dateArgs(p));
      return chunkedRows(range, "cm", (s, e) => bulkBlockShort("short_selling", s, e));
    },
  },
  {
    name: "bhav_copy_with_delivery",
    module: "capital_market",
    description: "Full bhavcopy with delivery for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      const rows = await csvFile(`${NSEARCHIVES}/products/content/sec_bhavdata_full_${fmtDdmmyyyy(d)}.csv`, { stripHeaders: true });
      return rows.map((r) => ({
        ...r,
        SERIES: typeof r.SERIES === "string" ? r.SERIES.replace(/ /g, "") : r.SERIES,
        DATE1: typeof r.DATE1 === "string" ? r.DATE1.replace(/ /g, "") : r.DATE1,
      }));
    },
  },
  {
    name: "bhav_copy_equities",
    module: "capital_market",
    description: "CM-UDiFF common bhavcopy (zip archive) for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      const buf = await fetchFile(
        `${NSEARCHIVES}/content/cm/BhavCopy_NSE_CM_0_0_0_${fmtYyyymmdd(d)}_F_0000.csv.zip`,
        undefined,
        "Data not found, change the trade_date",
      );
      return parseCsv(unzipLastCsv(buf), { stripHeaderSpaces: false }).rows;
    },
  },
  {
    name: "bhav_copy_indices",
    module: "capital_market",
    description: "Index closing values bhavcopy for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      return csvFile(`${NSEARCHIVES}/content/indices/ind_close_all_${fmtDdmmyyyy(d)}.csv`, {
        stripHeaders: false,
        notFound: "No data available for this date",
      });
    },
  },
  {
    name: "sme_bhav_copy",
    module: "capital_market",
    description: "SME bhavcopy for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      return csvFile(`${NSEARCHIVES}/archives/sme/bhavcopy/sme${fmtDdmmyy(d)}.csv`, { stripHeaders: true });
    },
  },
  {
    name: "equity_list",
    module: "capital_market",
    description: "All equities available to trade on NSE.",
    params: [],
    run: async () => {
      // nselib keeps the raw headers, so ' SERIES', ' DATE OF LISTING' and ' FACE VALUE' keep their leading space.
      const rows = await csvFile(`${ARCHIVES}/content/equities/EQUITY_L.csv`, {
        origin: STAGING_ORIGIN,
        stripHeaders: false,
        notFound: "No data equity list available",
      });
      return selectColumns(rows, ["SYMBOL", "NAME OF COMPANY", " SERIES", " DATE OF LISTING", " FACE VALUE"]);
    },
  },
  {
    name: "fno_equity_list",
    module: "capital_market",
    description: "Equity derivatives underlyings with lot sizes.",
    params: [],
    run: async () => {
      const data = await fetchJson<{ data: { UnderlyingList: Row[] } }>(
        "https://www.nseindia.com/api/underlying-information",
        "https://www.nseindia.com/products-services/equity-derivatives-list-underlyings-information",
      );
      return data.data.UnderlyingList;
    },
  },
  {
    name: "fno_index_list",
    module: "capital_market",
    description: "Index derivatives underlyings with lot sizes.",
    params: [],
    run: async () => {
      const data = await fetchJson<{ data: { IndexList: Row[] } }>(
        "https://www.nseindia.com/api/underlying-information",
        "https://www.nseindia.com/products-services/equity-derivatives-list-underlyings-information",
      );
      return data.data.IndexList;
    },
  },
  ...(["nifty50", "niftynext50", "niftymidcap150", "niftysmallcap250"] as const).map((key): MethodDef => {
    const file = `ind_${key}list.csv`;
    // nselib: nifty50 uses nsearchives, the others use archives. Headers are not cleaned.
    const host = key === "nifty50" ? NSEARCHIVES : ARCHIVES;
    const label = key === "nifty50" ? "NIFTY 50" : key === "niftynext50" ? "NIFTY NEXT 50" : key === "niftymidcap150" ? "NIFTY MIDCAP 150" : "NIFTY SMALLCAP 250";
    return {
      name: `${key}_equity_list`,
      module: "capital_market",
      description: `Constituents of ${label}.`,
      params: [],
      run: async () => csvFile(`${host}/content/indices/${file}`, { stripHeaders: false, notFound: "Resource not available" }),
    };
  }),
  {
    name: "market_watch_all_indices",
    module: "capital_market",
    description: "Live index values for all NSE indices.",
    params: [],
    run: async () => {
      const data = await fetchJson<{ data: Row[] }>("https://www.nseindia.com/api/allIndices", STAGING_ORIGIN);
      return selectColumns(data.data, [
        "key", "index", "indexSymbol", "last", "variation", "percentChange", "open", "high", "low", "previousClose",
        "yearHigh", "yearLow", "pe", "pb", "dy", "declines", "advances", "unchanged", "perChange365d", "perChange30d",
        "previousDay", "oneWeekAgoVal", "oneMonthAgoVal", "oneYearAgoVal",
      ]);
    },
  },
  {
    name: "fii_dii_trading_activity",
    module: "capital_market",
    description: "FII and DII trading activity for the latest session.",
    params: [],
    run: async () => fetchJson<Row[]>("https://www.nseindia.com/api/fiidiiTradeReact"),
  },
  {
    name: "daily_volatility",
    module: "capital_market",
    description: "Cash market daily volatility report for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const tradeDate = parseDmy(String(p.trade_date), "trade_date");
      return dailyVolatilityReport({
        tradeDate,
        filename: `CMVOLT_${fmtDdmmyyyy(tradeDate)}.CSV`,
        origin: "https://www.nseindia.com/all-reports",
        reportName: "CM - Daily Volatility",
        category: "capital-market",
      });
    },
  },
  {
    name: "category_turnover_cash",
    module: "capital_market",
    description: "Cash market turnover by investor category for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      const buf = await fetchFile(
        `${ARCHIVES}/archives/equities/cat/cat_turnover_${fmtDdmmyy(d)}.xls`,
        undefined,
        "No data available for this date",
      );
      const raw = readXlsMatrix(buf);
      const isHeader = (r: number) => {
        const a = String(raw[r]?.[0] ?? "").trim().toLowerCase();
        const b = String(raw[r]?.[1] ?? "").trim().toLowerCase();
        return a === "trade date" && (b === "category" || b === "client categories");
      };
      const rows = categoryTurnoverRows(raw, isHeader);
      if (rows.length === 0) throw new NseError("Category turnover cash data not found for this date", 404);
      return rows;
    },
  },
  ...(["begin_day", "1st_intra_day", "2nd_intra_day", "3rd_intra_day", "4th_intra_day", "end_of_day"] as const).map(
    (slot, i): MethodDef => ({
      name: `var_${slot}`,
      module: "capital_market",
      description: `VaR margin file, ${slot.replace(/_/g, " ")}.`,
      params: TRADE_DATE,
      run: async (p) => varFile(String(p.trade_date), i + 1),
    }),
  ),
  {
    name: "sme_band_complete",
    module: "capital_market",
    description: "SME price bands, complete list.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      return csvFile(`${NSEARCHIVES}/sme/content/price_band/archieves/sme_bands_complete_${fmtDdmmyyyy(d)}.csv`, { stripHeaders: true });
    },
  },
  {
    name: "week_52_high_low_report",
    module: "capital_market",
    description: "52-week high and low report.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      return csvFile(`${NSEARCHIVES}/content/CM_52_wk_High_low_${fmtDdmmyyyy(d)}.csv`, { skipRows: 2, stripHeaders: true });
    },
  },
  {
    name: "financial_results_for_equity",
    module: "capital_market",
    description: "Financial results for equities, parsed from each company's XBRL filing.",
    params: [
      ...DATE_PARAMS,
      P.fnoOnly,
      { name: "fin_period", type: "string", default: "Quarterly", options: ["Quarterly", "Half-Yearly", "Annual", "Others"], description: "Reporting period" },
    ],
    run: async (p) =>
      financialResultsForEquity({
        ...dateArgs(p),
        fo_sec: p.fno_only as boolean | undefined,
        fin_period: p.fin_period as string | undefined,
      }),
  },
  {
    name: "corporate_bond_trade_report",
    module: "capital_market",
    description: "Corporate bond trade report for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      return csvFile(`${NSEARCHIVES}/archives/equities/corpbond/corpbond${fmtDdmmyy(d)}.csv`, { stripHeaders: true });
    },
  },
  {
    name: "pe_ratio",
    module: "capital_market",
    description: "P/E ratio for all NSE equities for a trade date.",
    params: TRADE_DATE,
    run: async (p) => {
      const d = parseDmy(String(p.trade_date), "trade_date");
      return csvFile(`${NSEARCHIVES}/content/equities/peDetail/PE_${fmtDdmmyy(d)}.csv`, { stripHeaders: true });
    },
  },
  {
    name: "corporate_actions_for_equity",
    module: "capital_market",
    description: "Corporate actions (dividends, splits, bonuses, etc.) for equities.",
    params: [...DATE_PARAMS, P.fnoOnly],
    run: async (p) =>
      corporateFeed({ ...dateArgs(p), fno_only: p.fno_only as boolean | undefined }, "corporates-corporateactions", "https://www.nseindia.com/companies-listing/corporate-filings-actions"),
  },
  {
    name: "event_calendar_for_equity",
    module: "capital_market",
    description: "Upcoming corporate events for equities.",
    params: [...DATE_PARAMS, P.fnoOnly],
    run: async (p) =>
      corporateFeed({ ...dateArgs(p), fno_only: p.fno_only as boolean | undefined }, "event-calendar", "https://www.nseindia.com/companies-listing/corporate-filings-event-calendar"),
  },
  {
    name: "top_gainers_or_losers",
    module: "capital_market",
    description: "Top gainers or losers in the live market (last traded values after hours).",
    params: [{ name: "to_get", type: "string", default: "gainers", options: ["gainers", "losers"], description: "gainers or losers" }],
    run: async (p) => topGainersOrLosers(String(p.to_get)),
  },
  {
    name: "most_active_equities",
    module: "capital_market",
    description: "Most active equities by value or volume in the live market.",
    params: [{ name: "fetch_by", type: "string", default: "value", options: ["volume", "value"], description: "Rank by volume or value" }],
    run: async (p) => {
      const data = await fetchJson<{ data: Row[] }>(
        `https://www.nseindia.com/api/live-analysis-most-active-securities?index=${p.fetch_by}`,
        "https://www.nseindia.com/market-data/most-active-equities",
      );
      return data.data;
    },
  },
  {
    name: "total_traded_stocks",
    module: "capital_market",
    description: "Live count of traded stocks (summary) and the detail list.",
    params: [],
    run: async () => {
      const data = await fetchJson<{ total: { count: unknown; data: Row[] } }>(
        "https://www.nseindia.com/api/live-analysis-stocksTraded",
        "https://www.nseindia.com/market-data/stocks-traded",
      );
      return { summary: data.total.count, detail: data.total.data };
    },
  },
  {
    name: "business_growth_cm_segment",
    module: "capital_market",
    description: "Business growth statistics for the cash market segment.",
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
        path = "/api/historicalOR/cm/tbg/yearly";
      } else if (type === "monthly") {
        const [f, t] = normFinancialYear(p.from_year as string, p.to_year as string);
        path = `/api/historicalOR/cm/tbg/monthly?from=${f}&to=${t}`;
      } else {
        const [m, y] = normDailyArgs(p.month as string, p.year as string, "cm");
        path = `/api/historicalOR/cm/tbg/daily?month=${m}&year=${y}`;
      }
      return cleanBusinessGrowth(await fetchBusinessGrowth("cm", path), "cm");
    },
  },
];
