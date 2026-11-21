-- Project inventory (F-017). A System belongs to one Project; its rows are the
-- parsed lines of an uploaded inventory file. The file itself is never stored
-- (Q-12): only parsed rows, the file name and the upload time are kept.
-- A re-upload replaces the rows of every System named in the file (delete here
-- cascades to the rows). Deleting a Project or Organization removes everything.
--
-- Rows that fail a column rule are kept with `usable = false` and their issue
-- codes so members can review them; only usable rows are meant for matching.

create table inventory_systems (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  -- trim + lowercase of `name`; the Project-wide identity of a System.
  name_key text not null check (char_length(name_key) <= 200),
  name text not null check (char_length(name) <= 200),
  file_name text not null check (char_length(file_name) between 1 and 255),
  uploaded_by text not null,
  uploaded_at timestamptz not null default now(),
  total_rows integer not null check (total_rows >= 0),
  usable_rows integer not null check (usable_rows between 0 and total_rows),
  constraint inventory_systems_project_name_key unique (project_id, name_key),
  constraint inventory_systems_id_scope_key unique (id, tenant_id, project_id),
  foreign key (project_id, tenant_id)
    references projects (id, tenant_id) on delete cascade
);

create table inventory_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  system_id uuid not null,
  -- 1-based position of the row in the uploaded sheet, header row included.
  line_no integer not null check (line_no >= 2),
  owner text not null check (char_length(owner) <= 200),
  vendor text not null check (char_length(vendor) <= 200),
  product text not null check (char_length(product) <= 200),
  version text not null check (char_length(version) <= 200),
  layer text not null check (char_length(layer) <= 200),
  environment text not null check (char_length(environment) <= 200),
  exposure text not null check (char_length(exposure) <= 200),
  usable boolean not null,
  -- [{ "column": "Version", "code": "version_not_patch_level" }, ...]
  issues jsonb not null default '[]'::jsonb check (
    jsonb_typeof(issues) = 'array' and (usable = (jsonb_array_length(issues) = 0))
  ),
  constraint inventory_rows_system_line_key unique (system_id, line_no),
  foreign key (system_id, tenant_id, project_id)
    references inventory_systems (id, tenant_id, project_id) on delete cascade
);

create index inventory_systems_project_idx on inventory_systems (tenant_id, project_id);
create index inventory_rows_rejected_idx on inventory_rows (tenant_id, project_id, system_id, line_no)
  where not usable;

alter table inventory_systems enable row level security;
alter table inventory_systems force row level security;
alter table inventory_rows enable row level security;
alter table inventory_rows force row level security;

create policy inventory_systems_tenant_context on inventory_systems
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy inventory_systems_tenant_access on inventory_systems
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy inventory_rows_tenant_context on inventory_rows
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy inventory_rows_tenant_access on inventory_rows
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- A replacement deletes the old System (rows follow by cascade); nothing is
-- updated in place.
grant select, insert, delete on inventory_systems to nightwatch;
grant select, insert on inventory_rows to nightwatch;

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
    'organization.aws_connection.test', 'organization.aws_connection.update', 'organization.aws_connection.delete',
    'organization.project.aws_connection.test', 'organization.project.aws_connection.update',
    'organization.project.aws_connection.delete',
    'organization.project.inventory.upload'
  )
);
