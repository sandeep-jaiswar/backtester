import { NseError } from "./http";

/**
 * Date helpers ported from nselib/libutil.py and nselib/constants.py.
 *
 * All dates are UTC-midnight `Date` objects that represent a calendar day. NSE works in IST, so
 * "today" is computed in Asia/Kolkata rather than the server's timezone.
 */

export const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const EQUITY_PERIODS = ["1D", "1W", "1M", "3M", "6M", "1Y"] as const;

export function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

/** Today's calendar date in India. */
export function istToday(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return utcDate(get("year"), get("month"), get("day"));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/** Port of libutil.subtract_months: clamps the day to the target month's length. */
export function subtractMonths(d: Date, months: number): Date {
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() + 1 - months;
  while (month <= 0) {
    month += 12;
    year -= 1;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return utcDate(year, month, Math.min(d.getUTCDate(), lastDay));
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** nselib `dd_mm_yyyy` = '%d-%m-%Y' */
export function fmtDmy(d: Date): string {
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/** nselib `ddmmyyyy` = '%d%m%Y' */
export function fmtDdmmyyyy(d: Date): string {
  return `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`;
}

/** nselib `ddmmyy` = '%d%m%y' */
export function fmtDdmmyy(d: Date): string {
  return `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCFullYear() % 100)}`;
}

/** Python '%Y%m%d' */
export function fmtYyyymmdd(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** Python '%d-%b-%Y', e.g. 03-Jun-2025 */
export function fmtDMonY(d: Date): string {
  return `${pad(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/** Python '%b' */
export function fmtMon(d: Date): string {
  return MONTHS[d.getUTCMonth()];
}

const DMY = /^(\d{2})-(\d{2})-(\d{4})$/;
const DMONY = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/;

function validDate(y: number, m: number, d: number): Date {
  const dt = utcDate(y, m, d);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) {
    throw new NseError(`Invalid calendar date ${y}-${m}-${d}`, 400);
  }
  return dt;
}

/** Parses 'dd-mm-yyyy' (nselib input format). */
export function parseDmy(s: string, field = "date"): Date {
  const m = DMY.exec(s ?? "");
  if (!m) throw new NseError(`${field} '${s}' must be in dd-mm-yyyy format`, 400);
  return validDate(Number(m[3]), Number(m[2]), Number(m[1]));
}

/** Parses 'dd-Mon-yyyy' as used by NSE holiday and FII endpoints. */
export function parseDMonY(s: string): Date {
  const m = DMONY.exec(s ?? "");
  if (!m) throw new NseError(`'${s}' is not a dd-Mon-yyyy date`, 500);
  const month = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()) + 1;
  if (month === 0) throw new NseError(`'${s}' has an unknown month`, 500);
  return validDate(Number(m[3]), month, Number(m[1]));
}

/** Port of libutil.validate_date_param. */
export function validateDateParams(args: { fromDate?: string; toDate?: string; period?: string }): void {
  const { fromDate, toDate, period } = args;
  if (!period && (!fromDate || !toDate)) {
    throw new NseError("Provide either period, or both from_date and to_date", 400);
  }
  if (period && !(EQUITY_PERIODS as readonly string[]).includes(period.toUpperCase())) {
    throw new NseError(`period '${period}' is not valid. Use one of ${EQUITY_PERIODS.join(", ")}`, 400);
  }
  if (!period) {
    const from = parseDmy(fromDate!, "from_date");
    const to = parseDmy(toDate!, "to_date");
    if (daysBetween(from, to) < 1) throw new NseError("to_date must be after from_date", 400);
  }
}

/**
 * Port of libutil.derive_from_and_to_date.
 *
 * nselib steps the start date back to the last market day with pandas_market_calendars. Here the
 * market days come from NSE's own holiday master (passed in as `isMarketDay`).
 *
 * Fix vs nselib: nselib's `np.select` has no 3M branch, so '3M' silently falls through to 1D.
 * This port applies a real 3-month lookback.
 */
export function deriveFromAndToDate(
  args: { fromDate?: string; toDate?: string; period?: string },
  isMarketDay: (d: Date) => boolean,
  today: Date = istToday(),
): { from: Date; to: Date } {
  if (!args.period) {
    return { from: parseDmy(args.fromDate!, "from_date"), to: parseDmy(args.toDate!, "to_date") };
  }

  const p = args.period.toUpperCase();
  let start: Date;
  switch (p) {
    case "1W":
      start = addDays(today, -7);
      break;
    case "1M":
      start = subtractMonths(today, 1);
      break;
    case "3M":
      start = subtractMonths(today, 3);
      break;
    case "6M":
      start = subtractMonths(today, 6);
      break;
    case "1Y":
      start = subtractMonths(today, 12);
      break;
    default:
      start = addDays(today, -1);
  }

  // Step back to the most recent market day, as nselib does.
  let f = start;
  for (let guard = 0; guard < 30 && !isMarketDay(f); guard++) f = addDays(f, -1);
  return { from: f, to: today };
}

/**
 * Port of the chunking loops in nselib (e.g. capital_market_data.price_volume_data).
 *
 * Each window covers `endOffset` days after its start, then the start moves forward by `step` days.
 * nselib uses (threshold 365, endOffset 364, step 365) for most endpoints and (90, 90, 91) for F&O
 * price-volume. The loop only runs while from < to, as in nselib.
 */
export function chunkRanges(
  from: Date,
  to: Date,
  opts: { threshold: number; endOffset: number; step: number },
): Array<{ start: Date; end: Date }> {
  const out: Array<{ start: Date; end: Date }> = [];
  let cursor = from;
  let loadDays = daysBetween(cursor, to);
  while (loadDays > 0) {
    const end = loadDays > opts.threshold ? addDays(cursor, opts.endOffset) : to;
    out.push({ start: cursor, end });
    cursor = addDays(cursor, opts.step);
    loadDays = daysBetween(cursor, to);
  }
  return out;
}

export const CM_CHUNKS = { threshold: 365, endOffset: 364, step: 365 };
export const FO_CHUNKS = { threshold: 90, endOffset: 90, step: 91 };
