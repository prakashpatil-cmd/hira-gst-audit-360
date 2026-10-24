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
