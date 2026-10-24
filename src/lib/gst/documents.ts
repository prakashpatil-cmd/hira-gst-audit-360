/**
 * Invoice / document number normalisation for matching across books, returns and portals.
 *  - exact:      trimmed, upper-case
 *  - normalised: separators removed and leading zeros removed from each numeric run
 *                ("INV/001/25-26" and "INV-1/25-26" both become "INV12526")
 *  - tail:       the final numeric run without leading zeros (used only for fuzzy candidate search)
 */
export function exactDocNo(v: unknown): string {
  return String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function normaliseDocNo(v: unknown): string {
  const s = exactDocNo(v).replace(/[^A-Z0-9]/g, "");
  return s.replace(/\d+/g, (run) => run.replace(/^0+(?=\d)/, ""));
}

export function docNoTail(v: unknown): string {
  const runs = exactDocNo(v).match(/\d+/g);
  if (!runs) return "";
  return runs[runs.length - 1].replace(/^0+(?=\d)/, "");
}

/** GST law limits invoice numbers to 16 characters (Rule 46(b)); flag anything longer. */
export function docNoIssues(v: unknown): string[] {
  const s = exactDocNo(v);
  const issues: string[] = [];
  if (!s) issues.push("Document number is blank");
  if (s.length > 16) issues.push("Document number exceeds 16 characters (Rule 46(b))");
  if (/[^A-Z0-9/\-]/.test(s)) issues.push("Document number contains characters other than letters, digits, '/' and '-'");
  return issues;
}

export type DocType = "INV" | "CRN" | "DBN" | "BOE" | "SELF" | "ADV" | "RV" | "DC" | "BOS";

export function normaliseDocType(v: unknown): DocType | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return null;
  if (/^(INV|INVOICE|TAX INVOICE|SALES|PURCHASE|B2B|B2C|EXP|R|REGULAR|SEZ|DE)/.test(s)) return "INV";
  if (/^(C|CR|CRN|CDN-C|CREDIT)/.test(s)) return "CRN";
  if (/^(D|DR|DBN|DN|DEBIT)/.test(s)) return "DBN";
  if (/^(BOE|BILL OF ENTRY|IMPG|IMPORT)/.test(s)) return "BOE";
  if (/^(SELF|RCM SELF)/.test(s)) return "SELF";
  if (/^(ADV|ADVANCE|RECEIPT)/.test(s)) return "ADV";
  if (/^(RV|REFUND)/.test(s)) return "RV";
  if (/^(DC|DELIVERY|CHALLAN|JOB)/.test(s)) return "DC";
  if (/^(BOS|BILL OF SUPPLY)/.test(s)) return "BOS";
  return null;
}

/** HSN 2/4/6/8 digits or SAC 99xxxx. */
export function validateHsn(v: unknown): { ok: boolean; code: string; isService: boolean; reason?: string } {
  const code = String(v ?? "").trim().replace(/\s|\./g, "");
  if (!code) return { ok: false, code, isService: false, reason: "HSN/SAC is blank" };
  if (!/^\d+$/.test(code)) return { ok: false, code, isService: false, reason: "HSN/SAC must be numeric" };
  if (![2, 4, 6, 8].includes(code.length)) return { ok: false, code, isService: code.startsWith("99"), reason: "HSN/SAC must have 2, 4, 6 or 8 digits" };
  return { ok: true, code, isService: code.startsWith("99") };
}
