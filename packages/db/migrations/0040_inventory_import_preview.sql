-- Import with a preview (F-022, S7.3). A file is parsed into a preview that nobody but its
-- importer can see; "ยืนยัน import" merges it into the Project's rows (Q-17, Q-18), so the
-- upload that replaced a System at once is gone. Nothing here stores a file: a preview keeps
-- the parsed rows and what the screen shows about them, an import record keeps counts.
--
-- `inventory_previews` is a per-user table (DB-10) inside the Organization: the restrictive
-- guards need both app.tenant_id and app.user_id, and the access policy ties a row to both, so
-- another maintainer or an Owner/Admin reads, confirms and cancels nothing of it (Q-19). A
-- user holds one preview per Project (a new file replaces it) and it lives at most 30 minutes;
-- the check keeps the limit in the database. Removing the Project or the person from the
-- Organization removes the preview. Storage and protection are those of `inventory_rows`:
-- the same database under RLS, with no application-level encryption (R-07, Q-12).
-- `fingerprints` maps each System key of the file to a fingerprint of that System's rows when
-- the preview was made ("absent" when the System did not exist); confirm compares them again
-- under the Project lock and refuses when any differs.

-- `source_line` is the line of the file where the last import wrote the row, which the rejected
-- rows download prints as "แถวในไฟล์". `line_no` stays the row's position in its System (unique
-- per System), because an import appends to Systems that already hold rows. Rows of earlier
-- uploads kept their file line in `line_no`; a row written or edited on the screen has none.
alter table inventory_rows add column source_line integer check (source_line >= 1);
update inventory_rows set source_line = line_no where source_kind = 'import';
grant update (source_line) on inventory_rows to nightwatch;

create table inventory_previews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  created_by text not null,
  file_name text not null check (char_length(file_name) between 1 and 255),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  -- Parsed rows of the file, each with its issues; never the file.
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  -- Counts, per-System counts, listed rows and warnings, as the preview showed them.
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  fingerprints jsonb not null check (jsonb_typeof(fingerprints) = 'object'),
  constraint inventory_previews_ttl check (
    expires_at > created_at and expires_at <= created_at + interval '30 minutes'
  ),
  constraint inventory_previews_user_project_key unique (project_id, created_by),
  foreign key (project_id, tenant_id)
    references projects (id, tenant_id) on delete cascade,
  foreign key (tenant_id, created_by)
    references member (organization_id, user_id) on delete cascade
);

create index inventory_previews_expiry_idx on inventory_previews (expires_at);

alter table inventory_previews enable row level security;
alter table inventory_previews force row level security;

create policy inventory_previews_tenant_context on inventory_previews
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy inventory_previews_user_context on inventory_previews
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.user_id', true), '') is not null)
  with check (nullif(current_setting('app.user_id', true), '') is not null);
create policy inventory_previews_access on inventory_previews
  for all to nightwatch
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and created_by = nullif(current_setting('app.user_id', true), '')
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and created_by = nullif(current_setting('app.user_id', true), '')
  );

-- A new file replaces the preview by delete and insert; a preview is never updated.
grant select, insert, delete on inventory_previews to nightwatch;

-- Expired previews are deleted by the Worker even when nobody opens the page (R-07). The
-- function owner is a NOLOGIN role under FORCE RLS that sees only expired rows (0020 pattern).
create role nightwatch_inventory_preview_owner
  nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
grant usage on schema public to nightwatch_inventory_preview_owner;

create policy inventory_previews_expiry_select on inventory_previews
  for select to nightwatch_inventory_preview_owner
  using (expires_at <= now());
create policy inventory_previews_expiry_delete on inventory_previews
  for delete to nightwatch_inventory_preview_owner
  using (expires_at <= now());
grant select (id, expires_at), delete on inventory_previews to nightwatch_inventory_preview_owner;

-- Deletes at most p_limit expired previews, oldest first, and returns how many. Running it
-- twice equals running it once; a preview that is not yet expired is never touched.
create function purge_expired_inventory_previews(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'inventory preview purge limit must be between 1 and 10000';
  end if;

  with expired as (
    select p.id
    from inventory_previews as p
    where p.expires_at <= now()
    order by p.expires_at
    limit p_limit
  )
  delete from inventory_previews as p
  using expired
  where p.id = expired.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

alter function purge_expired_inventory_previews(integer)
  owner to nightwatch_inventory_preview_owner;
revoke all on function purge_expired_inventory_previews(integer) from public;
grant execute on function purge_expired_inventory_previews(integer) to nightwatch;

-- One record per confirmed import: time, importer, file name and the counts of the preview.
-- No file content. The history list reads it (S7.5); a record is never changed, and it goes
-- with the Project (Q-12). The importer stays as the person's id when the account is gone.
create table inventory_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  imported_by text not null,
  file_name text not null check (char_length(file_name) between 1 and 255),
  imported_at timestamptz not null default now(),
  added integer not null check (added >= 0),
  updated integer not null check (updated >= 0),
  unchanged integer not null check (unchanged >= 0),
  skipped integer not null check (skipped >= 0),
  failed integer not null check (failed >= 0),
  foreign key (project_id, tenant_id)
    references projects (id, tenant_id) on delete cascade
);

create index inventory_imports_project_idx on inventory_imports (tenant_id, project_id, imported_at desc);

alter table inventory_imports enable row level security;
alter table inventory_imports force row level security;

create policy inventory_imports_tenant_context on inventory_imports
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy inventory_imports_tenant_access on inventory_imports
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert on inventory_imports to nightwatch;

-- The list is 0039's plus the import action (the upload action stays for events already
-- written); the category and target rules already cover organization.project.% and the project
-- target type.
alter table audit_events drop constraint audit_events_action_check;
alter table audit_events add constraint audit_events_action_check check (
  action in (
    'organization.monitor.create', 'organization.monitor.update', 'organization.monitor.pause',
    'organization.monitor.resume', 'organization.monitor.delete', 'organization.monitor.secret.set',
    'organization.monitor.secret.replace', 'organization.notification-settings.monitor-alerts.update',
    'organization.notification-settings.update', 'organization.member.role.update',
    'organization.member.revoke', 'organization.member.leave', 'organization.invitation.create',
    'organization.invitation.resend', 'organization.invitation.cancel', 'organization.audit-log.export',
    'organization.project.create', 'organization.project.update', 'organization.project.delete',
    'organization.project.member.add', 'organization.project.member.role.update',
    'organization.project.member.remove',
    'organization.aws_connection.tested', 'organization.aws_connection.updated',
    'organization.aws_connection.disconnected',
    'organization.aws_connection.test', 'organization.aws_connection.update',
    'organization.aws_connection.delete',
    'organization.project.aws_connection.test', 'organization.project.aws_connection.update',
    'organization.project.aws_connection.delete',
    'organization.project.inventory.upload',
    'organization.project.inventory.import',
    'organization.project.inventory.mapping.update',
    'organization.project.inventory.row.create',
    'organization.project.inventory.row.update',
    'organization.project.inventory.row.delete',
    'organization.project.inventory.system.create',
    'organization.project.inventory.system.rename',
    'organization.project.inventory.system.delete',
    'organization.project.vulnerability.run',
    'organization.project.vulnerability.sample',
    'organization.project.vulnerability.triage'
  )
);
