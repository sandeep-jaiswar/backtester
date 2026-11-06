import { capitalMarketMethods } from "./capital-market";
import { derivativesMethods } from "./derivatives";
import { indicesMethods } from "./indices";
import { debtMethods } from "./debt";
import { utilityMethods } from "./utilities";
import type { MethodDef } from "./types";

/** Every ported nselib function, keyed by its nselib name. */
export const nseMethods: MethodDef[] = [
  ...capitalMarketMethods,
  ...indicesMethods,
  ...derivativesMethods,
  ...debtMethods,
  ...utilityMethods,
];

const byName = new Map(nseMethods.map((m) => [m.name, m]));
if (byName.size !== nseMethods.length) {
  throw new Error("Duplicate NSE method name in registry");
}

export function getNseMethod(name: string): MethodDef | undefined {
  return byName.get(name);
}
