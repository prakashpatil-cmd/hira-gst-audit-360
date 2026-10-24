/**
 * Dataset catalogue for the Import Centre. Each dataset declares its canonical fields, the
 * column-header synonyms used for automatic mapping, and the typed table it materialises into.
 */
export type FieldType =
  | "text" | "date" | "money" | "gstin" | "rate" | "period" | "bool" | "state" | "hsn" | "doctype" | "int" | "datetime";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Stored in a common source_transactions column; otherwise goes to `extra`. */
  common?: boolean;
  synonyms: string[];
  help?: string;
}

export type DatasetGroup = "accounting" | "gst" | "other";
export type Target =
  | "sales" | "purchase" | "gst_return" | "einvoice" | "eway" | "boe" | "shipping_bill" | "ledger" | "evidence_only";

export interface DatasetDef {
  type: string;
  label: string;
  group: DatasetGroup;
  target: Target;
  returnType?: string;            // for gst_return target
  ledgerSource?: string;          // for ledger target
  description: string;
  fields: FieldDef[];
  /** Per-GSTIN dataset (needs a GSTIN on import) */
  perGstin: boolean;
  /** Invoice-level documents are checked for duplicates */
  documentLevel: boolean;
}

// ---- reusable field definitions ---------------------------------------------------------
const f = (key: string, label: string, type: FieldType, synonyms: string[], extra: Partial<FieldDef> = {}): FieldDef =>
  ({ key, label, type, synonyms, ...extra });

const DOC_TYPE = f("doc_type", "Document type", "doctype", ["document type", "doc type", "voucher type", "vch type", "type", "invoice type", "note type", "inv typ", "typ"], { common: true });
const DOC_NO = (req = true) => f("doc_no", "Document / invoice number", "text",
  ["invoice no", "invoice number", "inv no", "invoice", "bill no", "bill number", "doc no", "document number", "document no",
   "voucher no", "vch no", "voucher number", "inum", "note number", "note no", "supplier invoice no", "reference no", "ref no"], { required: req, common: true });
const DOC_DATE = (req = true) => f("doc_date", "Document date", "date",
  ["invoice date", "inv date", "date", "bill date", "doc date", "document date", "voucher date", "vch date", "idt", "dt", "note date", "supplier invoice date"], { required: req, common: true });
const OUR_GSTIN = f("our_gstin", "Our GSTIN (supplier/recipient registration)", "gstin", ["company gstin", "our gstin", "gstin of supplier", "supplier gstin (self)", "registration gstin", "self gstin", "branch gstin"], { common: true });
const CP_GSTIN = (label: string, syn: string[]) => f("counterparty_gstin", label, "gstin", [...syn, "gstin", "gstin/uin", "gst no", "gst number", "ctin", "party gstin", "gstin of party"], { common: true });
const CP_NAME = (label: string, syn: string[]) => f("counterparty_name", label, "text", [...syn, "party name", "party", "name", "trade name", "trdnm", "legal name", "particulars"], { common: true });
const POS = f("place_of_supply", "Place of supply", "state", ["place of supply", "pos", "state", "supply state", "destination state", "state code"], { common: true });
const HSN = f("hsn", "HSN / SAC", "hsn", ["hsn", "hsn/sac", "hsn code", "sac", "hsn sac", "hsn_sc", "hsn/sac code"], { common: true });
const RATE = f("rate", "GST rate %", "rate", ["rate", "gst rate", "tax rate", "rate %", "gst %", "rt", "tax %", "igst rate"], { common: true });
const TAXABLE = (req = true) => f("taxable_value", "Taxable value", "money", ["taxable value", "taxable amount", "assessable value", "txval", "taxable", "value", "basic amount", "net amount", "taxable val"], { required: req, common: true });
const IGST = f("igst", "IGST", "money", ["igst", "igst amount", "integrated tax", "iamt", "igst amt", "integrated tax amount"], { common: true });
const CGST = f("cgst", "CGST", "money", ["cgst", "cgst amount", "central tax", "camt", "cgst amt", "central tax amount"], { common: true });
const SGST = f("sgst", "SGST / UTGST", "money", ["sgst", "sgst amount", "state tax", "samt", "sgst/utgst", "utgst", "sgst amt", "state/ut tax", "state tax amount"], { common: true });
const CESS = f("cess", "Cess", "money", ["cess", "cess amount", "csamt", "compensation cess", "cess amt"], { common: true });
const TOTAL = f("total_value", "Invoice value", "money", ["invoice value", "total", "total value", "gross amount", "val", "invoice amount", "bill amount", "total amount"], { common: true });
const PERIOD = (req = false, label = "Return period") => f("period", label, "period", ["return period", "period", "tax period", "month", "ret period", "fp", "supprd", "filing period", "gstr-3b period"], { required: req, common: true });
const RCM = f("reverse_charge", "Reverse charge (Y/N)", "bool", ["reverse charge", "rcm", "rev charge", "rchrg", "rev", "reverse charge applicable"], { common: true });
const LEDGER = f("ledger_name", "Ledger name", "text", ["ledger", "ledger name", "account", "expense ledger", "sales ledger", "purchase ledger", "gl account", "account name"], { common: true });
const VOUCHER = f("voucher_ref", "Voucher reference", "text", ["voucher ref", "voucher reference", "internal ref", "erp ref", "document id", "sap doc no", "accounting doc"], { common: true });
const ORIG_NO = f("original_doc_no", "Original invoice number", "text", ["original invoice no", "original invoice number", "against invoice", "ref invoice", "original doc no", "linked invoice"]);
const ORIG_DATE = f("original_doc_date", "Original invoice date", "date", ["original invoice date", "against invoice date", "original doc date"]);

