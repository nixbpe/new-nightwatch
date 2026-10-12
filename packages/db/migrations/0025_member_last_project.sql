-- Last Project per user per Organization (F-010). The sidebar and the entry
-- route read it to pick the Project to open. It is a per-user table (DB-10):
-- a restrictive guard on each of app.tenant_id and app.user_id, one access
-- policy that ties a row to both, and FORCE RLS.
--
-- Both keys cascade: removing the Project or the Organization member removes
-- the row, as the owner of this table, so the runtime role needs no delete
-- grant. Access is checked again whenever the row is read; the row is only a
-- hint and never grants access to the Project.

create table member_last_project (
  tenant_id uuid not null references organization (id) on delete cascade,
  user_id text not null,
  project_id uuid not null,
  updated_at timestamptz not null default now(),
  -- When the user landed on the Project, as the client reported it and the
  -- server clamped it. A write only replaces a row with an older value, so a
  -- delayed request from another tab or browser cannot restore a stale Project.
  selected_at timestamptz not null,
  primary key (tenant_id, user_id),
  foreign key (project_id, tenant_id)
    references projects (id, tenant_id) on delete cascade,
  foreign key (tenant_id, user_id)
    references member (organization_id, user_id) on delete cascade
);

create index member_last_project_project_idx on member_last_project (tenant_id, project_id);

alter table member_last_project enable row level security;
alter table member_last_project force row level security;

create policy member_last_project_tenant_context on member_last_project
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy member_last_project_user_context on member_last_project
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.user_id', true), '') is not null)
  with check (nullif(current_setting('app.user_id', true), '') is not null);
create policy member_last_project_access on member_last_project
  for all to nightwatch
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')
  );

-- Upsert needs select (conflict target) and insert; only the Project and its
-- timestamps ever change (DB-12).
grant select, insert on member_last_project to nightwatch;
grant update (project_id, updated_at, selected_at) on member_last_project to nightwatch;
