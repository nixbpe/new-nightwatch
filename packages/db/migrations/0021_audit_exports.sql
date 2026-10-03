-- Audit log export (F-007): the request and its file (audit_exports), a claim
-- ledger that carries only routing data (audit_export_jobs), the two
-- notification types the export raises, and the functions the Worker and the
-- scheduler use. The file is kept in PostgreSQL for 24 hours (bytea).

-- ---- Notifications ---------------------------------------------------------

alter table notification_intents
  drop constraint notification_intents_event_type_check,
  drop constraint notification_intents_scope_check,
  add column subject_audit_export_id uuid;
alter table notification_inbox_items
  drop constraint notification_inbox_items_event_type_check,
  drop constraint notification_inbox_items_scope_check,
  add column subject_audit_export_id uuid;

-- No FK on subject_audit_export_id: the export row is deleted after 7 days,
-- the inbox item lives for 30.
alter table notification_intents
  add constraint notification_intents_event_type_check check (event_type in (
    'ORG-NOTIFICATION-SETTINGS-CHANGED',
    'PASSWORD_CHANGED',
    'MFA_ENABLED',
    'MFA_DISABLED',
    'MONITOR_DOWN',
    'MONITOR_RECOVERED',
    'MONITOR_SSL_CAUTION',
    'MONITOR_SSL_DANGER',
    'MONITOR_SSL_EXPIRED',
    'AUDIT_EXPORT_READY',
    'AUDIT_EXPORT_FAILED'
  )),
  add constraint notification_intents_scope_check check (
    (scope_kind = 'tenant' and tenant_id is not null and user_id is null
      and event_type in (
        'ORG-NOTIFICATION-SETTINGS-CHANGED',
        'MONITOR_DOWN',
        'MONITOR_RECOVERED',
        'MONITOR_SSL_CAUTION',
        'MONITOR_SSL_DANGER',
        'MONITOR_SSL_EXPIRED',
        'AUDIT_EXPORT_READY',
        'AUDIT_EXPORT_FAILED'
      ))
    or
    (scope_kind = 'account' and tenant_id is null and user_id is not null
      and event_type in ('PASSWORD_CHANGED', 'MFA_ENABLED', 'MFA_DISABLED'))
  );

alter table notification_inbox_items
  add constraint notification_inbox_items_event_type_check check (event_type in (
    'ORG-NOTIFICATION-SETTINGS-CHANGED',
    'PASSWORD_CHANGED',
    'MFA_ENABLED',
    'MFA_DISABLED',
    'MONITOR_DOWN',
    'MONITOR_RECOVERED',
    'MONITOR_SSL_CAUTION',
    'MONITOR_SSL_DANGER',
    'MONITOR_SSL_EXPIRED',
    'AUDIT_EXPORT_READY',
    'AUDIT_EXPORT_FAILED'
  )),
  add constraint notification_inbox_items_scope_check check (
    (scope_kind = 'tenant' and tenant_id is not null and user_id is null
      and event_type in (
        'ORG-NOTIFICATION-SETTINGS-CHANGED',
        'MONITOR_DOWN',
        'MONITOR_RECOVERED',
        'MONITOR_SSL_CAUTION',
        'MONITOR_SSL_DANGER',
        'MONITOR_SSL_EXPIRED',
        'AUDIT_EXPORT_READY',
        'AUDIT_EXPORT_FAILED'
      ))
    or
    (scope_kind = 'account' and tenant_id is null and user_id = recipient_user_id
      and event_type in ('PASSWORD_CHANGED', 'MFA_ENABLED', 'MFA_DISABLED'))
  );

-- ---- Tables ----------------------------------------------------------------

