import { fetchJson, NseError } from "./http";
import { parseDMonY, utcDate } from "./dates";

/**
 * Market-day calendar from NSE's holiday master. Replaces nselib's pandas_market_calendars NSE calendar.
 * Cached in memory for 12 hours (warm serverless instances reuse it).
 */

const TTL_MS = 12 * 60 * 60 * 1000;
let cache: { at: number; holidays: Set<string>; raw: Record<string, unknown> } | null = null;

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function fetchHolidayMaster(): Promise<Record<string, unknown>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.raw;
  let raw: Record<string, unknown>;
  try {
    raw = await fetchJson<Record<string, unknown>>("https://www.nseindia.com/api/holiday-master?type=trading");
  } catch {
    throw new NseError("Calendar data not found, try again later", 502);
  }
  const holidays = new Set<string>();
  for (const item of (raw.CM as Array<{ tradingDate?: string }>) ?? []) {
    if (item.tradingDate) holidays.add(iso(parseDMonY(item.tradingDate)));
  }
  cache = { at: Date.now(), holidays, raw };
  return raw;
}

/** Returns a predicate: weekday, not in the CM holiday list. */
export async function marketDayPredicate(): Promise<(d: Date) => boolean> {
  await fetchHolidayMaster();
  const holidays = cache!.holidays;
  return (d: Date) => {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    return !holidays.has(iso(utcDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())));
  };
}
