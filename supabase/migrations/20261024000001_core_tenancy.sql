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
