-- Replaces the AWS connection schema that 0028 (from #118) created with the
-- one the Organization AWS connection code uses (F-013, TS-003-T01). 0028 is
-- already applied in some databases and must stay unchanged, so this
-- migration drops its two tables and creates the new ones. AWS connection
-- settings saved under 0028 are discarded by decision; audit events are
-- kept, so 0028's action names stay valid below.
drop table project_aws_connections;
drop table org_aws_connections;

-- AWS connections (TS-003). An Organization has one central account that
-- NightWatch assumes with the Organization's External ID; a Project connects
-- through that account (assume_role) or with its own encrypted key pair
-- (access_key). Both tables follow 0023: tenant_id, a restrictive context
-- guard, tenant access policies and FORCE RLS.
--
-- The External ID never changes once created. Disconnecting clears the
-- connection columns and keeps the row, so the runtime role has no delete.
create table org_aws_connections (
  tenant_id uuid primary key references organization (id) on delete cascade,
  external_id text not null unique
    check (external_id ~ '^nw-org-[a-z0-9-]{0,40}-[a-z2-7]{26}$'),
  role_arn text check (
    role_arn ~ '^arn:aws:iam::[0-9]{12}:role/([A-Za-z0-9_+=,.@-]+/)*[A-Za-z0-9_+=,.@-]{1,64}$'
    and char_length(role_arn) <= 2048
  ),
  verified_account_id text,
  verified_arn text check (char_length(verified_arn) <= 2048),
  tested_at timestamptz,
  -- Bumped by every saved change; requests carry it to detect stale writes.
  revision integer not null default 0 check (revision >= 0),
  updated_by text references "user" (id) on delete set null,
  updated_at timestamptz,
  created_at timestamptz not null default now(),
  -- A saved connection is always one whose STS test passed for that ARN.
  -- coalesce: a comparison with a NULL column is NULL, which a CHECK accepts.
  constraint org_aws_connections_connected check (coalesce(
    (role_arn is null and verified_account_id is null
      and verified_arn is null and tested_at is null)
    or (role_arn is not null and verified_arn is not null
      and tested_at is not null
      and verified_account_id = substring(role_arn from 14 for 12))
  , false))
);

-- org_connection_revision is the org_aws_connections.revision an assume_role
-- test ran against; a result is current only while it equals the current
-- revision of a connected Organization account.
create table project_aws_connections (
  project_id uuid primary key,
  tenant_id uuid not null references organization (id) on delete cascade,
  external_id text not null unique check (
    external_id ~ '^[A-Za-z0-9+=,.@:/_-]+$'
    and char_length(external_id) between 2 and 1224
  ),
  method text check (method in ('assume_role', 'access_key')),
  role_arn text check (
    role_arn ~ '^arn:aws:iam::[0-9]{12}:role/([A-Za-z0-9_+=,.@-]+/)*[A-Za-z0-9_+=,.@-]{1,64}$'
    and char_length(role_arn) <= 2048
  ),
  -- DB-14: AES-256-GCM, one key version for both values.
  access_key_id_ciphertext bytea,
  access_key_id_iv bytea,
  access_key_id_auth_tag bytea,
  secret_access_key_ciphertext bytea,
  secret_access_key_iv bytea,
  secret_access_key_auth_tag bytea,
  credential_key_version text,
  region text check (region ~ '^[a-z]{2}(-[a-z]+)+-[0-9]$'),
  last_test_result text check (last_test_result in ('passed', 'failed')),
  -- The fixed codes of AWS_TEST_FAILURE_CODES in the contract.
  last_test_code text check (last_test_code in (
    'AWS_ACCESS_DENIED', 'AWS_REGION_DISABLED', 'AWS_TIMEOUT', 'AWS_UNKNOWN',
    'AWS_ACCOUNT_MISMATCH'
  )),
  last_tested_at timestamptz,
  verified_account_id text check (verified_account_id ~ '^[0-9]{12}$'),
  verified_arn text check (char_length(verified_arn) <= 2048),
  org_connection_revision integer check (org_connection_revision >= 0),
  updated_by text references "user" (id) on delete set null,
  updated_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (project_id, tenant_id)
    references projects (id, tenant_id) on delete cascade,
  constraint project_aws_connections_method check (coalesce(
    (method is null
      and role_arn is null and region is null
      and num_nonnulls(access_key_id_ciphertext, access_key_id_iv,
        access_key_id_auth_tag, secret_access_key_ciphertext,
        secret_access_key_iv, secret_access_key_auth_tag,
        credential_key_version) = 0)
    or (method = 'assume_role'
      and role_arn is not null and region is null
      and num_nonnulls(access_key_id_ciphertext, access_key_id_iv,
        access_key_id_auth_tag, secret_access_key_ciphertext,
        secret_access_key_iv, secret_access_key_auth_tag,
        credential_key_version) = 0)
    or (method = 'access_key'
      and role_arn is null and region is not null
      and num_nulls(access_key_id_ciphertext, access_key_id_iv,
        access_key_id_auth_tag, secret_access_key_ciphertext,
        secret_access_key_iv, secret_access_key_auth_tag,
        credential_key_version) = 0)
  , false)),
  constraint project_aws_connections_last_test check (coalesce(
    (last_test_result is null and last_test_code is null
      and last_tested_at is null and verified_account_id is null
      and verified_arn is null)
    or (last_test_result = 'passed' and last_test_code is null
      and last_tested_at is not null and verified_account_id is not null
      and verified_arn is not null)
    or (last_test_result = 'failed' and last_test_code is not null
      and last_tested_at is not null and verified_account_id is null
      and verified_arn is null)
  , false)),
  constraint project_aws_connections_org_revision check (coalesce(
    org_connection_revision is null
    or (method = 'assume_role' and last_test_result is not null)
  , false))
);

create index project_aws_connections_tenant_idx
  on project_aws_connections (tenant_id, method);

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

-- Column-level update keeps tenant_id, project_id and external_id immutable
-- for the runtime role (DB-12). Cascades run as the table owner.
grant select, insert on org_aws_connections to nightwatch;
grant update (
  role_arn, verified_account_id, verified_arn, tested_at, revision,
  updated_by, updated_at
) on org_aws_connections to nightwatch;
grant select, insert on project_aws_connections to nightwatch;
grant update (
  method, role_arn,
  access_key_id_ciphertext, access_key_id_iv, access_key_id_auth_tag,
  secret_access_key_ciphertext, secret_access_key_iv, secret_access_key_auth_tag,
  credential_key_version, region,
  last_test_result, last_test_code, last_tested_at,
  verified_account_id, verified_arn, org_connection_revision,
  updated_by, updated_at
) on project_aws_connections to nightwatch;

-- Audit actions for the Organization AWS connection: a new category and
-- target type, so every list is rebuilt from 0023/0024.
alter table audit_events drop constraint audit_events_category_check;
alter table audit_events drop constraint audit_events_action_check;
alter table audit_events drop constraint audit_events_target_type_check;
alter table audit_events drop constraint audit_events_category_matches_action;

alter table audit_events add constraint audit_events_category_check check (
  category in (
    'monitor', 'notification_settings', 'member', 'invitation', 'audit_log',
    'project', 'aws_connection'
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
    'organization.project.delete',
    'organization.project.member.add',
    'organization.project.member.role.update',
    'organization.project.member.remove',
    'organization.aws_connection.tested',
    'organization.aws_connection.updated',
    'organization.aws_connection.disconnected',
    -- Written under 0028; kept so existing audit events stay valid.
    'organization.aws_connection.test',
    'organization.aws_connection.update',
    'organization.aws_connection.delete',
    'organization.project.aws_connection.test',
    'organization.project.aws_connection.update',
    'organization.project.aws_connection.delete'
  )
);
alter table audit_events add constraint audit_events_target_type_check check (
  target_type in (
    'monitor', 'member', 'invitation', 'notification_settings', 'audit_export',
    'project', 'aws_connection'
  )
);
-- No ELSE: an unmatched action yields NULL, which a CHECK accepts, so every
-- action prefix needs its branch.
alter table audit_events add constraint audit_events_category_matches_action check (
  category = case
    when action like 'organization.monitor.%' then 'monitor'
    when action like 'organization.notification-settings.%' then 'notification_settings'
    when action like 'organization.member.%' then 'member'
    when action like 'organization.invitation.%' then 'invitation'
    when action like 'organization.audit-log.%' then 'audit_log'
    when action like 'organization.project.%' then 'project'
    when action like 'organization.aws_connection.%' then 'aws_connection'
  end
);
