-- =====================================================================================
-- HIRA GST Audit 360° — make your Supabase login the Super Administrator.
-- First: Supabase → Authentication → Users → Add user → Create new user
--        (your email + a strong password, tick "Auto Confirm User").
-- Then:  change the email below if needed, paste into SQL Editor and Run. Safe to run again.
-- =====================================================================================
do $$
declare
  v_email text := 'prakash.patil@hiraassociates.in';   -- the login you created in Authentication
  v_uid uuid;
  v_org uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then raise exception 'No Supabase Auth user with email %. Create it under Authentication → Users first.', v_email; end if;
  select id into v_org from public.organisations where slug = 'hira';
  if v_org is null then raise exception 'Run supabase/setup.sql first.'; end if;
  insert into public.users (id, email, full_name, designation) values (v_uid, lower(v_email), 'Prakash Patil', 'GST Consultant')
    on conflict (id) do update set full_name = excluded.full_name;
  insert into public.memberships (organisation_id, user_id, role_code) values (v_org, v_uid, 'super_admin') on conflict do nothing;
  raise notice 'Super Administrator linked: %', v_email;
end $$;
