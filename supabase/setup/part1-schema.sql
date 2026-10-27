-- HIRA GST Audit 360° — Supabase setup, part 1 of 5: database structure, security rules and storage bucket (run once)
-- Supabase → SQL Editor → New query → paste ALL of this file → Run. Then run part 2 if there is one.

-- ---- 20261024000001_core_tenancy.sql ----
-- HIRA GST Audit 360° — tenancy, users, roles, clients, registrations, engagements
-- All monetary values use numeric(18,2). All timestamps are timestamptz (UTC); the UI renders IST.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Organisations (tenant = audit firm). HIRA Associates is the first tenant;
-- the model supports future multi-firm SaaS use.
-- ---------------------------------------------------------------------------
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  created_at timestamptz not null default now()
);

create table public.system_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  brand jsonb not null default '{}'::jsonb,      -- logo path, colours, firm name, tagline
  report jsonb not null default '{}'::jsonb,     -- footer lines, disclaimer, confidentiality text, signatory
  security jsonb not null default '{}'::jsonb,   -- session timeout, MFA policy, upload limits
  ai jsonb not null default '{"enabled": false, "allow_client_data": false}'::jsonb,
  risk_thresholds jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------------------------------------------------------------------------
-- Users and roles
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  phone text,
  designation text,
  is_active boolean not null default true,
  mfa_enforced boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_touch before update on public.users for each row execute function app.touch_updated_at();

create table public.roles (
  code text primary key check (code in ('super_admin','audit_manager','gst_auditor','audit_assistant','client_user')),
  name text not null,
  description text not null,
  rank int not null,                    -- higher = more authority (used for "at least" checks)
  permissions text[] not null default '{}'
);

insert into public.roles (code, name, description, rank, permissions) values
 ('super_admin','Super Administrator','Full access to all clients and configuration; approves legal rules and signs final reports.',100,
   array['clients.manage','engagements.manage','engagements.assign','users.manage','settings.manage','rules.approve','legal.approve',
         'imports.manage','recon.run','observations.edit','observations.review','observations.approve','reports.generate','reports.approve',
         'reports.sign','logs.view','dashboard.firm','controls.manage','actions.manage','requests.manage']),
 ('audit_manager','Audit Manager','Creates engagements, assigns work, reviews observations and prepares reports for approval.',80,
   array['clients.manage','engagements.manage','engagements.assign','imports.manage','recon.run','observations.edit','observations.review',
         'observations.approve','reports.generate','dashboard.firm','actions.manage','requests.manage','legal.propose','rules.propose']),
 ('gst_auditor','GST Auditor','Uploads data, runs reconciliations, examines exceptions and drafts observations for review.',60,
   array['imports.manage','recon.run','observations.edit','actions.manage','requests.manage','legal.propose']),
 ('audit_assistant','Audit Assistant','Prepares data, uploads files, completes checklists and requests missing records.',40,
   array['imports.manage','checklist.edit','requests.manage']),
 ('client_user','Client User','Client-side user restricted to their own organisation: uploads requested documents and responds to approved observations.',10,
   array['portal.access','portal.respond','portal.upload']);

-- ---------------------------------------------------------------------------
-- Clients, GST registrations, places of business
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  legal_name text not null,
  trade_name text,
  pan char(10) not null check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  cin text,
  constitution text check (constitution in ('private_limited','public_limited','llp','partnership','proprietorship','trust','society','huf','government','foreign_company','other')),
  registered_address text,
  state_code char(2),
  industry text,
  business_activities text[] not null default '{}',
  accounting_software text,
  is_importer boolean not null default false,
  is_exporter boolean not null default false,
  is_merchant_exporter boolean not null default false,
  supplies_to_sez boolean not null default false,
  has_job_work boolean not null default false,
  has_related_party_txns boolean not null default false,
  has_overseas_txns boolean not null default false,
  einvoice_applicable boolean not null default false,
  eway_applicable boolean not null default true,
  isd_applicable boolean not null default false,
  aato_crore numeric(14,2),                       -- aggregate annual turnover, ₹ crore (drives e-invoice/9C applicability)
  contacts jsonb not null default '[]'::jsonb,    -- [{name, designation, email, phone, is_primary}]
  notes text,
  status text not null default 'active' check (status in ('active','inactive','prospect')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, pan)
);
create trigger clients_touch before update on public.clients for each row execute function app.touch_updated_at();

create table public.client_gstins (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  gstin char(15) not null check (gstin ~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$'),
  state_code char(2) not null,
  label text,                                    -- e.g. "Maharashtra — Bhiwandi factory"
  registration_type text not null default 'regular' check (registration_type in
    ('regular','composition','isd','sez_unit','sez_developer','casual','nrtp','tds','tcs','oidar','uin')),
  status text not null default 'active' check (status in ('active','suspended','cancelled','provisional')),
  effective_date date,
  cancellation_date date,
  trade_name text,
  principal_address text,
  jurisdiction_centre text,
  jurisdiction_state text,
  einvoice_applicable_from date,
  isd_effective_from date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, gstin)
);
create index client_gstins_client_idx on public.client_gstins(client_id);
create trigger client_gstins_touch before update on public.client_gstins for each row execute function app.touch_updated_at();

-- GSTIN characters 3-12 must equal the client PAN (except for TDS/UIN/NRTP-style registrations).
create or replace function app.check_gstin_pan() returns trigger language plpgsql as $$
declare v_pan text;
begin
  select pan into v_pan from public.clients where id = new.client_id;
  if new.registration_type not in ('tds','uin','nrtp','oidar') and substr(new.gstin, 3, 10) <> v_pan then
    raise exception 'GSTIN % does not belong to PAN %', new.gstin, v_pan using errcode = '23514';
  end if;
  if new.state_code <> substr(new.gstin, 1, 2) then
    raise exception 'State code % does not match GSTIN %', new.state_code, new.gstin using errcode = '23514';
  end if;
  return new;
end $$;
create trigger client_gstins_pan_check before insert or update on public.client_gstins
  for each row execute function app.check_gstin_pan();

