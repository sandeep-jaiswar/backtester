import { fetchJson, NseError } from "../core/http";
import type { Cell, Row } from "../core/csv";

/** Port of nselib's business_growth_cm_segment and business_growth_fo_segment helpers. */
export type GrowthSegment = "cm" | "fo";

const NULL_TOKENS = new Set(["", "-", "--", "None", "nan", "NaN"]);
const CM_PRESERVE = new Set(["type", "TYPE", "GLY_MONTH_YEAR", "GLM_MONTH_YEAR", "F_TIMESTAMP"]);
const FO_PRESERVE = new Set(["type", "TYPE", "date"]);
/** Only these two `_ORDER` columns are converted to dates in the CM frame. */
const CM_DATE_ORDER = new Set(["GTM_MONTH_YEAR_ORDER", "CDT_DATE_ORDER"]);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export async function fetchBusinessGrowth(segment: GrowthSegment, path: string): Promise<Record<string, unknown>> {
  return fetchJson<Record<string, unknown>>(
    `https://www.nseindia.com${path}`,
    `https://www.nseindia.com/market-data/business-growth-${segment}-segment`,
  );
}

/** Accepts ISO dates and 'dd-Mon-yyyy', as pd.to_datetime(errors='coerce') would. Returns yyyy-mm-dd or null. */
export function parseLooseDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  // ISO timestamps: keep the calendar date as written, without a timezone shift.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/** nselib _normalize_business_growth_*_financial_year */
export function normFinancialYear(fromYear?: string, toYear?: string): [string, string] {
  let f = fromYear;
  let t = toYear;
  if (!t && f && f.includes("-")) [f, t] = f.split("-", 2).map((x) => x.trim());
  if (!f || !t) throw new NseError("For monthly data provide from_year and to_year, e.g. from_year=2025&to_year=2026", 400);
  return [f.trim(), t.trim()];
}

/**
 * nselib _normalize_business_growth_*_daily_args.
 * The two segments differ on purpose: CM shortens a 4-digit year to 2 digits, FO lengthens a 2-digit year to 4.
 */
export function normDailyArgs(month: string | undefined, year: string | undefined, segment: GrowthSegment): [string, string] {
  let m = month;
  let y = year;
  if (!y && m && m.includes("-")) [m, y] = m.split("-", 2).map((x) => x.trim());
  if (!m || !y) throw new NseError("For daily data provide month and year, e.g. month=Mar&year=26", 400);

  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const idx = names.findIndex((n) => n.toLowerCase() === m!.trim().slice(0, 3).toLowerCase());
  if (idx < 0) throw new NseError("month should be a valid month name like Mar or March", 400);

  y = y.trim();
  if (segment === "cm" && y.length === 4 && /^\d+$/.test(y)) y = y.slice(-2);
  if (segment === "fo" && y.length === 2 && /^\d+$/.test(y)) y = `20${y}`;
  return [names[idx], y];
}

/** nselib _business_growth_*_dataframe: records, \r removed, numbers converted where every value parses. */
export function cleanBusinessGrowth(json: Record<string, unknown>, segment: GrowthSegment): Row[] {
  const data = (json.data as Array<Record<string, unknown>> | undefined) ?? [];
  const records = data.map((r) => (r && typeof r === "object" && "data" in r ? (r.data as Record<string, unknown>) : r));
  const preserve = segment === "cm" ? CM_PRESERVE : FO_PRESERVE;

  const rows: Row[] = records.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, (typeof v === "string" ? v.replace(/\r/g, "") : v) as Cell]),
    ),
  );

  const columns = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => columns.add(k)));

  for (const col of columns) {
    if (segment === "cm" && col.endsWith("_ORDER")) {
      if (CM_DATE_ORDER.has(col)) rows.forEach((r) => (r[col] = typeof r[col] === "string" ? parseLooseDate(r[col] as string) : null));
      continue;
    }
    if (preserve.has(col)) continue;

    const cleaned = rows.map((r) => {
      const v = r[col];
      if (v === null || v === undefined) return null;
      const s = String(v).replace(/,/g, "").trim();
      return NULL_TOKENS.has(s) ? null : s;
    });
    const nonNull = cleaned.filter((v): v is string => v !== null);
    const allNumeric = nonNull.every((v) => !Number.isNaN(Number(v)));
    rows.forEach((r, i) => {
      const v = cleaned[i];
      r[col] = v === null ? null : allNumeric ? Number(v) : v;
    });
  }
  return rows;
}
