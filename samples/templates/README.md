# Import templates

Columns marked * are required. Any column order or header wording is accepted — the Import Centre maps headers automatically and you can adjust and save the mapping per client.

| Record type | File | Description |
|---|---|---|
| Sales register (books) | `sales_register.csv` | Outward supplies from the accounting system (Tally, SAP, Oracle, Busy). Credit and debit notes may be included with a document type. |
| Purchase register (books) | `purchase_register.csv` | Inward supplies with ITC claimed. Include the GSTR-3B period in which credit was taken, ITC amounts and expense ledger. |
| GSTR-1 (portal) | `gstr1.csv` | Invoice-level GSTR-1 data (Excel/CSV download or portal JSON). Include table (B2B, EXP, CDNR, B2CS…), shipping bill and port code for exports. |
| GSTR-1A (portal) | `gstr1a.csv` | Amendments reported through GSTR-1A, in the same layout as GSTR-1. |
| GSTR-3B (portal) | `gstr3b.csv` | Table-wise GSTR-3B summary: one row per period per table, e.g. 3.1(a), 3.1(b), 3.1(d), 4(A)(1)…4(A)(5), 4(B)(1), 4(B)(2), 6.1 payment. |
| GSTR-2B (portal) | `gstr2b.csv` | Auto-drafted ITC statement (Excel/CSV or portal JSON). B2B, B2BA, CDNR, ISD and IMPG sections are recognised. |
| GSTR-2A (portal) | `gstr2a.csv` | Dynamic inward supply statement, same layout as GSTR-2B. |
| E-invoice register (IRN) | `einvoice_register.csv` | IRN list from the IRP / e-invoice portal including cancellation status. |
| E-way bill register | `eway_bill_register.csv` | E-way bills generated (outward and inward), including cancelled and discarded bills. |
| Bills of entry (ICEGATE) | `bills_of_entry.csv` | Bills of entry with IGST paid on imports. |
| Shipping bills (ICEGATE) | `shipping_bills.csv` | Shipping bills with LEO/EGM details and ICEGATE transmission status. |
| Trial balance | `trial_balance.csv` | Ledger-wise opening, debits, credits and closing balances. |
| General ledger / day book | `general_ledger.csv` | Voucher-level ledger entries. Used for RCM, blocked-credit and expense scanning. |
| Electronic cash ledger | `electronic_cash_ledger.csv` | Closing balances by tax head (portal download). |
| Electronic credit ledger | `electronic_credit_ledger.csv` | ITC balance by tax head. |
| Fixed asset register | `fixed_asset_register.csv` | Assets with capitalisation, ITC availed and disposal details (Section 18(6) / Rule 44(6)). |
| GSTR-9 annual return | `gstr9.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| GSTR-9C reconciliation statement | `gstr9c.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| GSTR-6 (ISD) | `gstr6.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| GSTR-7 / GSTR-8 (TDS/TCS) | `gstr7_8.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| Electronic liability register | `electronic_liability_register.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| Electronic Credit Reversal and Re-claimed Statement | `ecrrs.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| RCM liability / ITC statement | `rcm_statement.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| Invoice Management System actions | `ims_data.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| ITC-04 / job-work register | `itc04.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| LUT records | `lut.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| SEZ endorsements / admission records | `sez_endorsements.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| Refund applications and orders | `refunds.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| DRC-03 payments | `drc03.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| GST challans (PMT-06) | `challans.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| Stock register | `stock_register.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| Customer master | `customer_master.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| Vendor master | `vendor_master.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| Receivables / payables ageing | `receivables_payables.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| Bank payment references | `bank_payments.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| Journal vouchers | `journal_vouchers.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
| GST ledgers in books | `tax_ledgers.csv` | Stored with full row lineage and available for drill-down; automated tests for this record type are listed in the control library. |
