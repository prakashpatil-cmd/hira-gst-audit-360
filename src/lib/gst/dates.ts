/** Date helpers. Internal format: ISO "YYYY-MM-DD" strings (no time zones). Display: DD/MM/YYYY. */
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Excel serial date (1900 system) → ISO. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

export type DateOrder = "DMY" | "MDY" | "YMD";

/**
 * Parses dates as they appear in Tally/SAP/portal exports. Ambiguous numeric dates are read as
 * DD/MM/YYYY (Indian convention) unless order "MDY" is requested. Returns null when invalid —
 * including impossible dates such as 31/06/2026.
 */
export function parseDate(v: unknown, order: DateOrder = "DMY"): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // ExcelJS gives UTC-midnight dates; shift by 12h to avoid off-by-one around midnight
    const d = new Date(v.getTime() + 12 * 3600 * 1000);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (typeof v === "number") return excelSerialToIso(v);
  const s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return check(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/);
  if (m) {
    const y = expandYear(+m[3]);
    return order === "MDY" ? check(y, +m[1], +m[2]) : check(y, +m[2], +m[1]);
  }
  m = s.match(/^(\d{1,2})[-/.\s]([A-Za-z]{3,9})[-/.\s,]*(\d{2}|\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return check(expandYear(+m[3]), MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return check(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return null;
}

function expandYear(y: number) { return y < 100 ? 2000 + y : y; }
function check(y: number, m: number, d: number) { return isValidYmd(y, m, d) ? ymd(y, m, d) : null; }

/** Return period → first day of month. Accepts "032026", "03-2026", "Mar-2026", "March 2026", "2026-03", dates. */
export function parsePeriod(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date || typeof v === "number") {
    const d = parseDate(v);
    return d ? d.slice(0, 8) + "01" : null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{2})(\d{4})$/);
  if (m) return monthStart(+m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return monthStart(+m[2], +m[1]);
  m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) return monthStart(+m[1], +m[2]);
  m = s.match(/^([A-Za-z]{3,9})[-'\s,]*(\d{2}|\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return monthStart(expandYear(+m[2]), MONTHS[m[1].toLowerCase()]);
  const d = parseDate(s);
  return d ? d.slice(0, 8) + "01" : null;
}

function monthStart(y: number, m: number) { return isValidYmd(y, m, 1) ? ymd(y, m, 1) : null; }

/** "2026-03-31" → "31/03/2026" */
export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const s = iso instanceof Date ? iso.toISOString().slice(0, 10) : String(iso).slice(0, 10);
  const [y, m, d] = s.split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

/** Timestamp shown in IST: 24/10/2026 16:05 */
export function fmtDateTime(ts: string | Date | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
}

/** "2026-03-01" → "Mar 2026" */
export function fmtPeriod(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m] = iso.split("-");
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]} ${y}`;
}

/** Financial year of a date: 2026-03-31 → "2025-26"; 2026-04-01 → "2026-27". */
export function financialYear(iso: string): string {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function fyBounds(fy: string): { from: string; to: string } {
  const start = +fy.slice(0, 4);
  return { from: ymd(start, 4, 1), to: ymd(start + 1, 3, 31) };
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

export function todayIso(): string {
  // IST calendar date
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export function monthsBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let cur = fromIso.slice(0, 8) + "01";
  const end = toIso.slice(0, 8) + "01";
  while (cur <= end) { out.push(cur); cur = addMonths(cur, 1); }
  return out;
}