create table public.business_locations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id) on delete set null,
  name text not null,
  location_type text not null check (location_type in
    ('principal','additional','factory','warehouse','depot','branch','job_worker','sez_unit','ftwz','office','temporary')),
  address text,
  state_code char(2),
  pincode char(6),
  is_registered_on_portal boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index business_locations_client_idx on public.business_locations(client_id);

-- ---------------------------------------------------------------------------
-- Memberships: user ↔ organisation (+ client for client users)
-- ---------------------------------------------------------------------------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role_code text not null references public.roles(code),
  client_id uuid references public.clients(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((role_code = 'client_user') = (client_id is not null))
);
create unique index memberships_unique on public.memberships(organisation_id, user_id, coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index memberships_user_idx on public.memberships(user_id) where is_active;

create table public.login_events (
  id bigint generated always as identity primary key,
  user_id uuid,
  email text,
  event text not null check (event in ('login_success','login_failure','logout','mfa_success','mfa_failure','password_reset_requested','password_reset_completed','session_expired','account_locked')),
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index login_events_user_idx on public.login_events(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Engagements
-- ---------------------------------------------------------------------------
create table public.audit_engagements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  engagement_code text not null,
  title text not null,
  financial_year text not null check (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  period_from date not null,
  period_to date not null,
  audit_type text not null default 'health_check' check (audit_type in
    ('health_check','annual_return_review','pre_departmental_audit','notice_support','special_review','refund_review')),
  scope text,
  exclusions text,
  status text not null default 'planning' check (status in
    ('planning','data_collection','reconciliation','drafting','internal_review','client_discussion','finalisation','follow_up','closed')),
  audit_visits jsonb not null default '[]'::jsonb,   -- [{location_id, label, from, to}]
  data_request_date date,
  completion_deadline date,
  report_issue_date date,
  engagement_partner_id uuid references public.users(id),
  reviewing_manager_id uuid references public.users(id),
  materiality_amount numeric(18,2) not null default 10000,
  tolerance_amount numeric(18,2) not null default 1.00,   -- per-document rounding tolerance (₹)
  rule_snapshot_at timestamptz,                            -- when rule versions were pinned
  locked_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, engagement_code),
  check (period_to >= period_from)
);
create index audit_engagements_client_idx on public.audit_engagements(client_id);
create trigger audit_engagements_touch before update on public.audit_engagements for each row execute function app.touch_updated_at();

create table public.engagement_gstins (
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_gstin_id uuid not null references public.client_gstins(id) on delete restrict,
  primary key (engagement_id, client_gstin_id)
);

create table public.engagement_locations (
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  location_id uuid not null references public.business_locations(id) on delete restrict,
  part_label text,                                   -- e.g. "Part A — Bhiwandi"
  primary key (engagement_id, location_id)
);

create table public.audit_assignments (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  engagement_role text not null check (engagement_role in ('partner','manager','auditor','assistant')),
  modules text[] not null default '{}',              -- audit modules A..Q assigned
  assigned_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (engagement_id, user_id)
);
create index audit_assignments_user_idx on public.audit_assignments(user_id);

-- ---- 20261024000002_data_imports.sql ----
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

-- ---- 20261024000003_controls_legal_rules.sql ----
-- Audit control library (versioned), legal research library, calculation rule engine.

create table public.legal_references (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                  -- e.g. CGST-ACT-S16-4
  source_type text not null check (source_type in ('act','rule','notification','circular','order','advisory','judgment','council','instruction','other')),
  title text not null,
  provision text,                             -- "Section 16(4)"
  statute text,                               -- "CGST Act, 2017"
  jurisdiction text not null default 'central',
  source_url text,                            -- official URL only; null when not yet verified
  notification_no text,
  publication_date date,
  effective_from date,
  effective_to date,
  applicable_fys text[] not null default '{}',
  summary text,
  amendment_history jsonb not null default '[]',
  legal_status text not null default 'effective' check (legal_status in ('proposed','enacted_not_effective','effective','superseded','omitted')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified','verified','legal_review_required')),
  verified_at timestamptz,
  verified_by uuid references public.users(id),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger legal_references_touch before update on public.legal_references for each row execute function app.touch_updated_at();

create table public.audit_controls (
  id text primary key check (id ~ '^[A-Q]-[A-Z0-9]{2,8}-[0-9]{2,3}$'),   -- e.g. C-ITC-004
  module char(1) not null check (module between 'A' and 'Q'),
  category text not null,
  title text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.control_versions (
  id uuid primary key default gen_random_uuid(),
  control_id text not null references public.audit_controls(id) on delete cascade,
  version int not null,
  effective_from date not null default '2017-07-01',
  effective_to date,
  applicable_fys text[] not null default '{}',     -- empty = all
  taxpayer_classes text[] not null default '{}',   -- empty = all; e.g. exporter, manufacturer, isd
  objective text not null,
  law_refs text[] not null default '{}',           -- legal_references.code
  required_data text[] not null default '{}',      -- dataset types
  procedure text not null,
  automation jsonb,                                -- {"engine":"recon","type":"PR_2B_3B"} | {"engine":"check","key":"eway_cess"}
  expected_result text not null,
  exception_conditions text not null,
  risk_level text not null check (risk_level in ('critical','high','medium','low')),
  exposure_basis text,
  evidence_required text[] not null default '{}',
  corrective_action text not null,
  signoff_role text not null default 'audit_manager',
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','retired')),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (control_id, version)
);
create index control_versions_control_idx on public.control_versions(control_id, status);

-- Calculation rules (interest, limitation, penalty, thresholds) — administrator console.
create table public.rule_definitions (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null,                       -- e.g. INT-S50-1
  version int not null,
  module char(1),
  title text not null,
  taxpayer_classes text[] not null default '{}',
  effective_from date not null,
  effective_to date,
  legal_basis text[] not null default '{}',      -- legal_references.code
  input_fields jsonb not null default '[]',
  conditions jsonb not null default '{}',
  calc_method text not null,                     -- engine function name
  params jsonb not null default '{}',            -- e.g. {"rate_pa": 18}
  severity text check (severity in ('critical','high','medium','low')),
  tolerances jsonb not null default '{}',
  evidence_requirements text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','retired')),
  proposed_by uuid references public.users(id),
  reviewed_by uuid references public.users(id),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  change_note text,
  created_at timestamptz not null default now(),
  unique (rule_code, version)
);

-- Rule and control versions pinned to an engagement, so later changes never alter
-- the basis of an engagement already in progress or a finalised report.
create table public.engagement_rule_pins (
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  rule_definition_id uuid references public.rule_definitions(id),
  control_version_id uuid references public.control_versions(id),
  pinned_at timestamptz not null default now(),
  check ((rule_definition_id is null) <> (control_version_id is null))
);
create unique index engagement_rule_pins_rule on public.engagement_rule_pins(engagement_id, rule_definition_id) where rule_definition_id is not null;
create unique index engagement_rule_pins_ctrl on public.engagement_rule_pins(engagement_id, control_version_id) where control_version_id is not null;

create table public.audit_test_results (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  control_id text not null references public.audit_controls(id),
  control_version_id uuid not null references public.control_versions(id),
  client_gstin_id uuid references public.client_gstins(id),
  status text not null default 'not_started' check (status in
    ('not_started','data_awaited','in_progress','passed','exception_detected','under_investigation',
     'pending_client','pending_review','confirmed_observation','resolved','closed','not_applicable')),
  applicability_note text,
  work_performed text,
  conclusion text,
  evidence_document_ids uuid[] not null default '{}',
  exceptions_count int not null default 0,
  assigned_to uuid references public.users(id),
  tested_by uuid references public.users(id),
  tested_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (engagement_id, control_id, client_gstin_id)
);
create unique index audit_test_results_entity on public.audit_test_results(engagement_id, control_id) where client_gstin_id is null;
create trigger audit_test_results_touch before update on public.audit_test_results for each row execute function app.touch_updated_at();

-- ---- 20261024000004_recon_observations_reports.sql ----
-- Reconciliation runs, exceptions, observations, evidence, calculations, review,
-- corrective actions, reports, requests, notices, jobs and audit logs.

create table public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  recon_type text not null check (recon_type in
    ('BOOKS_GSTR1','GSTR1_GSTR3B','PR_2B_3B','EINV_GSTR1_BOOKS','EWB_SALES','IMPORT_EXPORT','TB_RETURNS','SPECIAL_CHECKS')),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','superseded')),
  params jsonb not null default '{}',
  input_import_ids uuid[] not null default '{}',
  input_hash text,                        -- hash of the inputs: identical inputs ⇒ identical results
  engine_version text not null,
  summary jsonb,
  error text,
  is_current boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index reconciliation_runs_eng_idx on public.reconciliation_runs(engagement_id, recon_type, created_at desc);

create table public.reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
  engagement_id uuid not null,
  match_key text not null,
  match_status text not null,             -- matched, matched_tolerance, matched_fuzzy, value_mismatch, ...
  match_method text,                      -- exact, normalised, fuzzy, aggregate, manual
  counterparty_gstin text,
  doc_no text,
  doc_date date,
  period date,
  left_ids uuid[] not null default '{}',  -- source_transactions on side A
  right_ids uuid[] not null default '{}', -- source_transactions on side B
  third_ids uuid[] not null default '{}', -- source_transactions on side C (3-way)
  left_values jsonb,
  right_values jsonb,
  third_values jsonb,
  diff jsonb,
  is_manual boolean not null default false,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  note text
);
create index reconciliation_matches_run_idx on public.reconciliation_matches(run_id, match_status);

create table public.audit_observations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  client_gstin_id uuid references public.client_gstins(id),
  location_id uuid references public.business_locations(id),
  obs_number int not null,
  part_label text,
  module char(1) check (module between 'A' and 'Q'),
  control_id text references public.audit_controls(id),
  category text not null,
  title text not null,
  observation_text text not null default '',      -- A. Observation
  legal_framework text not null default '',       -- B. Legal framework
  legal_reference_codes text[] not null default '{}',
  financial_implication text not null default '', -- C.
  root_cause text not null default '',            -- D.
  action_required text not null default '',       -- E.
  preventive_control text not null default '',    -- F.
  risk_grade text not null check (risk_grade in ('critical','high','medium','low','opportunity')),
  classification text not null default 'requires_investigation' check (classification in
    ('confirmed','probable','requires_investigation','documentary_deficiency','potential_opportunity','not_applicable','resolved')),
  confidence text not null default 'medium' check (confidence in ('high','medium','low')),
  -- Financial impact. Buckets follow the report's "Financial Impact at a Glance".
  impact_bucket text check (impact_bucket in
    ('A_ITC_REVERSAL','B_RCM_OUTPUT_SHORTFALL','C_CREDIT_NOTE','D_OTHER_LIABILITY','E_ITC_REAVAILABLE','F_CONTINGENT','G_RECOVERABLE','H_CASH_TRANSFER','NONE')),
  is_quantified boolean not null default false,
  tax_amount numeric(18,2) not null default 0,       -- quantified tax (never includes unquantified values)
  igst numeric(18,2) not null default 0,
  cgst numeric(18,2) not null default 0,
  sgst numeric(18,2) not null default 0,
  cess numeric(18,2) not null default 0,
  itc_reavailable numeric(18,2) not null default 0,  -- credit re-available on discharge (e.g. RCM)
  interest_amount numeric(18,2) not null default 0,
  penalty_amount numeric(18,2) not null default 0,   -- potential, disclosed separately
  recoverable_amount numeric(18,2) not null default 0,
  contingent_amount numeric(18,2) not null default 0,
  affected_value numeric(18,2),                      -- e.g. turnover affected (not tax)
  impact_text text,                                  -- e.g. "To be quantified", "Refund opportunity"
  interest_from date,
  status text not null default 'draft' check (status in
    ('draft','pending_review','changes_requested','approved','shared_with_client','client_responded','final','resolved','closed')),
  workflow_status text not null default 'in_progress' check (workflow_status in
    ('not_started','data_awaited','in_progress','exception_detected','under_investigation','pending_client','pending_review',
     'confirmed_observation','resolved','closed','not_applicable')),
  responsible_user_id uuid references public.users(id),
  action_owner_name text,
  target_date date,
  is_repeat boolean not null default false,
  ai_generated boolean not null default false,
  ai_approved_by uuid references public.users(id),
  source_exception_ids uuid[] not null default '{}',
  calc_snapshot_id uuid,
  locked boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (engagement_id, obs_number)
);
create index audit_observations_eng_idx on public.audit_observations(engagement_id, status);
create trigger audit_observations_touch before update on public.audit_observations for each row execute function app.touch_updated_at();

create table public.reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  recon_type text not null,
  exception_type text not null,           -- MISSING_IN_GSTR1, CLAIMED_NOT_IN_2B, EWB_TAX_IN_CESS, ...
  module char(1),
  control_id text,
  severity text not null check (severity in ('critical','high','medium','low','opportunity')),
  match_id uuid references public.reconciliation_matches(id) on delete set null,
  doc_no text,
  doc_date date,
  counterparty_gstin text,
  counterparty_name text,
  period date,
  description text not null,
  diff_taxable numeric(18,2) not null default 0,
  diff_igst numeric(18,2) not null default 0,
  diff_cgst numeric(18,2) not null default 0,
  diff_sgst numeric(18,2) not null default 0,
  diff_cess numeric(18,2) not null default 0,
  diff_tax numeric(18,2) not null default 0,
  source_ids uuid[] not null default '{}',
  status text not null default 'open' check (status in ('open','under_investigation','explained','converted','not_an_issue')),
  classification text check (classification in
    ('confirmed','probable','requires_investigation','documentary_deficiency','potential_opportunity','not_applicable','resolved')),
  assigned_to uuid references public.users(id),
  observation_id uuid references public.audit_observations(id) on delete set null,
  resolution_note text,
  resolved_by uuid references public.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index reconciliation_exceptions_eng_idx on public.reconciliation_exceptions(engagement_id, status, severity);
create index reconciliation_exceptions_run_idx on public.reconciliation_exceptions(run_id);

create table public.observation_evidence (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.audit_observations(id) on delete cascade,
  engagement_id uuid not null,
  source_document_id uuid references public.source_documents(id),
  source_transaction_ids uuid[] not null default '{}',
  description text not null,
  added_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index observation_evidence_obs_idx on public.observation_evidence(observation_id);

-- Immutable calculation snapshots.
create table public.financial_calculations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  observation_id uuid references public.audit_observations(id) on delete set null,
  calc_type text not null,                -- tax_on_value, interest_s50, rcm, s18_6, penalty, limitation
  inputs jsonb not null,
  outputs jsonb not null,
  rule_code text,
  rule_version int,
  engine_version text not null,
  input_hash char(64) not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index financial_calculations_obs_idx on public.financial_calculations(observation_id);
alter table public.audit_observations add constraint audit_observations_calc_fk
  foreign key (calc_snapshot_id) references public.financial_calculations(id) on delete set null;

create or replace function app.prevent_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and tg_table_name = 'financial_calculations' then
    -- linking a snapshot to an observation is allowed; its content is not
    if (new.inputs, new.outputs, new.input_hash, new.calc_type) is not distinct from (old.inputs, old.outputs, old.input_hash, old.calc_type) then
      return new;
    end if;
  end if;
  raise exception '% rows are immutable', tg_table_name using errcode = '42501';
end $$;
create trigger financial_calculations_immutable before update or delete on public.financial_calculations
  for each row when (pg_trigger_depth() = 0) execute function app.prevent_mutation();

create table public.management_responses (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.audit_observations(id) on delete cascade,
  engagement_id uuid not null,
  response_text text not null,
  responder_user_id uuid references public.users(id),
  responder_name text,
  response_date date not null default current_date,
  attachment_ids uuid[] not null default '{}',
  status text not null default 'submitted' check (status in ('submitted','accepted','rejected','approved_for_report')),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index management_responses_obs_idx on public.management_responses(observation_id);

create table public.review_approvals (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid references public.audit_engagements(id) on delete cascade,
  entity_type text not null check (entity_type in
    ('observation','report','test_result','reconciliation_match','exception','control_version','legal_reference','rule_definition','import')),
  entity_id uuid not null,
  action text not null check (action in ('submit','approve','reject','request_changes','comment','sign','reopen')),
  comment text,
  actor_id uuid not null references public.users(id),
  created_at timestamptz not null default now()
);
create index review_approvals_entity_idx on public.review_approvals(entity_type, entity_id, created_at);

create table public.corrective_actions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  observation_id uuid references public.audit_observations(id) on delete cascade,
  title text not null,
  description text,
  owner_user_id uuid references public.users(id),
  owner_name text,
  priority int not null default 3 check (priority between 1 and 5),
  due_date date,
  statutory_deadline date,
  amount numeric(18,2),
  amount_label text,
  compliance_step text,                    -- DRC-03, PMT-09, GSTR-1 amendment, ...
  status text not null default 'open' check (status in ('open','in_progress','completed','verified','cancelled')),
  completion_note text,
  completion_document_ids uuid[] not null default '{}',
  completed_at timestamptz,
  verified_by uuid references public.users(id),
  verified_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index corrective_actions_eng_idx on public.corrective_actions(engagement_id, status);
create trigger corrective_actions_touch before update on public.corrective_actions for each row execute function app.touch_updated_at();

create table public.report_versions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  version int not null,
  label text not null default 'DRAFT' check (label in ('DRAFT','FINAL')),
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','issued','superseded')),
  content jsonb not null default '{}',      -- editable narrative sections
  snapshot jsonb,                           -- frozen observations, figures and calculations
  snapshot_hash char(64),
  pdf_document_id uuid references public.source_documents(id),
  xlsx_document_id uuid references public.source_documents(id),
  revision_note text,
  generated_by uuid references public.users(id),
  generated_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (engagement_id, version)
);

create table public.document_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid not null references public.audit_engagements(id) on delete cascade,
  title text not null,
  description text,
  category text,
  dataset_type text,
  priority text not null default 'normal' check (priority in ('high','normal','low')),
  due_date date,
  assigned_contact text,
  client_user_id uuid references public.users(id),
  status text not null default 'requested' check (status in ('requested','uploaded','accepted','rejected','not_applicable')),
  document_ids uuid[] not null default '{}',
  review_comment text,
  reminder_count int not null default 0,
  last_reminder_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index document_requests_eng_idx on public.document_requests(engagement_id, status);
create trigger document_requests_touch before update on public.document_requests for each row execute function app.touch_updated_at();

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  client_gstin_id uuid references public.client_gstins(id),
  engagement_id uuid references public.audit_engagements(id) on delete set null,
  form_type text not null check (form_type in ('ASMT-10','ASMT-11','ASMT-12','ADT-01','ADT-02','DRC-01A','DRC-01','DRC-03','DRC-06','DRC-07',
                                               'APL-01','APL-02','GSTAT','RFD-08','RFD-09','RFD-06','OTHER')),
  reference_no text,
  issue_date date,
  period_from date,
  period_to date,
  section text,
  subject text,
  demand_tax numeric(18,2) not null default 0,
  demand_interest numeric(18,2) not null default 0,
  demand_penalty numeric(18,2) not null default 0,
  response_due date,
  hearing_date date,
  order_date date,
  appeal_due date,
  pre_deposit numeric(18,2) not null default 0,
  amount_paid numeric(18,2) not null default 0,
  status text not null default 'open' check (status in ('open','replied','hearing','order_passed','appealed','closed')),
  observation_ids uuid[] not null default '{}',
  document_ids uuid[] not null default '{}',
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table public.observation_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  module char(1),
  control_id text references public.audit_controls(id),
  category text not null,
  title text not null,
  observation_text text not null,
  legal_framework text not null,
  legal_reference_codes text[] not null default '{}',
  action_required text not null,
  preventive_control text not null default '',
  risk_grade text not null,
  impact_bucket text,
  industries text[] not null default '{}',
  tags text[] not null default '{}',
  is_approved boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

-- Durable job queue (processed by scripts/worker.ts and by the cron endpoint).
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  engagement_id uuid references public.audit_engagements(id) on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}',
  idempotency_key text unique,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  progress int not null default 0 check (progress between 0 and 100),
  progress_message text,
  result jsonb,
  error text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_queue_idx on public.jobs(status, run_after) where status = 'queued';
create index jobs_eng_idx on public.jobs(engagement_id, created_at desc);

-- Append-only activity log.
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organisation_id uuid,
  engagement_id uuid,
  actor_id uuid,
  action text not null,                  -- insert, update, delete, approve, export, download, login...
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs(organisation_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);
create index audit_logs_eng_idx on public.audit_logs(engagement_id, created_at desc);
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function app.prevent_mutation();

-- ---- 20261024000005_rls_and_audit.sql ----
-- Row Level Security, access helper functions, audit logging and locking triggers.
-- Principle: every row is reachable only through an organisation membership; staff below
-- manager level see only engagements they are assigned to; client users see only their own
-- client and only material the firm has released to them.

-- ---------------------------------------------------------------------------
-- Access helpers (SECURITY DEFINER so they can read memberships without recursion)
-- ---------------------------------------------------------------------------
create or replace function app.uid() returns uuid language sql stable as $$ select auth.uid() $$;

create or replace function app.my_org_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct m.organisation_id), '{}')
  from memberships m join users u on u.id = m.user_id
  where m.user_id = auth.uid() and m.is_active and u.is_active
$$;

-- Organisations in which the caller holds one of the given firm roles.
create or replace function app.orgs_with_role(p_roles text[]) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct m.organisation_id), '{}')
  from memberships m join users u on u.id = m.user_id
  where m.user_id = auth.uid() and m.is_active and u.is_active and m.role_code = any(p_roles)
