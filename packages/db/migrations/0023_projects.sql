-- Projects (F-001). A Project belongs to one Organization and is created,
-- renamed and deleted by its administrators. project_members is written once
-- here (the creator) and by F-002 afterwards. Both tables follow 0016: tenant_id,
-- a restrictive context guard, tenant access policies and FORCE RLS.

create table projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references organization (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9-]{3,40}$'),
  description text check (description is null or char_length(description) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_id_tenant_key unique (id, tenant_id),
  constraint projects_tenant_slug_key unique (tenant_id, slug)
);

create index projects_tenant_idx on projects (tenant_id, id);

-- The (tenant_id, user_id) key makes the row follow the member row: removing
-- a member from the Organization removes their Project memberships. The
-- cascade runs as the owner of project_members, so the runtime role needs no
-- delete grant.
create table project_members (
  project_id uuid not null,
  tenant_id uuid not null references organization (id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id),
  foreign key (project_id, tenant_id)
    references projects (id, tenant_id) on delete cascade,
  foreign key (tenant_id, user_id)
    references member (organization_id, user_id) on delete cascade
);

create index project_members_tenant_user_idx on project_members (tenant_id, user_id);

alter table projects enable row level security;
alter table projects force row level security;
alter table project_members enable row level security;
alter table project_members force row level security;

create policy projects_tenant_context on projects
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy projects_tenant_access on projects
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy project_members_tenant_context on project_members
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy project_members_tenant_access on project_members
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Column-level update keeps slug, tenant_id and id immutable for the runtime
-- role (DB-12). F-002 adds update (role) and delete on project_members.
grant select, insert, delete on projects to nightwatch;
grant update (name, description, updated_at) on projects to nightwatch;
grant select, insert on project_members to nightwatch;

-- Audit actions for Projects. The column checks were created unnamed in 0020
-- and received these names from PostgreSQL.
alter table audit_events drop constraint audit_events_category_check;
alter table audit_events drop constraint audit_events_action_check;
alter table audit_events drop constraint audit_events_target_type_check;
alter table audit_events drop constraint audit_events_category_matches_action;

alter table audit_events add constraint audit_events_category_check check (
  category in (
    'monitor', 'notification_settings', 'member', 'invitation', 'audit_log', 'project'
  )
);
alter table audit_events add constraint audit_events_action_check check (
  action in (
    'organization.monitor.create',
    'organization.monitor.update',
    'organization.monitor.pause',
    'organization.monitor.resume',
    'organization.monitor.delete',
    'organization.monitor.secret.set',
    'organization.monitor.secret.replace',
    'organization.notification-settings.monitor-alerts.update',
    'organization.notification-settings.update',
    'organization.member.role.update',
    'organization.member.revoke',
    'organization.member.leave',
    'organization.invitation.create',
    'organization.invitation.resend',
    'organization.invitation.cancel',
    'organization.audit-log.export',
    'organization.project.create',
    'organization.project.update',
    'organization.project.delete'
  )
);
alter table audit_events add constraint audit_events_target_type_check check (
  target_type in (
    'monitor', 'member', 'invitation', 'notification_settings', 'audit_export', 'project'
  )
);
alter table audit_events add constraint audit_events_category_matches_action check (
  category = case
    when action like 'organization.monitor.%' then 'monitor'
    when action like 'organization.notification-settings.%' then 'notification_settings'
    when action like 'organization.member.%' then 'member'
    when action like 'organization.invitation.%' then 'invitation'
    when action like 'organization.audit-log.%' then 'audit_log'
    when action like 'organization.project.%' then 'project'
  end
);
