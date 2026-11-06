import { NseError } from "../core/http";

export type ParamType = "string" | "number" | "boolean";

export interface ParamDef {
  name: string;
  type: ParamType;
  required?: boolean;
  default?: string | number | boolean;
  options?: readonly string[];
  description: string;
}

export interface MethodDef {
  /** Same name as the nselib Python function. */
  name: string;
  /** nselib module it comes from. */
  module: "capital_market" | "indices" | "derivatives" | "debt" | "utilities";
  description: string;
  params: ParamDef[];
  run: (p: Record<string, unknown>) => Promise<unknown>;
}

/** Parses URL query params against a method's spec. Throws NseError(400) on bad input. */
export function parseParams(def: MethodDef, search: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of def.params) {
    const raw = search.get(spec.name);
    if (raw === null || raw === "") {
      if (spec.required) throw new NseError(`Missing required parameter '${spec.name}'`, 400);
      if (spec.default !== undefined) out[spec.name] = spec.default;
      continue;
    }

    let value: string | number | boolean;
    if (spec.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new NseError(`'${spec.name}' must be a number`, 400);
      value = n;
    } else if (spec.type === "boolean") {
      if (!["true", "false", "1", "0"].includes(raw.toLowerCase())) {
        throw new NseError(`'${spec.name}' must be true or false`, 400);
      }
      value = ["true", "1"].includes(raw.toLowerCase());
    } else {
      value = raw;
    }

    if (spec.options && !spec.options.includes(String(value))) {
      throw new NseError(`'${spec.name}' must be one of: ${spec.options.join(", ")}`, 400);
    }
    out[spec.name] = value;
  }
  return out;
}

/** Shared parameter specs, named exactly as in nselib. */
export const P = {
  symbol: { name: "symbol", type: "string", required: true, description: "Equity symbol, e.g. SBIN" } as ParamDef,
  fromDate: { name: "from_date", type: "string", description: "dd-mm-yyyy. Use with to_date, or use period" } as ParamDef,
  toDate: { name: "to_date", type: "string", description: "dd-mm-yyyy. Must be after from_date" } as ParamDef,
  period: {
    name: "period",
    type: "string",
    options: ["1D", "1W", "1M", "3M", "6M", "1Y"],
    description: "Shortcut instead of from_date/to_date. Looks back from today (IST)",
  } as ParamDef,
  tradeDate: { name: "trade_date", type: "string", required: true, description: "dd-mm-yyyy" } as ParamDef,
  fnoOnly: { name: "fno_only", type: "boolean", default: false, description: "Only F&O securities" } as ParamDef,
};
