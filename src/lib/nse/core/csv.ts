/**
 * Minimal CSV reader that matches the pandas `read_csv` behaviour nselib relies on:
 * - BOM stripped, CRLF or LF line endings, quoted fields with embedded commas and newlines
 * - `skiprows` (count of records before the header), blank lines dropped
 * - `on_bad_lines='skip'` drops rows whose field count does not match the header
 * - per-column numeric inference (a column becomes numbers only if every non-empty cell is numeric)
 */

export type Cell = string | number | null;
export type Row = Record<string, Cell>;

function parseRecords(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  // pandas skip_blank_lines=True
  return records.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

const NUMERIC = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

export function toNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "--") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export interface CsvOptions {
  skipRows?: number;
  skipBadLines?: boolean;
  /** Remove every space from header names, as nselib does with `name.replace(' ', '')`. */
  stripHeaderSpaces?: boolean;
  /** Drop the last record (nselib's `data_df.drop(tail(1))` fallback). */
  dropTrailingRow?: boolean;
}

export function parseCsv(text: string, opts: CsvOptions = {}): { columns: string[]; rows: Row[] } {
  let records = parseRecords(text);
  records = records.slice(opts.skipRows ?? 0);
  if (opts.dropTrailingRow && records.length > 0) records = records.slice(0, -1);
  if (records.length === 0) return { columns: [], rows: [] };

  // Headers are kept raw, as pandas does. Methods select exact names such as ' SERIES'.
  let columns = [...records[0]];
  if (opts.stripHeaderSpaces) columns = columns.map((c) => c.replace(/ /g, ""));
  const width = columns.length;

  let body = records.slice(1);
  if (opts.skipBadLines) body = body.filter((r) => r.length === width);

  const rawRows = body.map((r) => columns.map((_, i) => (r[i] ?? "").trim()));

  // Per-column numeric inference
  const numericCol = columns.map((_, i) => {
    const values = rawRows.map((r) => r[i]).filter((v) => v !== "");
    return values.length > 0 && values.every((v) => NUMERIC.test(v.replace(/,/g, "")));
  });

  const rows: Row[] = rawRows.map((r) => {
    const row: Row = {};
    columns.forEach((col, i) => {
      const v = r[i];
      if (v === "") row[col] = null;
      else if (numericCol[i]) row[col] = Number(v.replace(/,/g, ""));
      else row[col] = v;
    });
    return row;
  });

  return { columns, rows };
}