$$;

create or replace function app.my_staff_org_ids() returns uuid[] language sql stable as $$
  select app.orgs_with_role(array['super_admin','audit_manager','gst_auditor','audit_assistant'])
$$;
create or replace function app.my_manager_org_ids() returns uuid[] language sql stable as $$
  select app.orgs_with_role(array['super_admin','audit_manager'])
$$;
create or replace function app.my_admin_org_ids() returns uuid[] language sql stable as $$
  select app.orgs_with_role(array['super_admin'])
$$;

-- Engagements visible to firm staff.
create or replace function app.my_staff_engagement_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct e.id), '{}') from audit_engagements e
  where e.organisation_id = any(app.my_manager_org_ids())
     or (e.organisation_id = any(app.my_staff_org_ids())
         and exists (select 1 from audit_assignments a where a.engagement_id = e.id and a.user_id = auth.uid()))
$$;

-- Clients whose user the caller is (client portal users).
create or replace function app.my_portal_client_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct m.client_id), '{}')
  from memberships m join users u on u.id = m.user_id
  where m.user_id = auth.uid() and m.is_active and u.is_active and m.role_code = 'client_user'
$$;

create or replace function app.my_portal_engagement_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(e.id), '{}') from audit_engagements e
  where e.client_id = any(app.my_portal_client_ids())
