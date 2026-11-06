import { nseFetch, NseError } from "../core/http";
import { parseCsv, type Row } from "../core/csv";
import { fmtDMonY } from "../core/dates";

/**
 * Port of the nselib daily_volatility functions (capital market and derivatives).
 * Tries three URLs in order. Each request runs through the NSE cookie handshake for `origin`,
 * as nselib does with a fresh session per URL.
 */
export async function dailyVolatilityReport(opts: {
  tradeDate: Date;
  filename: string;
  origin: string;
  reportName: string;
  category: "capital-market" | "derivatives";
}): Promise<Row[]> {
  // Python: urllib-style encoding of the JSON filter, identical to nselib's hand-written string.
  const archiveFilter = encodeURIComponent(
    JSON.stringify([{ name: opts.reportName, type: "archives", category: opts.category, section: "equity" }]),
  );
  const urls = [
    `https://nsearchives.nseindia.com/archives/nsccl/volt/${opts.filename}`,
    `https://archives.nseindia.com/archives/nsccl/volt/${opts.filename}`,
    `https://www.nseindia.com/api/reports?archives=${archiveFilter}&date=${fmtDMonY(opts.tradeDate)}&type=equity&mode=single`,
  ];

  let lastStatus = 0;
  for (const url of urls) {
    const res = await nseFetch(url, opts.origin);
    lastStatus = res.status;
    if (!res.ok) continue;

    const text = Buffer.from(await res.arrayBuffer()).toString("utf-8");
    // pd.read_csv(skipinitialspace=True), dropna(how='all'), then strip column names
    return parseCsv(text, { stripHeaderSpaces: false })
      .rows.filter((r) => Object.values(r).some((v) => v !== null && v !== ""))
      .map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [k.trim(), typeof v === "string" ? v.trim() : v]),
        ),
      );
  }
  throw new NseError(`No daily volatility data available for ${fmtDMonY(opts.tradeDate)} (status ${lastStatus})`, 404);
}
