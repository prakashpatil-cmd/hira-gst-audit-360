-- Data import centre: original files, mapping templates, import versions, row-level lineage
-- and the typed transaction tables used by the reconciliation engine.

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  engagement_id uuid references public.audit_engagements(id) on delete cascade,
  kind text not null check (kind in ('import_file','evidence','notice','client_upload','report','annexure','other')),
  storage_bucket text not null default 'audit-files',
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 char(64) not null,
  scan_status text not null default 'pending' check (scan_status in ('pending','clean','infected','skipped','error')),
  description text,
  uploaded_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index source_documents_engagement_idx on public.source_documents(engagement_id);
create index source_documents_sha_idx on public.source_documents(client_id, sha256);

create table public.import_mappings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  client_id uuid references public.clients(id) on delete cascade,  -- null = firm-wide template
  dataset_type text not null,
  name text not null,
  sheet_name text,
  header_row int not null default 1 check (header_row >= 1),
  column_map jsonb not null,           -- { canonicalField: "Source column header" }
  options jsonb not null default '{}', -- { dateFormat, negativeCreditNotes, amountsInclusive, defaultReturnPeriod }
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (organisation_id, client_id, dataset_type, name)
);

create table public.data_imports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  dataset_type text not null,
  source_document_id uuid not null references public.source_documents(id),
  mapping_id uuid references public.import_mappings(id) on delete set null,
  version int not null default 1,
  supersedes_import_id uuid references public.data_imports(id),
  status text not null default 'uploaded' check (status in
    ('uploaded','mapped','validating','validated','committing','committed','failed','superseded','discarded')),
  sheet_name text,
  header_row int not null default 1,
  column_map jsonb,
  options jsonb not null default '{}',
  detected_headers text[],
  total_rows int not null default 0,
  accepted_rows int not null default 0,
  warning_rows int not null default 0,
  rejected_rows int not null default 0,
  duplicate_rows int not null default 0,
  quality_report jsonb,
  processing_log jsonb not null default '[]',
  error text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  committed_at timestamptz,
  committed_by uuid references public.users(id)
);
create index data_imports_engagement_idx on public.data_imports(engagement_id, dataset_type, status);

-- Every row of every imported file, valid or not. Nothing is silently discarded.
create table public.source_transactions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  import_id uuid not null references public.data_imports(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  dataset_type text not null,
  row_number int not null,
  raw jsonb not null,
  row_status text not null check (row_status in ('accepted','warning','rejected','duplicate')),
  issues jsonb not null default '[]',   -- [{code, field, message, severity}]
  -- normalised common fields
  doc_type text,
  doc_no text,
  doc_no_norm text,
  doc_date date,
  our_gstin char(15),
  counterparty_gstin text,
  counterparty_name text,
  place_of_supply char(2),
  hsn text,
  rate numeric(7,3),
  taxable_value numeric(18,2),
  igst numeric(18,2),
  cgst numeric(18,2),
  sgst numeric(18,2),
  cess numeric(18,2),
  total_value numeric(18,2),
  period date,                          -- return period (first day of month)
  reverse_charge boolean,
  ledger_name text,
  voucher_ref text,
  extra jsonb not null default '{}',
  fingerprint text,                     -- duplicate-detection key for document-level datasets
  unique (import_id, row_number)
);
create index source_transactions_fp_idx on public.source_transactions(engagement_id, dataset_type, fingerprint) where fingerprint is not null;
create index source_transactions_eng_idx on public.source_transactions(engagement_id, dataset_type);
create index source_transactions_doc_idx on public.source_transactions(engagement_id, doc_no_norm);

-- ---------------------------------------------------------------------------
-- Typed, committed transaction tables. Each row points back to its source row.
-- is_current = false when the import that produced it has been superseded.
-- ---------------------------------------------------------------------------
create table public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  import_id uuid not null references public.data_imports(id) on delete cascade,
  source_transaction_id uuid not null references public.source_transactions(id) on delete cascade,
  is_current boolean not null default true,
  doc_type text not null default 'INV',
  supply_type text,                       -- b2b, b2c, export_wop, export_wp, sez_wop, sez_wp, deemed, nil, exempt, non_gst
  invoice_no text not null,
  invoice_no_norm text not null,
  invoice_date date not null,
  customer_gstin text,
  customer_name text,
  place_of_supply char(2),
  hsn text,
  rate numeric(7,3),
  taxable_value numeric(18,2) not null default 0,
  igst numeric(18,2) not null default 0,
  cgst numeric(18,2) not null default 0,
  sgst numeric(18,2) not null default 0,
  cess numeric(18,2) not null default 0,
  invoice_value numeric(18,2),
  reverse_charge boolean not null default false,
  irn text,
  eway_bill_no text,
  shipping_bill_no text,
  shipping_bill_date date,
  port_code text,
  voucher_ref text,
  ledger_name text,
  period date
);
create index sales_invoices_key on public.sales_invoices(engagement_id, invoice_no_norm) where is_current;

