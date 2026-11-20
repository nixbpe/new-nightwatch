create table org_aws_connections (
  tenant_id uuid primary key references organization (id) on delete cascade,
  external_id text not null unique,
  revision uuid not null default gen_random_uuid(),
  role_arn text,
  account_id text check (account_id ~ '^[0-9]{12}$'),
  last_test_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text,
  check (num_nonnulls(role_arn, account_id, last_test_at) in (0, 3))
);

create table project_aws_connections (
  project_id uuid primary key,
  tenant_id uuid not null,
  external_id text not null unique,
  revision uuid not null default gen_random_uuid(),
  method text check (method in ('assume_role', 'access_key')),
  role_arn text,
  account_id text check (account_id ~ '^[0-9]{12}$'),
  region text,
  hub_revision uuid,
  access_key_ciphertext bytea,
  access_key_iv bytea check (octet_length(access_key_iv) = 12),
  access_key_auth_tag bytea check (octet_length(access_key_auth_tag) = 16),
  access_key_key_version text,
  secret_ciphertext bytea,
  secret_iv bytea check (octet_length(secret_iv) = 12),
  secret_auth_tag bytea check (octet_length(secret_auth_tag) = 16),
  secret_key_version text,
  last_test_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text,
  foreign key (project_id, tenant_id) references projects (id, tenant_id) on delete cascade,
  constraint project_aws_connection_method check (
    case method
      when 'assume_role' then
        num_nonnulls(role_arn, account_id, hub_revision, last_test_at) = 4
        and num_nonnulls(region, access_key_ciphertext, access_key_iv, access_key_auth_tag,
          access_key_key_version, secret_ciphertext, secret_iv, secret_auth_tag, secret_key_version) = 0
      when 'access_key' then
        num_nonnulls(role_arn, hub_revision) = 0
        and num_nonnulls(account_id, last_test_at, region, access_key_ciphertext, access_key_iv,
          access_key_auth_tag, access_key_key_version, secret_ciphertext, secret_iv,
          secret_auth_tag, secret_key_version) = 11
      else num_nonnulls(role_arn, account_id, region, hub_revision, last_test_at,
        access_key_ciphertext, access_key_iv, access_key_auth_tag, access_key_key_version,
        secret_ciphertext, secret_iv, secret_auth_tag, secret_key_version) = 0
    end
  )
);

create index project_aws_connections_hub_idx on project_aws_connections (tenant_id, project_id)
  where method = 'assume_role';

alter table org_aws_connections enable row level security;
alter table org_aws_connections force row level security;
alter table project_aws_connections enable row level security;
alter table project_aws_connections force row level security;

create policy org_aws_connections_tenant_context on org_aws_connections
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy org_aws_connections_tenant_access on org_aws_connections
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy project_aws_connections_tenant_context on project_aws_connections
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy project_aws_connections_tenant_access on project_aws_connections
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert on org_aws_connections, project_aws_connections to nightwatch;
grant update (revision, role_arn, account_id, last_test_at, updated_at, updated_by)
  on org_aws_connections to nightwatch;
grant update (revision, method, role_arn, account_id, region, hub_revision, last_test_at,
  access_key_ciphertext, access_key_iv, access_key_auth_tag, access_key_key_version,
  secret_ciphertext, secret_iv, secret_auth_tag, secret_key_version, updated_at, updated_by)
  on project_aws_connections to nightwatch;

alter table audit_events drop constraint audit_events_action_check,
  drop constraint audit_events_category_check,
  drop constraint audit_events_category_matches_action,
  drop constraint audit_events_target_type_check;
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
    'organization.project.aws_connection.delete'
  )
), add constraint audit_events_category_check check (
  category in ('monitor', 'notification_settings', 'member', 'invitation', 'audit_log', 'project', 'aws_connection')
), add constraint audit_events_category_matches_action check (
  category = case
    when action like 'organization.monitor.%' then 'monitor'
    when action like 'organization.notification-settings.%' then 'notification_settings'
    when action like 'organization.member.%' then 'member'
    when action like 'organization.invitation.%' then 'invitation'
    when action like 'organization.audit-log.%' then 'audit_log'
    when action like 'organization.project.%' then 'project'
    when action in ('organization.aws_connection.test', 'organization.aws_connection.update',
      'organization.aws_connection.delete') then 'aws_connection'
  end
), add constraint audit_events_target_type_check check (
  target_type in ('monitor', 'member', 'invitation', 'notification_settings', 'audit_export', 'project', 'aws_connection')
);
