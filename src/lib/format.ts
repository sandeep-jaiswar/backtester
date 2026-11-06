export function fmtPct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "∞";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function fmtMoney(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

export function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "∞";
  return n.toFixed(digits);
}