create table public.purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  import_id uuid not null references public.data_imports(id) on delete cascade,
  source_transaction_id uuid not null references public.source_transactions(id) on delete cascade,
  is_current boolean not null default true,
  doc_type text not null default 'INV',   -- INV, BOE (import), SELF (RCM self-invoice)
  invoice_no text not null,
  invoice_no_norm text not null,
  invoice_date date not null,
  supplier_gstin text,
  supplier_name text,
  place_of_supply char(2),
  hsn text,
  rate numeric(7,3),
  taxable_value numeric(18,2) not null default 0,
  igst numeric(18,2) not null default 0,
  cgst numeric(18,2) not null default 0,
  sgst numeric(18,2) not null default 0,
  cess numeric(18,2) not null default 0,
  invoice_value numeric(18,2),
  itc_igst numeric(18,2) not null default 0,
  itc_cgst numeric(18,2) not null default 0,
  itc_sgst numeric(18,2) not null default 0,
  itc_cess numeric(18,2) not null default 0,
  itc_claim_period date,                   -- GSTR-3B period in which ITC was claimed
  itc_category text,                       -- inputs, input_services, capital_goods, ineligible
  reverse_charge boolean not null default false,
  is_import boolean not null default false,
  boe_no text,
  expense_ledger text,
  voucher_ref text,
  period date
);
create index purchase_invoices_key on public.purchase_invoices(engagement_id, supplier_gstin, invoice_no_norm) where is_current;

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  import_id uuid not null references public.data_imports(id) on delete cascade,
  source_transaction_id uuid not null references public.source_transactions(id) on delete cascade,
  is_current boolean not null default true,
  side text not null check (side in ('outward','inward')),
  note_no text not null,
  note_no_norm text not null,
  note_date date not null,
  original_invoice_no text,
  original_invoice_date date,
  counterparty_gstin text,
  counterparty_name text,
  reason text,
  hsn text,
  rate numeric(7,3),
  taxable_value numeric(18,2) not null default 0,  -- stored as positive amounts
  igst numeric(18,2) not null default 0,
  cgst numeric(18,2) not null default 0,
  sgst numeric(18,2) not null default 0,
  cess numeric(18,2) not null default 0,
  voucher_ref text,
  period date
);
create index credit_notes_key on public.credit_notes(engagement_id, side, note_no_norm) where is_current;

create table public.debit_notes (like public.credit_notes including defaults including constraints);
alter table public.debit_notes add primary key (id);
alter table public.debit_notes add foreign key (engagement_id) references public.audit_engagements(id) on delete cascade;
alter table public.debit_notes add foreign key (import_id) references public.data_imports(id) on delete cascade;
alter table public.debit_notes add foreign key (source_transaction_id) references public.source_transactions(id) on delete cascade;
alter table public.debit_notes add foreign key (client_gstin_id) references public.client_gstins(id);
create index debit_notes_key on public.debit_notes(engagement_id, side, note_no_norm) where is_current;

create table public.gst_returns (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  import_id uuid not null references public.data_imports(id) on delete cascade,
  is_current boolean not null default true,
  return_type text not null check (return_type in ('GSTR1','GSTR1A','GSTR3B','GSTR2A','GSTR2B','GSTR6','GSTR6A','GSTR7','GSTR8','GSTR9','GSTR9C','ITC04')),
  period date not null,
  filing_date date,
  arn text,
  unique (import_id, return_type, period, client_gstin_id)
);

create table public.gst_return_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  gst_return_id uuid not null references public.gst_returns(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  source_transaction_id uuid not null references public.source_transactions(id) on delete cascade,
  is_current boolean not null default true,
  return_type text not null,
  period date not null,
  table_code text not null,               -- '4A','4B','6A','6B','7','9A','9B','3.1(a)','4(A)(5)', 'B2B', ...
  doc_type text,
  doc_no text,
  doc_no_norm text,
  doc_date date,
  counterparty_gstin text,
  counterparty_name text,
  place_of_supply char(2),
  rate numeric(7,3),
  taxable_value numeric(18,2) not null default 0,
  igst numeric(18,2) not null default 0,
  cgst numeric(18,2) not null default 0,
  sgst numeric(18,2) not null default 0,
  cess numeric(18,2) not null default 0,
  reverse_charge boolean not null default false,
  itc_available boolean,
  shipping_bill_no text,
  shipping_bill_date date,
  port_code text,
  supplier_filing_date date
);
create index gst_return_lines_key on public.gst_return_lines(engagement_id, return_type, doc_no_norm) where is_current;
create index gst_return_lines_period on public.gst_return_lines(engagement_id, return_type, period) where is_current;

