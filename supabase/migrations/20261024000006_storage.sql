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
