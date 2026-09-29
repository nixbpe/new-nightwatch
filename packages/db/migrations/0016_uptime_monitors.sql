-- Uptime monitor domain (F-005). Every table is Organization-owned: it carries
-- tenant_id, a restrictive context guard, tenant access policies and FORCE
-- RLS. Children reference monitors through (monitor_id, tenant_id) so a row
-- can never point at another Organization's monitor (foreign-key checks
-- bypass RLS, the composite key does not).

create table monitors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references organization (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  url text not null check (char_length(url) between 1 and 2048),
  method text not null default 'GET' check (method in ('GET', 'HEAD')),
  headers jsonb not null default '[]'::jsonb,
  query_params jsonb not null default '[]'::jsonb,
  body_type text check (body_type in ('json', 'text')),
  body_content text check (octet_length(body_content) <= 65536),
  auth_type text not null default 'none'
    check (auth_type in ('none', 'bearer', 'basic', 'apiKey')),
  api_key_header_name text,
  expected_status_text text not null default '200-299',
  expected_status_ranges jsonb not null default '[{"from":200,"to":299}]'::jsonb,
  assertions jsonb not null default '[]'::jsonb,
  interval_seconds integer not null default 300 check (interval_seconds > 0),
  timeout_seconds integer not null default 10
    check (timeout_seconds between 1 and 30),
  status text not null default 'active' check (status in ('active', 'paused')),
  version integer not null default 1 check (version >= 1),
  check_config_version integer not null default 1 check (check_config_version >= 1),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_check_at timestamptz,
  last_outcome text check (last_outcome in ('pass', 'fail', 'check_error')),
  last_passed_config_version integer,
  ssl_host text,
  ssl_issuer text,
  ssl_not_after timestamptz,
  ssl_state text,
  ssl_reason text,
  ssl_notified_not_after timestamptz,
  ssl_notified_level text check (ssl_notified_level in ('caution', 'danger', 'expired')),
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monitors_timeout_below_interval_check
    check (timeout_seconds < interval_seconds),
  constraint monitors_id_tenant_key unique (id, tenant_id),
  constraint monitors_client_request_key unique (tenant_id, client_request_id)
);

create index monitors_tenant_idx on monitors (tenant_id, id);

create table monitor_secrets (
  monitor_id uuid not null,
  tenant_id uuid not null references organization (id) on delete cascade,
  slot text not null check (
    slot in ('auth.token', 'auth.username', 'auth.password', 'auth.apiKey')
    or slot like 'header.%'
  ),
  ciphertext bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  key_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (monitor_id, slot),
  foreign key (monitor_id, tenant_id)
    references monitors (id, tenant_id) on delete cascade
);

-- Scheduler ledger: routing data only (no URL, header or secret; DB-10).
-- next_check_at is NULL while the monitor is paused, which makes the row
-- unclaimable without the claim function reading monitors.
create table monitor_schedule (
  monitor_id uuid primary key,
  tenant_id uuid not null references organization (id) on delete cascade,
  next_check_at timestamptz,
  claim_token text,
  claimed_until timestamptz,
  check_config_version integer not null check (check_config_version >= 1),
  interval_seconds integer not null check (interval_seconds > 0),
  timeout_seconds integer not null check (timeout_seconds between 1 and 30),
  foreign key (monitor_id, tenant_id)
    references monitors (id, tenant_id) on delete cascade
);

create index monitor_schedule_due_idx on monitor_schedule (next_check_at)
  where next_check_at is not null;

create table monitor_check_results (
  monitor_id uuid not null,
  tenant_id uuid not null references organization (id) on delete cascade,
  scheduled_for timestamptz not null,
  checked_at timestamptz not null,
  outcome text not null check (outcome in ('pass', 'fail', 'check_error')),
  http_status integer,
  response_time_ms integer,
  failure_reason text,
  tls_reason text,
  assertions jsonb not null default '[]'::jsonb,
  url_masked text not null,
  check_config_version integer not null,
  interval_seconds integer not null check (interval_seconds > 0),
  evaluated_from_prefix boolean not null default false,
  primary key (monitor_id, scheduled_for),
  foreign key (monitor_id, tenant_id)
    references monitors (id, tenant_id) on delete cascade
) partition by range (scheduled_for);

