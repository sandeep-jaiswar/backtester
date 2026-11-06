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

/** Today as YYYY-MM-DD in the user's local calendar. Call from event handlers, not render. */
export function todayIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
