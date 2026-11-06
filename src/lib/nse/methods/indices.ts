/** Port of nselib/indices/index_data.py. Index lists come from the generated nse_config port. */
import { fetchFile, fetchJson, NseError } from "../core/http";
import { parseCsv } from "../core/csv";
import { INDEX_CATEGORIES } from "../generated/index-config";
import { type MethodDef, type ParamDef } from "./types";

const CATEGORY_NAMES = Object.keys(INDEX_CATEGORIES) as Array<keyof typeof INDEX_CATEGORIES>;

/** nselib get_class + validate_index_category. */
function categoryOf(indexCategory: string) {
  if (!(CATEGORY_NAMES as string[]).includes(indexCategory)) {
    throw new NseError(`'${indexCategory}': is an invalid Index Category. Valid: ${CATEGORY_NAMES.join(", ")}`, 400);
  }
  return INDEX_CATEGORIES[indexCategory as keyof typeof INDEX_CATEGORIES];
}

/** nselib validate_index_name: the name must match the category list exactly, e.g. "Nifty 50". */
function validateName(indexCategory: string, indexName: string) {
  const category = categoryOf(indexCategory);
  if (!(category.indicesList as readonly string[]).includes(indexName)) {
    throw new NseError(`'${indexName}' is invalid index_name.`, 400);
  }
  return category;
}

const CATEGORY_PARAM: ParamDef = {
  name: "index_category",
  type: "string",
  default: "BroadMarketIndices",
  options: CATEGORY_NAMES as string[],
  description: "Index category",
};
const INDEX_NAME_PARAM: ParamDef = {
  name: "index_name",
  type: "string",
  default: "Nifty 50",
  description: "Index name as on NSE, e.g. Nifty 50 or Nifty IT",
};

export const indicesMethods: MethodDef[] = [
  {
    name: "index_list",
    module: "indices",
    description: "Index names in a category (SectoralIndices, BroadMarketIndices, ThematicIndices, StrategyIndices).",
    params: [CATEGORY_PARAM],
    run: async (p) => [...categoryOf(String(p.index_category ?? "BroadMarketIndices")).indicesList],
  },
  {
    name: "validate_index_category",
    module: "indices",
    description: "Checks that an index category name is valid. Returns true or a 400 error.",
    params: [CATEGORY_PARAM],
    run: async (p) => {
      categoryOf(String(p.index_category ?? "BroadMarketIndices"));
      return true;
    },
  },
  {
    name: "validate_index_name",
    module: "indices",
    description: "Checks that an index name belongs to a category. Returns true or a 400 error.",
    params: [CATEGORY_PARAM, INDEX_NAME_PARAM],
    run: async (p) => {
      validateName(String(p.index_category ?? "BroadMarketIndices"), String(p.index_name ?? "Nifty 50"));
      return true;
    },
  },
  {
    name: "constituent_stock_list",
    module: "indices",
    description: "Constituent stocks of an index, from the niftyindices.com constituent CSV.",
    params: [CATEGORY_PARAM, INDEX_NAME_PARAM],
    run: async (p) => {
      const indexName = String(p.index_name ?? "Nifty 50");
      const category = validateName(String(p.index_category ?? "BroadMarketIndices"), indexName);
      const url = (category.constituentUrls as Record<string, string>)[indexName];
      if (!url) throw new NseError(`'${indexName}': No Data found for index`, 404);
      const buf = await fetchFile(url, undefined, `'${indexName}': No Data found for index, Kindly check the index category & name`);
      // nselib: pd.read_csv with default headers, nothing cleaned
      return parseCsv(buf.toString("utf-8"), { stripHeaderSpaces: false }).rows;
    },
  },
  {
    name: "live_index_performances",
    module: "indices",
    description: "Live performance of all NSE indices (chart paths removed).",
    params: [],
    run: async () => {
      const data = await fetchJson<{ data: Array<Record<string, unknown>> }>(
        "https://www.nseindia.com/api/allIndices",
        "https://www.nseindia.com/market-data/index-performances",
      );
      return data.data.map((r) => {
        const copy = { ...r };
        delete copy.chartTodayPath;
        delete copy.chart30dPath;
        delete copy.chart365dPath;
        return copy;
      });
    },
  },
];
