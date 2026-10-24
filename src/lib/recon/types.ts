import type { Paise } from "@/lib/gst/money";
import type { MatchResult, RDoc } from "./match";

export type Severity = "critical" | "high" | "medium" | "low" | "opportunity";
export type Classification =
  | "confirmed" | "probable" | "requires_investigation" | "documentary_deficiency" | "potential_opportunity" | "not_applicable" | "resolved";

export interface ExceptionDraft {
  type: string;
  module: string;                 // A..Q
  controlId?: string | null;
  severity: Severity;
  classification: Classification;
  description: string;
  docNo?: string | null;
  docDate?: string | null;
  gstin?: string | null;
  name?: string | null;
  period?: string | null;
  diff: { taxable: Paise; igst: Paise; cgst: Paise; sgst: Paise; cess: Paise; tax: Paise };
  sourceIds: string[];
  matchIndex?: number;            // index into the run's match list
}

export interface ReconOutput {
  matches: MatchResult[];
  exceptions: ExceptionDraft[];
  summary: Record<string, unknown>;
}

export interface ReturnLine {
  id: string; period: string; table: string; taxable: Paise; igst: Paise; cgst: Paise; sgst: Paise; cess: Paise;
}

export interface BoeRow { id: string; boeNo: string; boeNorm: string; boeDate: string; igst: Paise; cess: Paise; assessable: Paise; type: string | null; port: string | null; paidUnderProtest: boolean; hsn: string | null }
export interface SbRow { id: string; sbNo: string; sbDate: string; port: string | null; invoiceNo: string | null; invoiceNorm: string | null; invoiceDate: string | null; fob: Paise | null; leoDate: string | null; icegateStatus: string | null; brcNo: string | null }
export interface LedgerRow { id: string; source: string; name: string; group: string | null; taxHead: string | null; period: string | null; opening: Paise; debit: Paise; credit: Paise; closing: Paise; extra: Record<string, unknown> }

export interface GstinData {
  gstinId: string | null;
  gstin: string | null;
  sales: RDoc[]; salesNotes: RDoc[]; purchases: RDoc[]; purchaseNotes: RDoc[];
  gstr1: RDoc[]; gstr3b: ReturnLine[]; gstr2b: RDoc[]; einv: RDoc[]; ewb: RDoc[];
  boe: BoeRow[]; sb: SbRow[]; ledgers: LedgerRow[];
  importIds: string[];
}

export interface ReconContext {
  asOf: string;
  periodFrom: string;
  periodTo: string;
  tolerance: Paise;
  materiality: Paise;
  einvoiceFrom: string | null;
  aatoCrore: number | null;
  annualReturnFiledOn?: string | null;
}

export const zeroDiff = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, tax: 0 });
