import { gstr3bDueDate } from "@/lib/rules/statutory";
import { fmtDate } from "@/lib/gst/dates";
export { financialYear, addMonths } from "@/lib/gst/dates";

export function gstr3bDueDateSafe(period: string): string {
  try { return fmtDate(gstr3bDueDate(period)); } catch { return "—"; }
}