-- tenant_id cascades like audit_events and monitor_events, so deleting an
-- Organization (operator or test teardown) removes its exports.
create table audit_exports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references organization (id) on delete cascade,
  requested_by text not null,
  format text not null check (format in ('csv', 'json')),
  filters jsonb not null,
  time_zone text not null,
  snapshot_at timestamptz not null,
  failure_code text check (
    failure_code in ('EXPORT_TOO_LARGE', 'EXPORT_FAILED', 'REQUESTER_NOT_AUTHORIZED')
  ),
  row_count integer,
  byte_size integer,
  content bytea,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  file_expires_at timestamptz,
  content_purged_at timestamptz,
  constraint audit_exports_id_scope_key unique (id, tenant_id, requested_by)
);

create table audit_export_jobs (
  export_id uuid primary key,
  tenant_id uuid not null,
  requested_by text not null,
  constraint audit_export_jobs_export_fkey
    foreign key (export_id, tenant_id, requested_by)
    references audit_exports (id, tenant_id, requested_by) on delete cascade,
  state text not null check (state in ('queued', 'running', 'ready', 'failed')),
  attempt_count integer not null default 0,
  claim_token uuid,
  claimed_until timestamptz,
  created_at timestamptz not null
);

create unique index audit_export_jobs_one_in_flight
  on audit_export_jobs (tenant_id, requested_by)
  where state in ('queued', 'running');
create index audit_export_jobs_claim_idx
  on audit_export_jobs (state, claimed_until);
create index audit_exports_list_idx
  on audit_exports (tenant_id, requested_by, created_at desc);
create index audit_exports_purge_idx
  on audit_exports (file_expires_at)
  where content_purged_at is null and file_expires_at is not null;

-- The one place that knows how long a request may stay in flight.
create function audit_export_deadline(p_created_at timestamptz)
returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select p_created_at + interval '60 minutes'
$$;

-- ---- Roles and RLS ---------------------------------------------------------

create role nightwatch_audit_export_claim_owner
  nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
grant usage on schema public to nightwatch_audit_export_claim_owner;

alter table audit_exports enable row level security;
alter table audit_exports force row level security;
alter table audit_export_jobs enable row level security;
alter table audit_export_jobs force row level security;

create policy audit_exports_tenant_context on audit_exports
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy audit_exports_user_context on audit_exports
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.user_id', true), '') is not null)
  with check (nullif(current_setting('app.user_id', true), '') is not null);
create policy audit_exports_access on audit_exports
  for all to nightwatch
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and requested_by = nullif(current_setting('app.user_id', true), '')
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and requested_by = nullif(current_setting('app.user_id', true), '')
  );

create policy audit_export_jobs_tenant_context on audit_export_jobs
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy audit_export_jobs_user_context on audit_export_jobs
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.user_id', true), '') is not null)
  with check (nullif(current_setting('app.user_id', true), '') is not null);
create policy audit_export_jobs_access on audit_export_jobs
  for all to nightwatch
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and requested_by = nullif(current_setting('app.user_id', true), '')
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and requested_by = nullif(current_setting('app.user_id', true), '')
  );

grant select, insert,
  update (failure_code, row_count, byte_size, content, completed_at, file_expires_at)
  on audit_exports to nightwatch;
grant select, insert, update (state, claim_token, claimed_until)
  on audit_export_jobs to nightwatch;

-- Claiming reads and updates the ledger across Organizations and has no grant
-- on audit_exports, so it never sees filters, search text or the file. The
-- select policy cannot be narrower: an UPDATE must also pass the select policy
-- for the new row, whose state is no longer claimable.
create policy audit_export_jobs_claim_select on audit_export_jobs
  for select to nightwatch_audit_export_claim_owner
  using (true);
create policy audit_export_jobs_claim_update on audit_export_jobs
  for update to nightwatch_audit_export_claim_owner
  using (state = 'queued' or (state = 'running' and claimed_until < now()))
  with check (true);
grant select, update on audit_export_jobs to nightwatch_audit_export_claim_owner;

-- Retention: the file is cleared 24 hours after completion, the whole row 7
-- days after the request. No grant on content, filters or the ledger.
create policy audit_exports_retention_select on audit_exports
  for select to nightwatch_audit_retention_owner
  using (true);