$$;

-- Clients visible to staff: managers/admins see all clients of their organisation;
-- auditors/assistants see clients of engagements they are assigned to.
create or replace function app.my_staff_client_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct c.id), '{}') from clients c
  where c.organisation_id = any(app.my_manager_org_ids())
     or exists (select 1 from audit_engagements e where e.client_id = c.id and e.id = any(app.my_staff_engagement_ids()))
$$;

create or replace function app.is_manager_of_engagement(p_engagement uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from audit_engagements e where e.id = p_engagement and e.organisation_id = any(app.my_manager_org_ids()))
      or exists (select 1 from audit_assignments a where a.engagement_id = p_engagement and a.user_id = auth.uid()
                 and a.engagement_role in ('partner','manager'))
$$;

grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants (RLS does the filtering)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.roles to authenticated;
revoke insert, update, delete on public.roles from authenticated;
revoke update, delete on public.audit_logs from authenticated;
revoke update, delete on public.financial_calculations from authenticated;
grant update (observation_id) on public.financial_calculations to authenticated;
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to authenticated, service_role;

-- Enable RLS everywhere
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Policies: organisation-level tables
-- ---------------------------------------------------------------------------
create policy org_select on public.organisations for select to authenticated
  using (id = any((select app.my_org_ids())::uuid[]));
