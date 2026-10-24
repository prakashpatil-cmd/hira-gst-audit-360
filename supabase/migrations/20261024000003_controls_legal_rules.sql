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
