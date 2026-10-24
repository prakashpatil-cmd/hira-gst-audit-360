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