create policy org_update on public.organisations for update to authenticated
  using (id = any((select app.my_admin_org_ids())::uuid[]));

create policy settings_select on public.system_settings for select to authenticated
  using (organisation_id = any((select app.my_org_ids())::uuid[]));
create policy settings_write on public.system_settings for all to authenticated
  using (organisation_id = any((select app.my_admin_org_ids())::uuid[]))
  with check (organisation_id = any((select app.my_admin_org_ids())::uuid[]));

create policy roles_select on public.roles for select to authenticated using (true);

create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from memberships m where m.user_id = users.id and m.organisation_id = any((select app.my_staff_org_ids())::uuid[])));
create policy users_update_self on public.users for update to authenticated
  using (id = auth.uid() or exists (
    select 1 from memberships m where m.user_id = users.id and m.organisation_id = any((select app.my_admin_org_ids())::uuid[])));

create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or organisation_id = any((select app.my_staff_org_ids())::uuid[]));
create policy memberships_write on public.memberships for all to authenticated
  using (organisation_id = any((select app.my_admin_org_ids())::uuid[]))
  with check (organisation_id = any((select app.my_admin_org_ids())::uuid[]));

create policy login_events_select on public.login_events for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from memberships m where m.user_id = login_events.user_id and m.organisation_id = any((select app.my_admin_org_ids())::uuid[])));