create table public.einvoices (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  import_id uuid not null references public.data_imports(id) on delete cascade,
  source_transaction_id uuid not null references public.source_transactions(id) on delete cascade,
  is_current boolean not null default true,
  irn text not null,
  ack_no text,
  ack_date timestamptz,
  irn_status text not null default 'ACT' check (irn_status in ('ACT','CNL')),
  cancel_date timestamptz,
  doc_type text not null default 'INV',
  doc_no text not null,
  doc_no_norm text not null,
  doc_date date not null,
  buyer_gstin text,
  dispatch_from text,
  ship_to text,
  taxable_value numeric(18,2) not null default 0,
  igst numeric(18,2) not null default 0,
  cgst numeric(18,2) not null default 0,
  sgst numeric(18,2) not null default 0,
  cess numeric(18,2) not null default 0
);
create index einvoices_key on public.einvoices(engagement_id, doc_no_norm) where is_current;

create table public.eway_bills (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  import_id uuid not null references public.data_imports(id) on delete cascade,
  source_transaction_id uuid not null references public.source_transactions(id) on delete cascade,
  is_current boolean not null default true,
  ewb_no text not null,
  ewb_date date not null,
  ewb_status text not null default 'active' check (ewb_status in ('active','cancelled','discarded','expired','rejected')),
  supply_direction text not null default 'outward' check (supply_direction in ('outward','inward')),
  sub_type text,                             -- supply, export, job_work, sku, recipient_not_known, ...
  doc_type text not null default 'INV',
  doc_no text not null,
  doc_no_norm text not null,
  doc_date date,
  from_gstin text,
  to_gstin text,
  from_pincode text,
  to_pincode text,
  distance_km int,
  vehicle_no text,
  valid_upto timestamptz,
  hsn text,
  taxable_value numeric(18,2) not null default 0,
  igst numeric(18,2) not null default 0,
  cgst numeric(18,2) not null default 0,
  sgst numeric(18,2) not null default 0,
  cess numeric(18,2) not null default 0,
  total_value numeric(18,2)
);
create index eway_bills_key on public.eway_bills(engagement_id, doc_no_norm) where is_current;

create table public.bills_of_entry (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  import_id uuid not null references public.data_imports(id) on delete cascade,
  source_transaction_id uuid not null references public.source_transactions(id) on delete cascade,
  is_current boolean not null default true,
  boe_no text not null,
  boe_date date not null,
  port_code text,
  boe_type text,                          -- home_consumption, warehouse, ex_bond, ftwz, sez
  supplier_name text,
  hsn text,
  assessable_value numeric(18,2) not null default 0,
  bcd numeric(18,2) not null default 0,
  sws numeric(18,2) not null default 0,
  igst numeric(18,2) not null default 0,
  cess numeric(18,2) not null default 0,
  is_amended boolean not null default false,
  paid_under_protest boolean not null default false
);
create index bills_of_entry_key on public.bills_of_entry(engagement_id, boe_no) where is_current;

create table public.shipping_bills (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  import_id uuid not null references public.data_imports(id) on delete cascade,
  source_transaction_id uuid not null references public.source_transactions(id) on delete cascade,
  is_current boolean not null default true,
  sb_no text not null,
  sb_date date not null,
  port_code text,
  invoice_no text,
  invoice_no_norm text,
  invoice_date date,
  fob_value_inr numeric(18,2),
  igst_paid numeric(18,2) not null default 0,
  leo_date date,
  egm_no text,
  egm_date date,
  icegate_status text,
  brc_no text,
  brc_date date,
  realised_amount_inr numeric(18,2)
);
create index shipping_bills_key on public.shipping_bills(engagement_id, invoice_no_norm) where is_current;

create table public.ledger_balances (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  import_id uuid not null references public.data_imports(id) on delete cascade,
  source_transaction_id uuid not null references public.source_transactions(id) on delete cascade,
  is_current boolean not null default true,
  source text not null check (source in ('trial_balance','general_ledger','electronic_cash','electronic_credit','electronic_liability','ecrrs','rcm_statement','fixed_asset_register')),
  ledger_name text not null,
  ledger_group text,
  tax_head text,                         -- IGST, CGST, SGST, CESS
  period date,
  opening numeric(18,2) not null default 0,
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  closing numeric(18,2) not null default 0,
  extra jsonb not null default '{}'
);
create index ledger_balances_eng_idx on public.ledger_balances(engagement_id, source) where is_current;