create policy audit_exports_retention_update on audit_exports
  for update to nightwatch_audit_retention_owner
  using (file_expires_at <= now() and content_purged_at is null)
  with check (content_purged_at is not null);
create policy audit_exports_retention_delete on audit_exports
  for delete to nightwatch_audit_retention_owner
  using (created_at < now() - interval '7 days');
grant select (id, created_at, file_expires_at, content_purged_at),
  update (content, content_purged_at),
  delete
  on audit_exports to nightwatch_audit_retention_owner;

-- ---- Functions -------------------------------------------------------------

-- Claims one in-flight request. The WHERE is its own and does not lean on the
-- policy, so a broader policy could never make it pick a ready or failed row.
create function claim_audit_export()
returns table (
  export_id uuid,
  tenant_id uuid,
  requested_by text,
  claim_token uuid,
  exhausted boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select j.export_id as due_id
    from audit_export_jobs as j
    where j.state = 'queued' or (j.state = 'running' and j.claimed_until < now())
    order by j.created_at, j.export_id
    for update skip locked
    limit 1
  )
  update audit_export_jobs as j
  set state = 'running',
      claim_token = gen_random_uuid(),
      claimed_until = now() + interval '10 minutes',
      attempt_count = j.attempt_count + 1
  from due
  where j.export_id = due.due_id
  returning j.export_id, j.tenant_id, j.requested_by, j.claim_token,
    (j.attempt_count > 3
      or now() >= audit_export_deadline(j.created_at) - interval '10 minutes');
end;
$$;

-- Read-only: the requests the scheduler must fail because they outlived
-- audit_export_deadline().
create function find_stale_audit_exports(p_limit integer)
returns table (export_id uuid, tenant_id uuid, requested_by text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'stale export limit must be between 1 and 100';
  end if;
  return query
  select j.export_id, j.tenant_id, j.requested_by
  from audit_export_jobs as j
  where j.state in ('queued', 'running')
    and now() >= audit_export_deadline(j.created_at)
  order by j.created_at, j.export_id
  limit p_limit;
end;
$$;

-- Clears at most p_limit expired files and deletes at most p_limit rows past
-- 7 days; returns how many rows it touched. Cleared rows never match again.
create function purge_audit_exports(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cleared integer;
  v_deleted integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'export purge limit must be between 1 and 10000';
  end if;

  with expired as (
    select e.id
    from audit_exports as e
    where e.file_expires_at <= now() and e.content_purged_at is null
    order by e.file_expires_at
    limit p_limit
  )
  update audit_exports as e
  set content = null, content_purged_at = now()
  from expired
  where e.id = expired.id;
  get diagnostics v_cleared = row_count;

  with old as (
    select e.id
    from audit_exports as e
    where e.created_at < now() - interval '7 days'
    order by e.created_at
    limit p_limit
  )
  delete from audit_exports as e
  using old
  where e.id = old.id;
  get diagnostics v_deleted = row_count;

  return v_cleared + v_deleted;
end;
$$;

alter function claim_audit_export() owner to nightwatch_audit_export_claim_owner;
alter function find_stale_audit_exports(integer)
  owner to nightwatch_audit_export_claim_owner;
alter function purge_audit_exports(integer)
  owner to nightwatch_audit_retention_owner;

revoke all on function audit_export_deadline(timestamptz) from public;
revoke all on function claim_audit_export() from public;
revoke all on function find_stale_audit_exports(integer) from public;
revoke all on function purge_audit_exports(integer) from public;
grant execute on function audit_export_deadline(timestamptz)
  to nightwatch, nightwatch_audit_export_claim_owner;
grant execute on function claim_audit_export() to nightwatch;
grant execute on function find_stale_audit_exports(integer) to nightwatch;
grant execute on function purge_audit_exports(integer) to nightwatch;