-- ---------------------------------------------------------------------------
-- Clients, registrations, locations
-- ---------------------------------------------------------------------------
create policy clients_select on public.clients for select to authenticated
  using (id = any((select app.my_staff_client_ids())::uuid[]) or id = any((select app.my_portal_client_ids())::uuid[]));
create policy clients_insert on public.clients for insert to authenticated
  with check (organisation_id = any((select app.my_manager_org_ids())::uuid[]));
create policy clients_update on public.clients for update to authenticated
  using (organisation_id = any((select app.my_manager_org_ids())::uuid[]));
create policy clients_delete on public.clients for delete to authenticated
  using (organisation_id = any((select app.my_admin_org_ids())::uuid[]));

create policy gstins_select on public.client_gstins for select to authenticated
  using (client_id = any((select app.my_staff_client_ids())::uuid[]) or client_id = any((select app.my_portal_client_ids())::uuid[]));
create policy gstins_write on public.client_gstins for all to authenticated
  using (organisation_id = any((select app.my_manager_org_ids())::uuid[]))
  with check (organisation_id = any((select app.my_manager_org_ids())::uuid[]));

create policy locations_select on public.business_locations for select to authenticated
  using (client_id = any((select app.my_staff_client_ids())::uuid[]) or client_id = any((select app.my_portal_client_ids())::uuid[]));
create policy locations_write on public.business_locations for all to authenticated
  using (organisation_id = any((select app.my_manager_org_ids())::uuid[]))
  with check (organisation_id = any((select app.my_manager_org_ids())::uuid[]));

create policy notices_staff on public.notices for all to authenticated
  using (client_id = any((select app.my_staff_client_ids())::uuid[]))
  with check (client_id = any((select app.my_staff_client_ids())::uuid[]));

-- ---------------------------------------------------------------------------
-- Engagements
-- ---------------------------------------------------------------------------
create policy engagements_select on public.audit_engagements for select to authenticated
  using (id = any((select app.my_staff_engagement_ids())::uuid[]) or id = any((select app.my_portal_engagement_ids())::uuid[]));
create policy engagements_insert on public.audit_engagements for insert to authenticated
  with check (organisation_id = any((select app.my_manager_org_ids())::uuid[]));
create policy engagements_update on public.audit_engagements for update to authenticated
  using (app.is_manager_of_engagement(id));
create policy engagements_delete on public.audit_engagements for delete to authenticated
  using (organisation_id = any((select app.my_admin_org_ids())::uuid[]));

create policy eng_gstins_select on public.engagement_gstins for select to authenticated
  using (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]) or engagement_id = any((select app.my_portal_engagement_ids())::uuid[]));
create policy eng_gstins_write on public.engagement_gstins for all to authenticated
  using (app.is_manager_of_engagement(engagement_id)) with check (app.is_manager_of_engagement(engagement_id));

create policy eng_locations_select on public.engagement_locations for select to authenticated
  using (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]) or engagement_id = any((select app.my_portal_engagement_ids())::uuid[]));
create policy eng_locations_write on public.engagement_locations for all to authenticated
  using (app.is_manager_of_engagement(engagement_id)) with check (app.is_manager_of_engagement(engagement_id));

create policy assignments_select on public.audit_assignments for select to authenticated
  using (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]));
create policy assignments_write on public.audit_assignments for all to authenticated
  using (app.is_manager_of_engagement(engagement_id)) with check (app.is_manager_of_engagement(engagement_id));

-- ---------------------------------------------------------------------------
-- Staff-only engagement working tables
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array[
    'data_imports','source_transactions','sales_invoices','purchase_invoices','credit_notes','debit_notes',
    'gst_returns','gst_return_lines','einvoices','eway_bills','bills_of_entry','shipping_bills','ledger_balances',
    'reconciliation_runs','reconciliation_matches','reconciliation_exceptions','audit_test_results',
    'financial_calculations','observation_evidence','engagement_rule_pins','jobs']
  loop
    execute format($p$create policy %1$s_staff_select on public.%1$I for select to authenticated
      using (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]))$p$, t);
    execute format($p$create policy %1$s_staff_insert on public.%1$I for insert to authenticated
      with check (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]))$p$, t);
    execute format($p$create policy %1$s_staff_update on public.%1$I for update to authenticated
      using (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]))$p$, t);
    execute format($p$create policy %1$s_mgr_delete on public.%1$I for delete to authenticated
      using (app.is_manager_of_engagement(engagement_id))$p$, t);
  end loop;
end $$;

create policy review_approvals_select on public.review_approvals for select to authenticated
  using (organisation_id = any((select app.my_staff_org_ids())::uuid[])
         and (engagement_id is null or engagement_id = any((select app.my_staff_engagement_ids())::uuid[])));
create policy review_approvals_insert on public.review_approvals for insert to authenticated
  with check (actor_id = auth.uid() and organisation_id = any((select app.my_staff_org_ids())::uuid[])
              and (engagement_id is null or engagement_id = any((select app.my_staff_engagement_ids())::uuid[])));

