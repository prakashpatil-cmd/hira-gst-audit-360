/**
 * Money is handled as integer paise in calculations (exact, deterministic) and as numeric(18,2)
 * strings at the database boundary. Never use floating-point rupees for audit arithmetic.
 */
export type Paise = number;

const MAX = Number.MAX_SAFE_INTEGER;

export function toPaise(v: unknown): Paise {
  if (v == null || v === "") return 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Invalid amount: ${v}`);
    return roundHalfUp(v * 100);
  }
  let s = String(v).trim();
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }          // accounting negatives (1,234.00)
  s = s.replace(/[₹,\s]|Rs\.?|INR/gi, "");
  if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1); }
  if (/\s*(Cr|Dr)$/i.test(s)) s = s.replace(/\s*(Cr|Dr)$/i, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") throw new Error(`Invalid amount: ${v}`);
  const [ip, fp = ""] = s.split(".");
  const frac = (fp + "000").slice(0, 3);
  let p = Number(ip || "0") * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) p += 1;                                    // half-up at the third decimal
  if (p > MAX) throw new Error("Amount out of range");
  return neg ? -p : p;
}

export function tryPaise(v: unknown): Paise | null {
  try { return toPaise(v); } catch { return null; }
}

/** Half-up rounding that is symmetric for negatives (−0.5 → −1). */
export function roundHalfUp(x: number): number {
  const r = Math.round(Math.abs(x) + 1e-9);
  return x < 0 ? -r : r;
}

/** "12345.60" — for numeric(18,2) columns. */
export function paiseToDecimal(p: Paise): string {
  const neg = p < 0;
  const a = Math.abs(p);
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** Indian digit grouping: 1,23,45,678 */
export function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

export interface FormatOpts { decimals?: 0 | 2; symbol?: boolean; bracketsForNegative?: boolean }

/** Formats paise as Indian currency, e.g. 8867690.00 → "88,67,690" (decimals 0) or "₹ 88,67,690.00". */
export function formatINR(p: Paise | null | undefined, opts: FormatOpts = {}): string {
  if (p == null) return "—";
  const { decimals = 2, symbol = false, bracketsForNegative = false } = opts;
  const neg = p < 0;
  let a = Math.abs(p);
  let body: string;
  if (decimals === 0) {
    a = roundHalfUp(a / 100);
    body = groupIndian(String(a));
  } else {
    body = `${groupIndian(String(Math.floor(a / 100)))}.${String(a % 100).padStart(2, "0")}`;
  }
  const s = `${symbol ? "₹ " : ""}${body}`;
  if (!neg) return s;
  return bracketsForNegative ? `(${s})` : `-${s}`;
}

/** Formats a numeric(18,2) string / number as INR. */
export function inr(v: unknown, opts: FormatOpts = {}): string {
  if (v == null || v === "") return "—";
  return formatINR(toPaise(v), opts);
}

export function sumPaise(values: Paise[]): Paise {
  let s = 0;
  for (const v of values) s += v;
  if (!Number.isSafeInteger(s)) throw new Error("Sum out of range");
  return s;
}

/** Tax on a value at a percentage rate, rounded half-up to the paisa. rate 18 = 18%. */
export function taxAtRate(value: Paise, ratePct: number): Paise {
  // Scale the rate to an integer (3 decimals) so the multiplication stays exact.
  const r = Math.round(ratePct * 1000);
  return roundHalfUp((value * r) / 100000);
}

/** Rate implied by tax/value, to 2 decimals, or null when value is zero. */
export function impliedRate(value: Paise, tax: Paise): number | null {
  if (value === 0) return null;
  return Math.round((tax / value) * 10000) / 100;
}

export const STANDARD_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40] as const;

/** Nearest standard GST rate when the implied rate is within tolerance, else null. */
export function nearestStandardRate(implied: number, tolerance = 0.15): number | null {
  let best: number | null = null;
  for (const r of STANDARD_RATES) {
    if (Math.abs(r - implied) <= tolerance && (best == null || Math.abs(r - implied) < Math.abs(best - implied))) best = r;
  }
  return best;
}
