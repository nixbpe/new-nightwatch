-- Monitor event feed (#58): incident end values, richer monitor_events and the
-- per-monitor last response.

alter table monitor_incidents
  add column end_http_status integer,
  add column end_response_time_ms integer;

-- The kind CHECK of monitor_events is unnamed in 0016, so it is found in
-- pg_constraint. Exactly one CHECK mentions kind; anything else aborts the
-- migration instead of dropping silently.
do $$
declare
  v_constraint record;
  v_count integer := 0;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = to_regclass('public.monitor_events')
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table monitor_events drop constraint %I', v_constraint.conname);
    v_count := v_count + 1;
  end loop;
  if v_count <> 1 then
    raise exception 'expected 1 kind CHECK constraint on monitor_events, found %', v_count;
  end if;
end;
$$;

alter table monitor_events
  add column actor_kind text not null default 'unrecorded',
  add column actor_user_id text references "user" (id) on delete set null,
  add column changes jsonb,
  add column failure_reason text,
  add column tls_reason text,
  add column http_status integer,
  add column response_time_ms integer;

alter table monitor_events
  add constraint monitor_events_kind_check
    check (kind in ('paused', 'resumed', 'config_changed', 'check_failed')),
  add constraint monitor_events_actor_kind_check
    check (actor_kind in ('unrecorded', 'user')),
  -- Only user actions carry an actor; the account may be gone later
  -- (actor_user_id set null) while actor_kind stays 'user'.
  add constraint monitor_events_actor_scope_check
    check (actor_kind = 'unrecorded' or kind in ('paused', 'resumed', 'config_changed')),
  add constraint monitor_events_actor_user_check
    check (actor_user_id is null or actor_kind = 'user'),
  add constraint monitor_events_changes_scope_check
    check (changes is null or kind = 'config_changed'),
  add constraint monitor_events_check_failed_scope_check
    check (
      kind = 'check_failed'
      or (
        failure_reason is null
        and tls_reason is null
        and http_status is null
        and response_time_ms is null
      )
    );

-- Deleting a user sets actor_user_id null; without an index that scan is
-- sequential over every monitor event.
create index monitor_events_actor_user_idx
  on monitor_events (actor_user_id) where actor_user_id is not null;

create table monitor_last_responses (
  monitor_id uuid primary key,
  tenant_id uuid not null references organization (id) on delete cascade,
  scheduled_for timestamptz not null,
  checked_at timestamptz not null,
  config_version integer not null,
  outcome text not null check (outcome in ('pass', 'fail', 'check_error')),
  failure_reason text,
  url_masked text not null,
  detail_omitted text,
  http_version text,
  http_status integer,
  reason_phrase text,
  headers jsonb not null default '[]'::jsonb,
  headers_truncated boolean not null default false,
  body_kind text,
  body_text text,
  body_truncated boolean,
  body_bytes_read integer,
  body_omitted_reason text,
  foreign key (monitor_id, tenant_id)
    references monitors (id, tenant_id) on delete cascade,
  constraint monitor_last_responses_detail_omitted_check
    check (detail_omitted is null or detail_omitted = 'request_values'),
  constraint monitor_last_responses_http_version_check
    check (http_version is null or http_version in ('HTTP/1.0', 'HTTP/1.1')),
  constraint monitor_last_responses_body_kind_check
    check (body_kind is null or body_kind in ('text', 'omitted')),
  constraint monitor_last_responses_body_omitted_reason_check
    check (
      body_omitted_reason is null
      or body_omitted_reason in ('no_body', 'not_text', 'undecodable', 'request_values')
    ),
  -- A request that carried query or body values keeps no target text (AC-42).
  constraint monitor_last_responses_request_values_check
    check (
      detail_omitted is distinct from 'request_values'
      or (
        reason_phrase is null
        and headers = '[]'::jsonb
        and body_text is null
      )
    )
);

create index monitor_last_responses_retention_idx
  on monitor_last_responses (scheduled_for);

alter table monitor_last_responses enable row level security;
alter table monitor_last_responses force row level security;

create policy monitor_last_responses_tenant_context on monitor_last_responses
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy monitor_last_responses_tenant_access on monitor_last_responses
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update on monitor_last_responses to nightwatch;

-- Purge may see and delete only rows already past the 30-day retention. A
-- paused monitor gets no new result to overwrite its row.
create policy monitor_last_responses_retention_select on monitor_last_responses
  for select to nightwatch_monitor_retention_owner
  using (scheduled_for < now() - interval '30 days');
create policy monitor_last_responses_retention_delete on monitor_last_responses
  for delete to nightwatch_monitor_retention_owner
  using (scheduled_for < now() - interval '30 days');
grant select, delete on monitor_last_responses to nightwatch_monitor_retention_owner;

-- 0016 body plus monitor_last_responses as the last purge step. CREATE OR
-- REPLACE keeps the owner, search_path and EXECUTE grants set in 0016.
-- Deletes at most p_limit expired rows in total and returns how many.
create or replace function purge_expired_monitor_data(p_limit integer)
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
    v_left := v_left - v_deleted;
    v_total := v_total + v_deleted;
  end if;

  if v_left > 0 then
    with expired as (
      select l.monitor_id
      from monitor_last_responses as l
      where l.scheduled_for < now() - interval '30 days'
      order by l.scheduled_for
      limit v_left
    )
    delete from monitor_last_responses as l
    using expired
    where l.monitor_id = expired.monitor_id;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end if;

  return v_total;
end;
$$;