create table monitor_check_hourly (
  monitor_id uuid not null,
  tenant_id uuid not null references organization (id) on delete cascade,
  hour_start timestamptz not null,
  checks integer not null default 0,
  passed integer not null default 0,
  covered_seconds integer not null default 0,
  response_ms_sum bigint not null default 0,
  response_ms_max integer,
  primary key (monitor_id, hour_start),
  foreign key (monitor_id, tenant_id)
    references monitors (id, tenant_id) on delete cascade
) partition by range (hour_start);

-- Purge filters and sorts on the partition key alone; the primary keys lead
-- with monitor_id and cannot serve it.
create index monitor_check_results_scheduled_idx
  on monitor_check_results (scheduled_for);
create index monitor_check_hourly_hour_idx
  on monitor_check_hourly (hour_start);

create table monitor_incidents (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null,
  tenant_id uuid not null references organization (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  start_reason text not null,
  start_http_status integer,
  end_reason text check (end_reason in ('recovered', 'paused_by_user')),
  down_notified boolean not null default false,
  foreign key (monitor_id, tenant_id)
    references monitors (id, tenant_id) on delete cascade,
  constraint monitor_incidents_end_check
    check ((ended_at is null) = (end_reason is null))
);

create unique index monitor_incidents_one_open_key
  on monitor_incidents (monitor_id) where ended_at is null;
create index monitor_incidents_history_idx
  on monitor_incidents (monitor_id, started_at desc);
create index monitor_incidents_retention_idx
  on monitor_incidents (ended_at) where ended_at is not null;

create table monitor_events (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null,
  tenant_id uuid not null references organization (id) on delete cascade,
  kind text not null check (kind in ('paused', 'resumed', 'config_changed')),
  occurred_at timestamptz not null default now(),
  url_masked text,
  foreign key (monitor_id, tenant_id)
    references monitors (id, tenant_id) on delete cascade
);

create index monitor_events_monitor_idx on monitor_events (monitor_id, occurred_at desc);
create index monitor_events_retention_idx on monitor_events (occurred_at);

alter table monitors enable row level security;
alter table monitors force row level security;
alter table monitor_secrets enable row level security;
alter table monitor_secrets force row level security;
alter table monitor_schedule enable row level security;
alter table monitor_schedule force row level security;
alter table monitor_check_results enable row level security;
alter table monitor_check_results force row level security;
alter table monitor_check_hourly enable row level security;
alter table monitor_check_hourly force row level security;
alter table monitor_incidents enable row level security;
alter table monitor_incidents force row level security;
alter table monitor_events enable row level security;
alter table monitor_events force row level security;

create policy monitors_tenant_context on monitors
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy monitors_tenant_access on monitors
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy monitor_secrets_tenant_context on monitor_secrets
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy monitor_secrets_tenant_access on monitor_secrets
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy monitor_schedule_tenant_context on monitor_schedule
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy monitor_schedule_tenant_access on monitor_schedule
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy monitor_check_results_tenant_context on monitor_check_results
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy monitor_check_results_tenant_access on monitor_check_results
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy monitor_check_hourly_tenant_context on monitor_check_hourly
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy monitor_check_hourly_tenant_access on monitor_check_hourly
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy monitor_incidents_tenant_context on monitor_incidents
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy monitor_incidents_tenant_access on monitor_incidents
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy monitor_events_tenant_context on monitor_events
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy monitor_events_tenant_access on monitor_events
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on monitors to nightwatch;
grant select, insert, update, delete on monitor_secrets to nightwatch;
grant select, insert, update, delete on monitor_schedule to nightwatch;
grant select, insert on monitor_check_results to nightwatch;
grant select, insert, update on monitor_check_hourly to nightwatch;
grant select, insert, update on monitor_incidents to nightwatch;
grant select, insert on monitor_events to nightwatch;

-- Function owners follow 0008: purpose-specific NOLOGIN roles that stay under
-- FORCE RLS and see only the rows their function needs.
create role nightwatch_monitor_schedule_owner
  nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
create role nightwatch_monitor_retention_owner
  nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;

grant usage on schema public to
  nightwatch_monitor_schedule_owner,
  nightwatch_monitor_retention_owner;

-- Claiming is the only cross-Organization read of the ledger. The update
-- policy limits even the owner role to rows that are due and not under a
-- live lease.
-- The select policy cannot be limited to due rows: an UPDATE must also pass
-- the select policy for the new row, whose next_check_at is in the future.
create policy monitor_schedule_claim_select on monitor_schedule
  for select to nightwatch_monitor_schedule_owner
  using (true);
create policy monitor_schedule_claim_update on monitor_schedule
  for update to nightwatch_monitor_schedule_owner
  using (
    next_check_at <= now()
    and (claim_token is null or claimed_until < now())
  )
  with check (true);
grant select, update on monitor_schedule to nightwatch_monitor_schedule_owner;

-- Purge may see and delete only rows already past the 30-day retention.
-- Open incidents are never visible to it.
create policy monitor_check_results_retention_select on monitor_check_results
  for select to nightwatch_monitor_retention_owner
  using (scheduled_for < now() - interval '30 days');
create policy monitor_check_results_retention_delete on monitor_check_results
  for delete to nightwatch_monitor_retention_owner
  using (scheduled_for < now() - interval '30 days');
create policy monitor_check_hourly_retention_select on monitor_check_hourly
  for select to nightwatch_monitor_retention_owner
  using (hour_start < now() - interval '30 days');
create policy monitor_check_hourly_retention_delete on monitor_check_hourly
  for delete to nightwatch_monitor_retention_owner
  using (hour_start < now() - interval '30 days');
create policy monitor_events_retention_select on monitor_events
  for select to nightwatch_monitor_retention_owner
  using (occurred_at < now() - interval '30 days');
create policy monitor_events_retention_delete on monitor_events
  for delete to nightwatch_monitor_retention_owner
  using (occurred_at < now() - interval '30 days');
create policy monitor_incidents_retention_select on monitor_incidents
  for select to nightwatch_monitor_retention_owner
  using (ended_at is not null and ended_at < now() - interval '30 days');
create policy monitor_incidents_retention_delete on monitor_incidents
  for delete to nightwatch_monitor_retention_owner
  using (ended_at is not null and ended_at < now() - interval '30 days');
grant select, delete on
  monitor_check_results,
  monitor_check_hourly,
  monitor_events,
  monitor_incidents
  to nightwatch_monitor_retention_owner;

-- One statement claims up to p_limit due rows. next_check_at moves to
-- now() + interval (no catch-up after downtime), scheduled_for is the slot
-- that was due.
create function claim_due_monitor_checks(p_limit integer)
returns table (
  monitor_id uuid,
  tenant_id uuid,
  claim_token text,
  check_config_version integer,
  scheduled_for timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'monitor claim limit must be between 1 and 100';
  end if;

  return query
  with due as (
    select s.monitor_id as due_monitor_id, s.next_check_at as due_at
    from monitor_schedule as s
    where s.next_check_at <= now()
      and (s.claim_token is null or s.claimed_until < now())
    order by s.next_check_at, s.monitor_id
    for update skip locked
    limit p_limit
  )
  update monitor_schedule as s
  set claim_token = gen_random_uuid()::text,
      claimed_until = now() + make_interval(secs => s.timeout_seconds) + interval '60 seconds',
      next_check_at = now() + make_interval(secs => s.interval_seconds)
  from due
  where s.monitor_id = due.due_monitor_id
  returning s.monitor_id, s.tenant_id, s.claim_token, s.check_config_version, due.due_at;
end;
$$;

-- Deletes at most p_limit expired rows in total and returns how many.
create function purge_expired_monitor_data(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_left integer := p_limit;
  v_total integer := 0;
  v_deleted integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'monitor purge limit must be between 1 and 1000';
  end if;

  with expired as (
    select r.monitor_id, r.scheduled_for
    from monitor_check_results as r
    where r.scheduled_for < now() - interval '30 days'
    order by r.scheduled_for
    limit v_left
  )
  delete from monitor_check_results as r
  using expired
  where r.monitor_id = expired.monitor_id and r.scheduled_for = expired.scheduled_for;
  get diagnostics v_deleted = row_count;
  v_left := v_left - v_deleted;
  v_total := v_total + v_deleted;

  if v_left > 0 then
    with expired as (
      select h.monitor_id, h.hour_start
      from monitor_check_hourly as h
      where h.hour_start < now() - interval '30 days'
      order by h.hour_start
      limit v_left
    )
    delete from monitor_check_hourly as h
    using expired
    where h.monitor_id = expired.monitor_id and h.hour_start = expired.hour_start;
    get diagnostics v_deleted = row_count;
    v_left := v_left - v_deleted;
    v_total := v_total + v_deleted;
  end if;

  if v_left > 0 then
    with expired as (
      select e.id
      from monitor_events as e
      where e.occurred_at < now() - interval '30 days'
      order by e.occurred_at
      limit v_left
    )
    delete from monitor_events as e
    using expired
    where e.id = expired.id;
    get diagnostics v_deleted = row_count;
    v_left := v_left - v_deleted;
    v_total := v_total + v_deleted;
  end if;

  if v_left > 0 then
    with expired as (
      select i.id
      from monitor_incidents as i
      where i.ended_at is not null and i.ended_at < now() - interval '30 days'
      order by i.ended_at
      limit v_left
    )
    delete from monitor_incidents as i
    using expired
    where i.id = expired.id;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end if;

  return v_total;
end;
$$;

-- Owner-only partition maintenance (DB-09). Keeps the previous month (30-day
-- retention straddles it), the current month and p_months_ahead more, and
-- drops partitions whose whole range is older than 31 days. Partitions get
-- FORCE RLS with no policy and no grants, so the runtime role can reach them
-- only through the parent.
create function ensure_monitor_partitions(p_months_ahead integer)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_parent text;
  v_first timestamp := date_trunc('month', timezone('UTC', now())) - interval '1 month';
  v_month timestamp;
  v_name text;
  v_child record;
begin
  if p_months_ahead is null or p_months_ahead < 0 or p_months_ahead > 12 then
    raise exception 'monitor partition months ahead must be between 0 and 12';
  end if;

  foreach v_parent in array array['monitor_check_results', 'monitor_check_hourly'] loop
    for i in 0..(p_months_ahead + 1) loop
      v_month := v_first + make_interval(months => i);
      v_name := format('%s_p%s', v_parent, to_char(v_month, 'YYYYMM'));
      if to_regclass(format('public.%I', v_name)) is null then
        execute format(
          'create table public.%I partition of public.%I for values from (%L) to (%L)',
          v_name,
          v_parent,
          timezone('UTC', v_month),
          timezone('UTC', v_month + interval '1 month')
        );
        -- Only on creation: ALTER would lock hot existing partitions.
        execute format('alter table public.%I enable row level security', v_name);
        execute format('alter table public.%I force row level security', v_name);
      end if;
    end loop;

    for v_child in
      select c.relname
      from pg_inherits as i
      join pg_class as c on c.oid = i.inhrelid
      where i.inhparent = format('public.%I', v_parent)::regclass
    loop
      if v_child.relname ~ ('^' || v_parent || '_p[0-9]{6}$')
        and timezone('UTC', to_date(right(v_child.relname, 6), 'YYYYMM') + interval '1 month')
          < now() - interval '31 days'
      then
        execute format('drop table public.%I', v_child.relname);
      end if;
    end loop;
  end loop;
end;
$$;

alter function claim_due_monitor_checks(integer)
  owner to nightwatch_monitor_schedule_owner;
alter function purge_expired_monitor_data(integer)
  owner to nightwatch_monitor_retention_owner;
alter function ensure_monitor_partitions(integer)
  owner to nightwatch_owner;

revoke all on function claim_due_monitor_checks(integer) from public;
revoke all on function purge_expired_monitor_data(integer) from public;
revoke all on function ensure_monitor_partitions(integer) from public;
grant execute on function claim_due_monitor_checks(integer) to nightwatch;
grant execute on function purge_expired_monitor_data(integer) to nightwatch;
grant execute on function ensure_monitor_partitions(integer) to nightwatch_owner;

select ensure_monitor_partitions(3);
