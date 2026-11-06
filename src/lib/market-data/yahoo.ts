import "server-only";
import YahooFinance from "yahoo-finance2";
import type { Bar } from "../backtest/types";

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

export class DataError extends Error {}
