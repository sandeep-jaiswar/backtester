export interface NumberRules {
  min?: number;
  max?: number;
  integer?: boolean;
  /** A blank field means "not set", so it is not a problem. */
  optional?: boolean;
}

/**
 * Why a typed number is not acceptable, or null when it is fine.
 * NaN is what a blank or non-numeric number input produces. It is never treated as zero.
 */
export function numberProblem(value: number, rules: NumberRules = {}): string | null {
  if (!Number.isFinite(value)) return rules.optional ? null : "Enter a number.";
  if (rules.integer && !Number.isInteger(value)) return "Enter a whole number.";
  if (rules.min !== undefined && value < rules.min) return `Must be at least ${rules.min}.`;
  if (rules.max !== undefined && value > rules.max) return `Must be at most ${rules.max}.`;
  return null;
}

/** True if any number anywhere in the value is blank or not finite. Used to block saving a half-filled form. */
export function hasBlankNumber(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasBlankNumber);
  if (value && typeof value === "object") return Object.values(value).some(hasBlankNumber);
  return false;
}