export const DATASETS: DatasetDef[] = [
  {
    type: "sales_register", label: "Sales register (books)", group: "accounting", target: "sales", perGstin: true, documentLevel: true,
    description: "Outward supplies from the accounting system (Tally, SAP, Oracle, Busy). Credit and debit notes may be included with a document type.",
    fields: [DOC_TYPE, DOC_NO(), DOC_DATE(), OUR_GSTIN, CP_GSTIN("Customer GSTIN", ["customer gstin", "buyer gstin", "recipient gstin", "gstin of recipient"]),
      CP_NAME("Customer name", ["customer", "customer name", "buyer", "buyer name", "recipient name"]), POS, HSN, RATE, TAXABLE(), IGST, CGST, SGST, CESS, TOTAL,
      PERIOD(false, "GSTR-1 period reported"), RCM, LEDGER, VOUCHER, ORIG_NO, ORIG_DATE,
      f("supply_type", "Supply type", "text", ["supply type", "nature of supply", "invoice category", "sale type", "category"]),
      f("irn", "IRN", "text", ["irn", "invoice reference number", "e-invoice irn"]),
      f("eway_bill_no", "E-way bill number", "text", ["eway bill no", "e-way bill no", "ewb no", "eway bill number", "ewb number"]),
      f("shipping_bill_no", "Shipping bill number", "text", ["shipping bill no", "shipping bill number", "sb no", "sbnum"]),
      f("shipping_bill_date", "Shipping bill date", "date", ["shipping bill date", "sb date", "sbdt"]),
      f("port_code", "Port code", "text", ["port code", "sbpcode", "port"]),
      f("reason", "Reason (credit/debit note)", "text", ["reason", "reason for issuing", "narration", "remarks"]),
    ],
  },
  {
    type: "purchase_register", label: "Purchase register (books)", group: "accounting", target: "purchase", perGstin: true, documentLevel: true,
    description: "Inward supplies with ITC claimed. Include the GSTR-3B period in which credit was taken, ITC amounts and expense ledger.",
    fields: [DOC_TYPE, DOC_NO(), DOC_DATE(), OUR_GSTIN, CP_GSTIN("Supplier GSTIN", ["supplier gstin", "vendor gstin", "gstin of supplier", "seller gstin"]),
      CP_NAME("Supplier name", ["supplier", "supplier name", "vendor", "vendor name", "seller name"]), POS, HSN, RATE, TAXABLE(), IGST, CGST, SGST, CESS, TOTAL, RCM, LEDGER, VOUCHER, ORIG_NO, ORIG_DATE,
      f("itc_igst", "ITC claimed — IGST", "money", ["itc igst", "igst itc", "input igst", "itc integrated tax", "eligible igst"]),
      f("itc_cgst", "ITC claimed — CGST", "money", ["itc cgst", "cgst itc", "input cgst", "itc central tax", "eligible cgst"]),
      f("itc_sgst", "ITC claimed — SGST", "money", ["itc sgst", "sgst itc", "input sgst", "itc state tax", "eligible sgst"]),
      f("itc_cess", "ITC claimed — Cess", "money", ["itc cess", "cess itc", "eligible cess"]),
      f("itc_claim_period", "ITC claim period (GSTR-3B)", "period", ["itc claim period", "claimed in", "3b period", "itc period", "itc availed period", "itc month"]),
      f("itc_category", "ITC category", "text", ["itc category", "eligibility", "itc type", "nature of itc", "input type"]),
      f("is_import", "Import (Y/N)", "bool", ["import", "is import", "imported"]),
      f("boe_no", "Bill of entry number", "text", ["boe no", "bill of entry no", "bill of entry number", "boe number"]),
      f("reason", "Reason / narration", "text", ["narration", "remarks", "description", "reason"]),
    ],
  },
  {
    type: "gstr1", label: "GSTR-1 (portal)", group: "gst", target: "gst_return", returnType: "GSTR1", perGstin: true, documentLevel: true,
    description: "Invoice-level GSTR-1 data (Excel/CSV download or portal JSON). Include table (B2B, EXP, CDNR, B2CS…), shipping bill and port code for exports.",
    fields: [f("table_code", "GSTR-1 table / section", "text", ["table", "section", "table no", "gstr1 table", "type of supply", "return section"], { required: true }),
      DOC_TYPE, DOC_NO(false), DOC_DATE(false), CP_GSTIN("Recipient GSTIN", ["recipient gstin", "gstin of recipient", "customer gstin"]),
      CP_NAME("Recipient name", ["recipient name", "receiver name"]), POS, RATE, TAXABLE(), IGST, CGST, SGST, CESS, TOTAL, PERIOD(true), RCM,
      f("shipping_bill_no", "Shipping bill number", "text", ["shipping bill no", "shipping bill number", "sbnum", "sb no", "shipping bill/ bill of export no"]),
      f("shipping_bill_date", "Shipping bill date", "date", ["shipping bill date", "sbdt", "sb date", "shipping bill/ bill of export date"]),
      f("port_code", "Port code", "text", ["port code", "sbpcode"]),
      f("original_doc_no", "Original document number", "text", ["original invoice number", "original invoice no", "original document number"]),
    ],
  },
  {
    type: "gstr1a", label: "GSTR-1A (portal)", group: "gst", target: "gst_return", returnType: "GSTR1A", perGstin: true, documentLevel: true,
    description: "Amendments reported through GSTR-1A, in the same layout as GSTR-1.",
    fields: [] as FieldDef[],
  },
  {
    type: "gstr3b", label: "GSTR-3B (portal)", group: "gst", target: "gst_return", returnType: "GSTR3B", perGstin: true, documentLevel: false,
    description: "Table-wise GSTR-3B summary: one row per period per table, e.g. 3.1(a), 3.1(b), 3.1(d), 4(A)(1)…4(A)(5), 4(B)(1), 4(B)(2), 6.1 payment.",
    fields: [PERIOD(true), f("table_code", "GSTR-3B table", "text", ["table", "table no", "section", "3b table", "particulars", "nature of supplies", "details"], { required: true }),
      TAXABLE(false), IGST, CGST, SGST, CESS,
      f("filing_date", "Filing date", "date", ["filing date", "date of filing", "filed on"]),
      f("arn", "ARN", "text", ["arn", "acknowledgement number"])],
  },
  {
    type: "gstr2b", label: "GSTR-2B (portal)", group: "gst", target: "gst_return", returnType: "GSTR2B", perGstin: true, documentLevel: true,
    description: "Auto-drafted ITC statement (Excel/CSV or portal JSON). B2B, B2BA, CDNR, ISD and IMPG sections are recognised.",
    fields: [f("table_code", "Section", "text", ["section", "table", "type", "document section", "category"]),
      DOC_TYPE, DOC_NO(), DOC_DATE(), CP_GSTIN("Supplier GSTIN", ["gstin of supplier", "supplier gstin", "ctin"]),
      CP_NAME("Supplier name", ["trade/legal name", "supplier name", "trdnm", "trade name"]), POS, RATE, TAXABLE(), IGST, CGST, SGST, CESS, TOTAL, PERIOD(true, "GSTR-2B period"), RCM,
      f("itc_available", "ITC availability", "bool", ["itc availability", "itc available", "itcavl", "eligible for itc"]),
      f("supplier_filing_date", "Supplier filing date", "date", ["gstr-1/iff/gstr-5 filing date", "supplier filing date", "supfildt", "filing date"]),
      f("reason", "Reason ITC not available", "text", ["reason", "rsn", "reason for itc unavailability"])],
  },
  {
    type: "gstr2a", label: "GSTR-2A (portal)", group: "gst", target: "gst_return", returnType: "GSTR2A", perGstin: true, documentLevel: true,
    description: "Dynamic inward supply statement, same layout as GSTR-2B.",
    fields: [] as FieldDef[],
  },
  {
    type: "einvoice_register", label: "E-invoice register (IRN)", group: "other", target: "einvoice", perGstin: true, documentLevel: true,
    description: "IRN list from the IRP / e-invoice portal including cancellation status.",
    fields: [f("irn", "IRN", "text", ["irn", "invoice reference number"], { required: true }),
      f("ack_no", "Acknowledgement number", "text", ["ack no", "ack number", "acknowledgement no", "ackno"]),
      f("ack_date", "Acknowledgement date", "datetime", ["ack date", "acknowledgement date", "ackdt"]),
      f("irn_status", "IRN status", "text", ["status", "irn status", "einvoice status"]),
      f("cancel_date", "Cancellation date", "datetime", ["cancel date", "cancellation date", "cnl dt"]),
      DOC_TYPE, DOC_NO(), DOC_DATE(), CP_GSTIN("Buyer GSTIN", ["buyer gstin", "recipient gstin", "receiver gstin"]),
      f("dispatch_from", "Dispatch from", "text", ["dispatch from", "dispatch address", "dispatch from address"]),
      f("ship_to", "Ship to", "text", ["ship to", "ship to address", "shipping address"]),
      TAXABLE(), IGST, CGST, SGST, CESS, TOTAL],
  },
  {
    type: "eway_bill_register", label: "E-way bill register", group: "other", target: "eway", perGstin: true, documentLevel: true,
    description: "E-way bills generated (outward and inward), including cancelled and discarded bills.",
    fields: [f("ewb_no", "E-way bill number", "text", ["ewb no", "eway bill no", "e-way bill no", "ewb number", "eway bill number", "e way bill no"], { required: true }),
      f("ewb_date", "E-way bill date", "date", ["ewb date", "eway bill date", "e-way bill date", "generated date", "ewb generated date"], { required: true }),
      f("ewb_status", "Status", "text", ["status", "ewb status", "eway bill status"]),
      f("supply_direction", "Supply type (outward/inward)", "text", ["supply type", "outward/inward", "transaction direction"]),
      f("sub_type", "Sub supply type", "text", ["sub type", "sub supply type", "sub-supply type"]),
      DOC_TYPE, DOC_NO(), DOC_DATE(false),
      f("from_gstin", "From GSTIN", "gstin", ["from gstin", "consignor gstin", "supplier gstin"]),
      CP_GSTIN("To GSTIN", ["to gstin", "consignee gstin", "recipient gstin"]),
      f("from_pincode", "From pincode", "text", ["from pincode", "from pin", "dispatch pincode"]),
      f("to_pincode", "To pincode", "text", ["to pincode", "to pin", "delivery pincode"]),
      f("distance_km", "Distance (km)", "int", ["distance", "approx distance", "distance km", "distance (km)"]),
      f("vehicle_no", "Vehicle number", "text", ["vehicle no", "vehicle number", "vehicle"]),
      f("valid_upto", "Valid upto", "datetime", ["valid upto", "valid until", "validity"]),
      HSN, TAXABLE(), IGST, CGST, SGST, CESS, TOTAL],
  },
  {
    type: "bills_of_entry", label: "Bills of entry (ICEGATE)", group: "other", target: "boe", perGstin: true, documentLevel: true,
    description: "Bills of entry with IGST paid on imports.",
    fields: [f("boe_no", "Bill of entry number", "text", ["boe no", "bill of entry no", "be no", "boe number", "boenum"], { required: true }),
      f("boe_date", "Bill of entry date", "date", ["boe date", "bill of entry date", "be date", "boedt"], { required: true }),
      f("port_code", "Port code", "text", ["port code", "portcode", "port"]),
      f("boe_type", "BOE type", "text", ["boe type", "be type", "type"]),
      CP_NAME("Supplier name", ["supplier", "foreign supplier", "supplier name"]), HSN,
      f("assessable_value", "Assessable value", "money", ["assessable value", "av", "txval", "taxable value"], { required: true }),
      f("bcd", "Basic customs duty", "money", ["bcd", "basic customs duty", "basic duty"]),
      f("sws", "Social welfare surcharge", "money", ["sws", "social welfare surcharge"]),
      IGST, CESS,
      f("is_amended", "Amended (Y/N)", "bool", ["amended", "is amended"]),
      f("paid_under_protest", "Paid under protest (Y/N)", "bool", ["under protest", "paid under protest"])],
  },
  {
    type: "shipping_bills", label: "Shipping bills (ICEGATE)", group: "other", target: "shipping_bill", perGstin: true, documentLevel: true,
    description: "Shipping bills with LEO/EGM details and ICEGATE transmission status.",
    fields: [f("sb_no", "Shipping bill number", "text", ["shipping bill no", "sb no", "shipping bill number", "sbnum"], { required: true }),
      f("sb_date", "Shipping bill date", "date", ["shipping bill date", "sb date", "sbdt"], { required: true }),
      f("port_code", "Port code", "text", ["port code", "port", "sbpcode"]),
      f("invoice_no", "Export invoice number", "text", ["invoice no", "invoice number", "export invoice no", "inv no"], { required: true }),
      f("invoice_date", "Export invoice date", "date", ["invoice date", "inv date", "export invoice date"]),
      f("fob_value_inr", "FOB value (INR)", "money", ["fob value", "fob inr", "fob value inr", "fob"]),
      f("igst_paid", "IGST paid", "money", ["igst paid", "igst", "igst amount"]),
      f("leo_date", "LEO date", "date", ["leo date", "let export order date", "leo dt"]),
      f("egm_no", "EGM number", "text", ["egm no", "egm number"]),
      f("egm_date", "EGM date", "date", ["egm date"]),
      f("icegate_status", "ICEGATE status", "text", ["icegate status", "status", "transmission status", "error code"]),
      f("brc_no", "BRC / eBRC number", "text", ["brc no", "ebrc no", "brc number", "firc"]),
      f("brc_date", "BRC date", "date", ["brc date", "ebrc date"]),
      f("realised_amount_inr", "Realised amount (INR)", "money", ["realised amount", "realized amount", "realisation inr"])],
  },
  {
    type: "trial_balance", label: "Trial balance", group: "accounting", target: "ledger", ledgerSource: "trial_balance", perGstin: false, documentLevel: false,
    description: "Ledger-wise opening, debits, credits and closing balances.",
    fields: [f("ledger_name", "Ledger name", "text", ["ledger", "ledger name", "particulars", "account", "account name", "gl name"], { required: true, common: true }),
      f("ledger_group", "Group", "text", ["group", "ledger group", "parent", "account group", "under"]),
      f("opening", "Opening balance", "money", ["opening", "opening balance", "op bal"]),
      f("debit", "Debit", "money", ["debit", "dr", "debit amount", "transactions debit"]),
      f("credit", "Credit", "money", ["credit", "cr", "credit amount", "transactions credit"]),
      f("closing", "Closing balance", "money", ["closing", "closing balance", "cl bal", "balance"], { required: true }),
      PERIOD(false, "As at period")],
  },
  {
    type: "general_ledger", label: "General ledger / day book", group: "accounting", target: "ledger", ledgerSource: "general_ledger", perGstin: false, documentLevel: false,
    description: "Voucher-level ledger entries. Used for RCM, blocked-credit and expense scanning.",
    fields: [DOC_DATE(), f("voucher_ref", "Voucher number", "text", ["voucher no", "vch no", "voucher number", "voucher", "document no"], { required: true, common: true }),
      f("ledger_name", "Ledger name", "text", ["ledger", "ledger name", "account", "gl account", "particulars"], { required: true, common: true }),
      f("ledger_group", "Group", "text", ["group", "ledger group", "parent"]),
      CP_NAME("Party name", ["party", "vendor", "supplier", "payee"]),
      f("debit", "Debit", "money", ["debit", "dr", "debit amount"]),
      f("credit", "Credit", "money", ["credit", "cr", "credit amount"]),
      f("narration", "Narration", "text", ["narration", "description", "remarks", "text"]),
      f("currency", "Currency", "text", ["currency", "curr"]),
      f("party_country", "Party country", "text", ["country", "party country", "vendor country"])],
  },
  {
    type: "electronic_cash_ledger", label: "Electronic cash ledger", group: "gst", target: "ledger", ledgerSource: "electronic_cash", perGstin: true, documentLevel: false,
    description: "Closing balances by tax head (portal download).",
    fields: [PERIOD(true, "As at"), f("tax_head", "Tax head", "text", ["tax head", "head", "major head"], { required: true }),
      f("minor_head", "Minor head (tax/interest/penalty/fee)", "text", ["minor head", "component"]),
      f("closing", "Balance", "money", ["balance", "closing balance", "closing", "amount"], { required: true })],
  },
  {
    type: "electronic_credit_ledger", label: "Electronic credit ledger", group: "gst", target: "ledger", ledgerSource: "electronic_credit", perGstin: true, documentLevel: false,
    description: "ITC balance by tax head.",
    fields: [PERIOD(true, "As at"), f("tax_head", "Tax head", "text", ["tax head", "head"], { required: true }),
      f("debit", "Utilised / debit", "money", ["debit", "utilised", "dr"]), f("credit", "Credited", "money", ["credit", "cr", "credited"]),
      f("closing", "Balance", "money", ["balance", "closing balance", "closing"], { required: true })],
  },
  {
    type: "fixed_asset_register", label: "Fixed asset register", group: "accounting", target: "ledger", ledgerSource: "fixed_asset_register", perGstin: false, documentLevel: false,
    description: "Assets with capitalisation, ITC availed and disposal details (Section 18(6) / Rule 44(6)).",
    fields: [f("ledger_name", "Asset description", "text", ["asset", "asset name", "description", "asset description"], { required: true, common: true }),
      f("voucher_ref", "Asset code", "text", ["asset code", "asset id", "tag no"], { common: true }),
      f("ledger_group", "Asset class", "text", ["asset class", "block", "category", "group"]),
      f("capitalisation_date", "Capitalisation date", "date", ["capitalisation date", "capitalization date", "put to use date", "date of purchase"]),
      f("opening", "Capitalised cost", "money", ["cost", "capitalised cost", "gross block", "original cost"]),
      f("itc_availed", "ITC availed", "money", ["itc availed", "itc", "input tax credit"]),
      f("disposal_date", "Disposal date", "date", ["disposal date", "sale date", "date of sale"]),
      f("credit", "Sale consideration", "money", ["sale value", "sale consideration", "disposal value"]),
      f("closing", "Net block", "money", ["net block", "wdv", "closing"]),
      f("buyer_gstin", "Buyer GSTIN", "gstin", ["buyer gstin", "purchaser gstin"]),
      f("disposal_type", "Disposal type", "text", ["disposal type", "mode", "sale/scrap/transfer"])],
  },
];

