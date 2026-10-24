import { GST_STATES } from "./states";

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/;
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Computes the 15th (check) character of a GSTIN from its first 14 characters. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]);
    if (v < 0) throw new Error("Invalid GSTIN character");
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export type GstinCheck =
  | { valid: true; gstin: string; stateCode: string; pan: string }
  | { valid: false; gstin: string; reason: string };

/** Structural + checksum validation. Does not confirm the registration is active on the portal. */
export function validateGstin(input: unknown): GstinCheck {
  const gstin = String(input ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!gstin) return { valid: false, gstin, reason: "GSTIN is blank" };
  if (gstin.length !== 15) return { valid: false, gstin, reason: `GSTIN must have 15 characters (found ${gstin.length})` };
  if (!GSTIN_PATTERN.test(gstin)) return { valid: false, gstin, reason: "GSTIN format is invalid" };
  const stateCode = gstin.slice(0, 2);
  if (!GST_STATES[stateCode]) return { valid: false, gstin, reason: `Unknown state code ${stateCode}` };
  const pan = gstin.slice(2, 12);
  // Regular registrations embed a PAN; TDS/UIN/NRTP registrations use other identifiers (still checksum-valid).
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return { valid: false, gstin, reason: "GSTIN checksum digit is incorrect" };
  return { valid: true, gstin, stateCode, pan };
}

export function isValidGstin(input: unknown): boolean {
  return validateGstin(input).valid;
}

export function isValidPan(input: unknown): boolean {
  return PAN_PATTERN.test(String(input ?? "").trim().toUpperCase());
}

/** Creates a checksum-valid GSTIN — used for synthetic test and demonstration data only. */
export function makeGstin(stateCode: string, pan: string, entity = "1"): string {
  const first14 = `${stateCode}${pan}${entity}Z`;
  return first14 + gstinCheckChar(first14);
}
