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