// GSTR-1A and GSTR-2A share their parent layouts.
for (const d of DATASETS) {
  if (d.type === "gstr1a") d.fields = DATASETS.find((x) => x.type === "gstr1")!.fields;
  if (d.type === "gstr2a") d.fields = DATASETS.find((x) => x.type === "gstr2b")!.fields;
}

/** Records accepted as evidence (stored and validated for structure, not reconciled automatically yet). */
const EVIDENCE: [string, string, DatasetGroup][] = [
  ["gstr9", "GSTR-9 annual return", "gst"], ["gstr9c", "GSTR-9C reconciliation statement", "gst"], ["gstr6", "GSTR-6 (ISD)", "gst"],
  ["gstr7_8", "GSTR-7 / GSTR-8 (TDS/TCS)", "gst"], ["electronic_liability_register", "Electronic liability register", "gst"],
  ["ecrrs", "Electronic Credit Reversal and Re-claimed Statement", "gst"], ["rcm_statement", "RCM liability / ITC statement", "gst"],
  ["ims_data", "Invoice Management System actions", "gst"], ["itc04", "ITC-04 / job-work register", "other"], ["lut", "LUT records", "other"],
  ["sez_endorsements", "SEZ endorsements / admission records", "other"], ["refunds", "Refund applications and orders", "other"],
  ["drc03", "DRC-03 payments", "other"], ["challans", "GST challans (PMT-06)", "other"], ["stock_register", "Stock register", "accounting"],
  ["customer_master", "Customer master", "accounting"], ["vendor_master", "Vendor master", "accounting"], ["receivables_payables", "Receivables / payables ageing", "accounting"],
  ["bank_payments", "Bank payment references", "accounting"], ["journal_vouchers", "Journal vouchers", "accounting"], ["tax_ledgers", "GST ledgers in books", "accounting"],
];
for (const [type, label, group] of EVIDENCE) {
  DATASETS.push({ type, label, group, target: "evidence_only", perGstin: false, documentLevel: false,
    description: "Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library.",
    fields: [DOC_NO(false), DOC_DATE(false), CP_GSTIN("GSTIN", []), TAXABLE(false), IGST, CGST, SGST, CESS, PERIOD(false),
      f("description", "Description", "text", ["description", "particulars", "remarks", "narration"])] });
}

export const DATASET_MAP = new Map(DATASETS.map((d) => [d.type, d]));

export function getDataset(type: string): DatasetDef {
  const d = DATASET_MAP.get(type);
  if (!d) throw new Error(`Unknown dataset type ${type}`);
  return d;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]/g, "");

/**
 * Suggests a column map from file headers: exact synonym matches first, then label matches,
 * then "header contains synonym". Each header is used at most once.
 */
export function autoMap(dataset: DatasetDef, headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  const H = headers.map((h) => ({ h, n: norm(h) }));
  const passes: ((field: FieldDef, n: string) => boolean)[] = [
    (fd, n) => fd.synonyms.some((s) => norm(s) === n) || norm(fd.key) === n,
    (fd, n) => norm(fd.label) === n,
    (fd, n) => n.length > 2 && fd.synonyms.some((s) => norm(s).length > 3 && n.includes(norm(s))),
  ];
  for (const pass of passes) {
    for (const field of dataset.fields) {
      if (map[field.key]) continue;
      const hit = H.find(({ h, n }) => !used.has(h) && pass(field, n));
      if (hit) { map[field.key] = hit.h; used.add(hit.h); }
    }
  }
  return map;
}
