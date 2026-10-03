-- =============================================================================
-- 00010_storage.sql
-- PRIVATE storage buckets. Nothing is public: the letterhead and company stamp are only ever read
-- server-side (service role) when rendering PDFs; users download PDFs through signed URLs / API routes.
--
-- Object path convention:  <organization_id>/<...>
--   branding/<org>/letterhead/v1.pdf
--   branding/<org>/stamp/v1.png
--   documents/<org>/<document_id>/<number>.pdf
--   attachments/<org>/<entity_type>/<entity_id>/<file>
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('branding',    'branding',    false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  ('documents',   'documents',   false, 26214400, array['application/pdf']),
  ('attachments', 'attachments', false, 26214400, null)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Safely extract the organization id from the first path segment (NULL if malformed).
create or replace function public.storage_object_org_id(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

-- branding: admin only (read + write). The PDF renderer reads letterhead/stamp with the service role.
create policy storage_branding_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'branding'
    and public.has_org_role(public.storage_object_org_id(name), array['admin']::public.user_role[])
  );
create policy storage_branding_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'branding'
    and public.has_org_role(public.storage_object_org_id(name), array['admin']::public.user_role[])
  );
create policy storage_branding_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'branding'
    and public.has_org_role(public.storage_object_org_id(name), array['admin']::public.user_role[])
  );
create policy storage_branding_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'branding'
    and public.has_org_role(public.storage_object_org_id(name), array['admin']::public.user_role[])
  );

-- documents: members read; PDFs are written by the server (service role) only.
create policy storage_documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and public.is_org_member(public.storage_object_org_id(name))
  );

-- attachments: members read; writers upload; finance deletes.
create policy storage_attachments_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_org_member(public.storage_object_org_id(name))
  );
create policy storage_attachments_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.has_org_role(public.storage_object_org_id(name), array['admin','accountant','sales']::public.user_role[])
  );
create policy storage_attachments_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_org_role(public.storage_object_org_id(name), array['admin','accountant']::public.user_role[])
  );
