// Checks for the nselib port: pure parsing, date windows, normalisers, XBRL and option-chain shaping,
// and the method registry. Network calls are not made here. Run with: npm run verify:nse
import assert from "node:assert/strict";
import { parseCsv } from "../src/lib/nse/core/csv";
import { chunkRanges, CM_CHUNKS, FO_CHUNKS, deriveFromAndToDate, fmtDmy, parseDmy } from "../src/lib/nse/core/dates";
import { cleanBusinessGrowth, normDailyArgs, normFinancialYear, parseLooseDate } from "../src/lib/nse/methods/business-growth";
import { xbrlValue } from "../src/lib/nse/methods/capital-market";
import { buildOptionChainRows } from "../src/lib/nse/methods/derivatives";
import { nseMethods, getNseMethod } from "../src/lib/nse/methods";
import { parseParams } from "../src/lib/nse/methods/types";
import { NseError } from "../src/lib/nse/core/http";
import { INDEX_CATEGORIES } from "../src/lib/nse/generated/index-config";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok  ${name}`);
};

check("parseCsv keeps raw headers unless asked to strip them", () => {
  const text = "SYMBOL, SERIES,DATE OF LISTING\nSBIN, EQ,2000-01-01\n";
  const raw = parseCsv(text, { stripHeaderSpaces: false }).columns;
  assert.deepEqual(raw, ["SYMBOL", " SERIES", "DATE OF LISTING"]);
  const stripped = parseCsv(text, { stripHeaderSpaces: true }).columns;
  assert.deepEqual(stripped, ["SYMBOL", "SERIES", "DATEOFLISTING"]);
});

check("parseCsv skipRows drops lines before the header (pd.read_csv skiprows)", () => {
  const text = "junk line\nSymbol,Close\nSBIN,600\n";
  const { rows } = parseCsv(text, { skipRows: 1, stripHeaderSpaces: false });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Symbol, "SBIN");
});

check("CM chunking: 365-day windows, first window ends 364 days after start", () => {
  const from = parseDmy("01-01-2019");
  const to = parseDmy("31-12-2021");
  const chunks = chunkRanges(from, to, CM_CHUNKS);
  assert.ok(chunks.length >= 3);
  assert.equal(fmtDmy(chunks[0].start), "01-01-2019");
  assert.equal(fmtDmy(chunks[0].end), "31-12-2019");
  assert.equal(fmtDmy(chunks[1].start), "01-01-2020");
});

check("FO chunking: 90-day window, 91-day step", () => {
  const chunks = chunkRanges(parseDmy("01-01-2024"), parseDmy("30-06-2024"), FO_CHUNKS);
  assert.equal(chunks.length, 2);
  assert.equal(fmtDmy(chunks[1].start), "01-04-2024");
});

check("period derivation steps back to a market day and ends today", () => {
  const today = parseDmy("06-11-2026");
  const range = deriveFromAndToDate({ period: "1W" }, () => true, today);
  assert.equal(fmtDmy(range.to), "06-11-2026");
  assert.equal(fmtDmy(range.from), "30-10-2026");
});

check("normDailyArgs: CM shortens 4-digit year, FO lengthens 2-digit year", () => {
  assert.deepEqual(normDailyArgs("Mar", "2026", "cm"), ["Mar", "26"]);
  assert.deepEqual(normDailyArgs("Mar", "26", "fo"), ["Mar", "2026"]);
  assert.deepEqual(normDailyArgs("March-26", undefined, "cm"), ["Mar", "26"]);
  assert.throws(() => normDailyArgs("Foo", "26", "cm"), NseError);
});

check("normFinancialYear accepts '2025-2026' shorthand", () => {
  assert.deepEqual(normFinancialYear("2025-2026", undefined), ["2025", "2026"]);
  assert.throws(() => normFinancialYear("2025", undefined), NseError);
});

check("cleanBusinessGrowth: null tokens and comma numbers, CM keeps type column", () => {
  const json = { data: [{ data: { type: "x", VALUE: "1,234.5", OTHER: "-", NAME: "a\r" } }] };
  const [row] = cleanBusinessGrowth(json, "cm");
  assert.equal(row.VALUE, 1234.5);
  assert.equal(row.OTHER, null);
  assert.equal(row.type, "x");
  assert.equal(row.NAME, "a");
});

check("parseLooseDate handles dd-Mon-yyyy and ISO", () => {
  assert.equal(parseLooseDate("01-Mar-2025"), "2025-03-01");
  assert.equal(parseLooseDate("2025-03-01T00:00:00"), "2025-03-01");
  assert.equal(parseLooseDate("not a date"), null);
});

check("xbrlValue reads the first in-bse-fin element and decodes entities", () => {
  const xml = `<xbrl><in-bse-fin:NameOfTheCompany>A &amp; B Ltd</in-bse-fin:NameOfTheCompany>
    <in-bse-fin:Income>10</in-bse-fin:Income><in-bse-fin:Income>99</in-bse-fin:Income>
    <in-bse-fin:TaxExpense></in-bse-fin:TaxExpense></xbrl>`;
  assert.equal(xbrlValue(xml, "NameOfTheCompany"), "A & B Ltd");
  assert.equal(xbrlValue(xml, "Income"), "10");
  assert.equal(xbrlValue(xml, "TaxExpense"), null);
  assert.equal(xbrlValue(xml, "Missing"), null);
});

check("option chain: expiry filter, zero defaults for missing sides, compact mode drops bid/ask", () => {
  const payload = {
    records: {
      timestamp: "ts",
      data: [
        { expiryDates: "30-Jun-2026", strikePrice: 100, CE: { openInterest: 5, lastPrice: 2, buyQuantity1: 7 } },
        { expiryDates: "28-Jul-2026", strikePrice: 100, CE: { openInterest: 9 } },
        { expiryDates: "30-Jun-2026", strikePrice: 110, PE: { openInterest: 3 } },
      ],
    },
  };
  const rows = buildOptionChainRows(payload, "30-Jun-2026", "full");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].CALLS_OI, 5);
  assert.equal(rows[0].CALLS_Bid_Qty, 7);
  assert.equal(rows[0].PUTS_OI, 0);
  assert.equal(rows[1].CALLS_OI, 0);
  assert.equal(rows[1].PUTS_OI, 3);
  const compact = buildOptionChainRows(payload, null, "compact");
  assert.equal(compact.length, 3);
  assert.equal(compact[0].CALLS_Bid_Qty, 0);
});

check("parseParams: required, options and boolean validation", () => {
  const def = getNseMethod("bhav_copy_equities")!;
  assert.throws(() => parseParams(def, new URLSearchParams()), NseError);
  const fii = getNseMethod("future_price_volume_data")!;
  assert.throws(() => parseParams(fii, new URLSearchParams("symbol=SBIN&instrument=BAD")), NseError);
  const topMove = getNseMethod("top_gainers_or_losers")!;
  assert.deepEqual(parseParams(topMove, new URLSearchParams()), { to_get: "gainers" });
  assert.throws(() => parseParams(topMove, new URLSearchParams("to_get=sideways")), NseError);
});

check("registry: unique names, every method has a run function, index categories exist", () => {
  const names = nseMethods.map((m) => m.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(nseMethods.every((m) => typeof m.run === "function"));
  assert.deepEqual(Object.keys(INDEX_CATEGORIES).sort(), ["BroadMarketIndices", "SectoralIndices", "StrategyIndices", "ThematicIndices"]);
});

console.log(`\n${passed} NSE checks passed`);
