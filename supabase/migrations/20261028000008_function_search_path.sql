-- Pin search_path on the remaining helper and trigger functions (Supabase security advisor:
-- "function_search_path_mutable"). Behaviour is unchanged; name resolution can no longer be
-- influenced by a caller's search_path.
alter function app.check_gstin_pan()          set search_path = public, app, pg_temp;
alter function app.guard_approval()           set search_path = public, app, pg_temp;
alter function app.guard_locked_observation() set search_path = public, app, pg_temp;
alter function app.guard_report_version()     set search_path = public, app, pg_temp;
alter function app.my_admin_org_ids()         set search_path = public, app, pg_temp;
alter function app.my_manager_org_ids()       set search_path = public, app, pg_temp;
alter function app.my_staff_org_ids()         set search_path = public, app, pg_temp;
alter function app.prevent_mutation()         set search_path = public, app, pg_temp;
alter function app.touch_updated_at()         set search_path = public, app, pg_temp;
alter function app.uid()                      set search_path = public, app, pg_temp;