-- ---------------------------------------------------------------------------
-- Tables shared with the client portal (released material only)
-- ---------------------------------------------------------------------------
create policy source_documents_staff on public.source_documents for all to authenticated
  using (client_id = any((select app.my_staff_client_ids())::uuid[])
         and (engagement_id is null or engagement_id = any((select app.my_staff_engagement_ids())::uuid[])))
  with check (client_id = any((select app.my_staff_client_ids())::uuid[])
         and (engagement_id is null or engagement_id = any((select app.my_staff_engagement_ids())::uuid[])));
create policy source_documents_portal_select on public.source_documents for select to authenticated
  using (client_id = any((select app.my_portal_client_ids())::uuid[]) and deleted_at is null
         and (kind = 'client_upload' or (kind in ('report','annexure') and exists (
              select 1 from report_versions r where r.status = 'issued' and (r.pdf_document_id = source_documents.id or r.xlsx_document_id = source_documents.id)))));
create policy source_documents_portal_insert on public.source_documents for insert to authenticated
  with check (client_id = any((select app.my_portal_client_ids())::uuid[]) and kind = 'client_upload' and uploaded_by = auth.uid());

create policy observations_staff on public.audit_observations for select to authenticated
  using (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]));
create policy observations_staff_insert on public.audit_observations for insert to authenticated
  with check (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]));
create policy observations_staff_update on public.audit_observations for update to authenticated
  using (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]));
create policy observations_mgr_delete on public.audit_observations for delete to authenticated
  using (app.is_manager_of_engagement(engagement_id) and status in ('draft','changes_requested'));
create policy observations_portal on public.audit_observations for select to authenticated
  using (engagement_id = any((select app.my_portal_engagement_ids())::uuid[])
         and status in ('shared_with_client','client_responded','final','resolved','closed'));

create policy responses_staff on public.management_responses for all to authenticated
  using (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]))
  with check (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]));
create policy responses_portal_select on public.management_responses for select to authenticated
  using (engagement_id = any((select app.my_portal_engagement_ids())::uuid[]));
create policy responses_portal_insert on public.management_responses for insert to authenticated
  with check (engagement_id = any((select app.my_portal_engagement_ids())::uuid[]) and responder_user_id = auth.uid()
              and status = 'submitted'
              and exists (select 1 from audit_observations o where o.id = observation_id
                          and o.status in ('shared_with_client','client_responded')));

create policy actions_staff on public.corrective_actions for all to authenticated
  using (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]))
  with check (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]));
create policy actions_portal_select on public.corrective_actions for select to authenticated
  using (engagement_id = any((select app.my_portal_engagement_ids())::uuid[])
         and exists (select 1 from audit_observations o where o.id = observation_id
                     and o.status in ('shared_with_client','client_responded','final','resolved','closed')));
create policy actions_portal_update on public.corrective_actions for update to authenticated
  using (engagement_id = any((select app.my_portal_engagement_ids())::uuid[]) and owner_user_id = auth.uid());

create policy requests_staff on public.document_requests for all to authenticated
  using (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]))
  with check (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]));
create policy requests_portal_select on public.document_requests for select to authenticated
  using (engagement_id = any((select app.my_portal_engagement_ids())::uuid[]));
create policy requests_portal_update on public.document_requests for update to authenticated
  using (engagement_id = any((select app.my_portal_engagement_ids())::uuid[]));

create policy reports_staff on public.report_versions for all to authenticated
  using (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]))
  with check (engagement_id = any((select app.my_staff_engagement_ids())::uuid[]));
create policy reports_portal on public.report_versions for select to authenticated
  using (engagement_id = any((select app.my_portal_engagement_ids())::uuid[]) and status = 'issued');

-- ---------------------------------------------------------------------------
-- Knowledge tables (firm-wide). Staff may propose; only Super Administrators approve.
-- ---------------------------------------------------------------------------
create policy legal_select on public.legal_references for select to authenticated
  using (cardinality((select app.my_staff_org_ids())) > 0);
create policy legal_insert on public.legal_references for insert to authenticated
  with check (cardinality((select app.my_staff_org_ids())) > 0 and approval_status = 'pending');
create policy legal_update on public.legal_references for update to authenticated
  using (cardinality((select app.my_admin_org_ids())) > 0 or (created_by = auth.uid() and approval_status = 'pending'));

create policy controls_select on public.audit_controls for select to authenticated
  using (cardinality((select app.my_staff_org_ids())) > 0);
create policy controls_write on public.audit_controls for all to authenticated
  using (cardinality((select app.my_admin_org_ids())) > 0) with check (cardinality((select app.my_admin_org_ids())) > 0);

create policy control_versions_select on public.control_versions for select to authenticated
  using (cardinality((select app.my_staff_org_ids())) > 0);
create policy control_versions_insert on public.control_versions for insert to authenticated
  with check (cardinality((select app.my_manager_org_ids())) > 0 and status in ('draft','pending_approval'));
create policy control_versions_update on public.control_versions for update to authenticated
  using (cardinality((select app.my_admin_org_ids())) > 0 or (created_by = auth.uid() and status in ('draft','pending_approval')));

create policy rules_select on public.rule_definitions for select to authenticated
  using (cardinality((select app.my_staff_org_ids())) > 0);
create policy rules_insert on public.rule_definitions for insert to authenticated
  with check (cardinality((select app.my_manager_org_ids())) > 0 and status in ('draft','pending_approval'));
create policy rules_update on public.rule_definitions for update to authenticated
  using (cardinality((select app.my_admin_org_ids())) > 0 or (proposed_by = auth.uid() and status in ('draft','pending_approval')));

create policy templates_select on public.observation_templates for select to authenticated
  using (organisation_id = any((select app.my_staff_org_ids())::uuid[]));
create policy templates_write on public.observation_templates for all to authenticated
  using (organisation_id = any((select app.my_manager_org_ids())::uuid[]))
  with check (organisation_id = any((select app.my_manager_org_ids())::uuid[]));

create policy import_mappings_all on public.import_mappings for all to authenticated
  using (organisation_id = any((select app.my_staff_org_ids())::uuid[]))
  with check (organisation_id = any((select app.my_staff_org_ids())::uuid[]));

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organisation_id = any((select app.my_admin_org_ids())::uuid[]));
create policy audit_logs_insert on public.audit_logs for insert to authenticated
  with check (actor_id = auth.uid() and organisation_id = any((select app.my_org_ids())::uuid[]));

