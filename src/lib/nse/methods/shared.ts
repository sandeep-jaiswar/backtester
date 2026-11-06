import { unzipSync } from "fflate";
import * as XLSX from "xlsx";
import { NseError } from "../core/http";
import {
  CM_CHUNKS,
  FO_CHUNKS,
  addDays,
  chunkRanges,
  deriveFromAndToDate,
  fmtDmy,
  istToday,
  validateDateParams,
  parseDmy,
} from "../core/dates";
import { marketDayPredicate } from "../core/calendar";
import { type Row } from "../core/csv";

/** Validates the date args and resolves them to a concrete [from, to] range, as nselib does. */
export async function resolveRange(args: { from_date?: string; to_date?: string; period?: string }) {
  const fromDate = args.from_date;
  const toDate = args.to_date;
  const period = args.period;
  validateDateParams({ fromDate, toDate, period });
  const isMarketDay = period ? await marketDayPredicate() : () => true;
  return deriveFromAndToDate({ fromDate, toDate, period }, isMarketDay, istToday());
}

/**
 * Runs `fetchChunk` for each date window and concatenates the rows, mirroring the nselib loops.
 * `fetchChunk` gets dd-mm-yyyy strings, the same as nselib's URL builders.
 */
export async function chunkedRows(
  range: { from: Date; to: Date },
  kind: "cm" | "fo",
  fetchChunk: (start: string, end: string) => Promise<Row[]>,
): Promise<Row[]> {
  const chunks = chunkRanges(range.from, range.to, kind === "cm" ? CM_CHUNKS : FO_CHUNKS);
  const out: Row[] = [];
  for (const c of chunks) {
    out.push(...(await fetchChunk(fmtDmy(c.start), fmtDmy(c.end))));
  }
  return out;
}

/** Selects the given keys in order; missing keys become null (pandas `df[cols]` would raise, we are lenient). */
export function selectColumns(rows: Row[], columns: readonly string[]): Row[] {
  return rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
}

/** Renames keys positionally, as nselib does with `df.columns = [...]`. */
export function renamePositional(rows: Row[], names: readonly string[]): Row[] {
  return rows.map((r) => {
    const keys = Object.keys(r);
    return Object.fromEntries(names.map((name, i) => [name, r[keys[i]] ?? null]));
  });
}

export function removeTabs(rows: Row[]): Row[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/\t/g, ""), v])));
}

/** Unzips and returns the text of the last file, as nselib's loops do (each iteration overwrites `bhav_df`). */
export function unzipLastCsv(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf));
  const names = Object.keys(files);
  if (names.length === 0) throw new NseError("Archive is empty", 502);
  return Buffer.from(files[names[names.length - 1]]).toString("utf-8");
}

export function readXlsMatrix(buf: Buffer): unknown[][] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new NseError("Spreadsheet has no sheets", 502);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });
}

/** Converts an Excel date cell (serial number or text) to 'dd-Mon-yyyy', as pd.to_datetime().strftime does. */
export function excelCellToDmonY(v: unknown): string | null {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let d: Date | null = null;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    d = new Date(Date.UTC(1899, 11, 30) + v * 86_400_000);
  } else if (typeof v === "string" && v.trim()) {
    const parsed = new Date(v.trim());
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) return null;
  return `${String(d.getUTCDate()).padStart(2, "0")}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/,/g, "").trim());
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
}

export function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v).trim();
}

/** Mirrors `pd.read_excel` + `dropna` for the category turnover tables. Shared by CM and F&O. */
export function categoryTurnoverRows(raw: unknown[][], headerRowFinder: (r: number) => boolean, maxScan?: number): Row[] {
  const cell = (r: number, c: number) => (raw[r] ? raw[r][c] : undefined);
  const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
  const isBreak = (r: number) => {
    const first = cell(r, 0);
    const second = txt(cell(r, 1));
    const firstText = txt(first);
    return (
      first === null ||
      first === undefined ||
      firstText.toLowerCase().startsWith("note") ||
      firstText.toLowerCase() === "trade date" ||
      ["category", "client categories"].includes(second.toLowerCase())
    );
  };

  const blocks: Row[] = [];
  const limit = maxScan ?? raw.length;
  for (let r = 0; r < Math.min(raw.length, limit); ) {
    if (headerRowFinder(r)) {
      const headers = [0, 1, 2, 3].map((c) => txt(cell(r, c)));
      let end = r + 1;
      while (end < raw.length && !isBreak(end)) end++;
      for (let i = r + 1; i < end; i++) {
        const rec: Row = {};
        headers.forEach((h, c) => (rec[h] = (cell(i, c) as string | number | null) ?? null));
        blocks.push(rec);
      }
      r = end;
      continue;
    }
    r++;
  }

  // Normalise column names and build the output columns
  const out: Row[] = [];
  for (const b of blocks) {
    const category = txt(b["Category"] ?? b["Client Categories"]);
    if (!category) continue;
    const dateOut = excelCellToDmonY(b["Trade Date"]);
    if (!dateOut) continue;
    const buy = toNum(b["Buy Value in Rs.Crores"] ?? b["Buy Value in Rs."]);
    const sell = toNum(b["Sell Value in Rs.Crores"] ?? b["Sell Value in Rs."]);
    out.push({
      "Trade Date": dateOut,
      Category: category,
      "Buy Value in Rs.Crores": buy,
      "Sell Value in Rs.Crores": sell,
      "Net Value in Rs.Crores": buy !== null && sell !== null ? buy - sell : null,
    });
  }
  return out;
}

export { parseDmy, addDays, fmtDmy };
