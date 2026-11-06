import "server-only";
import YahooFinance from "yahoo-finance2";
import type { Bar } from "../backtest/types";
import { BAR_CACHE_TTL_MS } from "../backtest/config";

// Server-side only: Yahoo's endpoints need cookies/crumbs and CORS blocks browsers.
const yahooFinance = new YahooFinance();

export interface DailySeries {
  symbol: string;
  currency: string;
  bars: Bar[];
}

/**
 * Fetches daily bars at runtime from Yahoo Finance.
 *
 * Prices are adjusted for splits and dividends. Yahoo's `adjclose` includes dividends, so
 * each bar's OHLC is scaled by adjclose / close. This keeps the backtest's total-return
 * maths honest.
 */
export async function fetchDailyBars(
  symbol: string,
  start: string,
  end: string,
): Promise<DailySeries> {
  const result = await yahooFinance.chart(symbol, {
    period1: start,
    period2: end,
    interval: "1d",
    return: "array",
  });

  const bars: Bar[] = [];
  for (const q of result.quotes) {
    if (q.open == null || q.high == null || q.low == null || q.close == null) continue;
    const factor = q.adjclose != null && q.close > 0 ? q.adjclose / q.close : 1;
    bars.push({
      date: q.date,
      open: q.open * factor,
      high: q.high * factor,
      low: q.low * factor,
      close: q.close * factor,
      volume: q.volume ?? 0,
    });
  }

  if (bars.length < 2) {
    throw new DataError(`Not enough price data for ${symbol} between ${start} and ${end}.`);
  }

  return { symbol, currency: result.meta.currency, bars };
}

const CACHE_MAX_ENTRIES = 100;
const cache = new Map<string, { at: number; value: Promise<DailySeries> }>();

/**
 * `fetchDailyBars` with an in-memory cache keyed by (symbol, start, end). Successful fetches are
 * kept for `BAR_CACHE_TTL_MS`. Failures are dropped so the next request retries. The cache is
 * per server instance, which is enough for a single deployment.
 */
export function fetchDailyBarsCached(symbol: string, start: string, end: string): Promise<DailySeries> {
  const key = `${symbol}|${start}|${end}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < BAR_CACHE_TTL_MS) return hit.value;

  const value = fetchDailyBars(symbol, start, end);
  cache.delete(key);
  cache.set(key, { at: now, value });
  value.catch(() => cache.delete(key));

  // Map keeps insertion order, so the first key is the oldest entry.
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value;
}

export class DataError extends Error {}