-- ---------------------------------------------------------------------------
-- Audit trail trigger
-- ---------------------------------------------------------------------------
create or replace function app.log_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_org uuid;
  v_eng uuid;
begin
  v_org := nullif(v_row ->> 'organisation_id', '')::uuid;
  v_eng := case when tg_table_name = 'audit_engagements' then (v_row ->> 'id')::uuid
                else nullif(v_row ->> 'engagement_id', '')::uuid end;
  if v_org is null and v_eng is not null then
    select organisation_id into v_org from audit_engagements where id = v_eng;
  end if;
  if v_org is null and tg_table_name = 'organisations' then v_org := (v_row ->> 'id')::uuid; end if;
  if tg_op = 'UPDATE' and v_new = v_old then return new; end if;
  insert into audit_logs (organisation_id, engagement_id, actor_id, action, entity_type, entity_id, before_data, after_data)
  values (v_org, v_eng, auth.uid(), lower(tg_op), tg_table_name, v_row ->> 'id', v_old, v_new);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array[
    'organisations','system_settings','clients','client_gstins','business_locations','memberships','audit_engagements',
    'engagement_gstins','audit_assignments','data_imports','audit_observations','reconciliation_exceptions','management_responses',
    'corrective_actions','report_versions','audit_test_results','legal_references','control_versions','rule_definitions',
    'document_requests','notices','observation_evidence','import_mappings']
  loop
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I for each row execute function app.log_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Locking rules
-- ---------------------------------------------------------------------------
-- A locked (finalised) observation's content cannot change; only its follow-up status may move forward.
create or replace function app.guard_locked_observation() returns trigger language plpgsql as $$
declare
  v_keys text[] := array['status','workflow_status','updated_at','locked'];
begin
  if old.locked then
    if (to_jsonb(new) - v_keys) is distinct from (to_jsonb(old) - v_keys) then
      raise exception 'Observation % is locked for the final report; reopen it through the review workflow', old.obs_number
        using errcode = '42501';
    end if;
    if new.locked = false and not app.is_manager_of_engagement(old.engagement_id) and auth.uid() is not null then
      raise exception 'Only a manager can unlock an observation' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger audit_observations_lock before update on public.audit_observations
  for each row execute function app.guard_locked_observation();

-- An approved or issued report's frozen snapshot can never be rewritten.
create or replace function app.guard_report_version() returns trigger language plpgsql as $$
begin
  if old.status in ('approved','issued') and (new.snapshot is distinct from old.snapshot
       or new.snapshot_hash is distinct from old.snapshot_hash or new.content is distinct from old.content) then
    raise exception 'Report version % is approved; create a new revision instead', old.version using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status in ('approved','issued') and old.status not in ('approved','issued')
     and auth.uid() is not null and cardinality(app.my_admin_org_ids()) = 0 then
    raise exception 'Only a Super Administrator can approve or issue a report' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger report_versions_guard before update on public.report_versions
  for each row execute function app.guard_report_version();

-- Approval of legal references / rules / controls is restricted to Super Administrators.
create or replace function app.guard_approval() returns trigger language plpgsql as $$
declare v_new jsonb := to_jsonb(new); v_old jsonb := to_jsonb(old);
begin
  if auth.uid() is null then return new; end if;
  if (coalesce(v_new->>'approval_status', v_new->>'status') in ('approved'))
     and (coalesce(v_old->>'approval_status', v_old->>'status') is distinct from 'approved')
     and cardinality(app.my_admin_org_ids()) = 0 then
    raise exception 'Only a Super Administrator can approve %', tg_table_name using errcode = '42501';
  end if;
  return new;
end $$;
create trigger legal_references_approval before update on public.legal_references for each row execute function app.guard_approval();
create trigger control_versions_approval before update on public.control_versions for each row execute function app.guard_approval();
create trigger rule_definitions_approval before update on public.rule_definitions for each row execute function app.guard_approval();

-- ---- 20261024000006_storage.sql ----
-- Private storage bucket for client files (Supabase only; skipped where the storage schema does not exist).
-- Files are never served directly to browsers: the application checks RLS on source_documents
-- and then streams the object using the server-side service key.
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('audit-files', 'audit-files', false, 104857600)
    on conflict (id) do update set public = false;
  end if;
end $$;

-- ---- 20261024000007_rls_insert_returning.sql ----
-- INSERT ... RETURNING must also satisfy the SELECT policy. The id-based helper functions query the
-- table under the statement snapshot and cannot see the row being inserted, so managers creating a
-- client or engagement were refused. Managers/admins already see every client and engagement of their
-- organisation; stating that at organisation level keeps visibility unchanged and lets RETURNING work.
drop policy clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (organisation_id = any((select app.my_manager_org_ids())::uuid[])
         or id = any((select app.my_staff_client_ids())::uuid[])
         or id = any((select app.my_portal_client_ids())::uuid[]));

drop policy engagements_select on public.audit_engagements;
create policy engagements_select on public.audit_engagements for select to authenticated
  using (organisation_id = any((select app.my_manager_org_ids())::uuid[])
         or id = any((select app.my_staff_engagement_ids())::uuid[])
         or id = any((select app.my_portal_engagement_ids())::uuid[]));

create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now());
insert into public.schema_migrations (name) values ('supabase/migrations/20261024000001_core_tenancy.sql') on conflict do nothing;
insert into public.schema_migrations (name) values ('supabase/migrations/20261024000002_data_imports.sql') on conflict do nothing;
insert into public.schema_migrations (name) values ('supabase/migrations/20261024000003_controls_legal_rules.sql') on conflict do nothing;
insert into public.schema_migrations (name) values ('supabase/migrations/20261024000004_recon_observations_reports.sql') on conflict do nothing;
insert into public.schema_migrations (name) values ('supabase/migrations/20261024000005_rls_and_audit.sql') on conflict do nothing;
insert into public.schema_migrations (name) values ('supabase/migrations/20261024000006_storage.sql') on conflict do nothing;
insert into public.schema_migrations (name) values ('supabase/migrations/20261024000007_rls_insert_returning.sql') on conflict do nothing;
alter table public.schema_migrations enable row level security;
