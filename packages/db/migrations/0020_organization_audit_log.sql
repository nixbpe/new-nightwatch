-- Organization audit log (F-007): append-only audit_events, partitioned by
-- month on occurred_at, plus the recording start date the UI uses to state
-- how far back the log is complete. Events are written in the same
-- transaction as the mutation they describe (recordAuditEvent in apps/api).

-- Organizations that exist today start recording when this migration runs;
-- new organizations start at creation.
alter table organization
  add column audit_recording_started_at timestamptz not null default now();

-- No FK to monitors, member or invitation: events about a deleted target must
-- survive it. tenant_id cascades like monitor_events so deleting an
-- Organization (operator or test teardown) removes its events.
create table audit_events (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null references organization (id) on delete cascade,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id text not null,
  actor_role text not null check (actor_role in ('owner', 'admin', 'viewer', 'auditor')),
  category text not null check (
    category in ('monitor', 'notification_settings', 'member', 'invitation', 'audit_log')
  ),
  action text not null check (
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
      'organization.audit-log.export'
    )
  ),
  target_type text not null check (
    target_type in ('monitor', 'member', 'invitation', 'notification_settings', 'audit_export')
  ),
  target_id text,
  target_attributes jsonb not null default '{}'::jsonb,
  changes jsonb not null default '[]'::jsonb,
  request_id text,
  primary key (id, occurred_at),
  constraint audit_events_category_matches_action check (
    category = case
      when action like 'organization.monitor.%' then 'monitor'
      when action like 'organization.notification-settings.%' then 'notification_settings'
      when action like 'organization.member.%' then 'member'
      when action like 'organization.invitation.%' then 'invitation'
      when action like 'organization.audit-log.%' then 'audit_log'
    end
  )
) partition by range (occurred_at);

create index audit_events_tenant_time_idx
  on audit_events (tenant_id, occurred_at desc, id desc);
create index audit_events_tenant_actor_idx
  on audit_events (tenant_id, actor_user_id, occurred_at desc);
create index audit_events_tenant_id_idx on audit_events (tenant_id, id);

alter table audit_events enable row level security;
alter table audit_events force row level security;

create policy audit_events_tenant_context on audit_events
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy audit_events_tenant_access on audit_events
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Append-only: no update or delete for the runtime role.
grant select, insert on audit_events to nightwatch;

-- Function owner follows 0008 and 0016: a purpose-specific NOLOGIN role that
-- stays under FORCE RLS and sees only rows past the retention cutoff.
create role nightwatch_audit_retention_owner
  nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
grant usage on schema public to nightwatch_audit_retention_owner;

create policy audit_events_retention_select on audit_events
  for select to nightwatch_audit_retention_owner
  using (occurred_at < now() - interval '365 days');
create policy audit_events_retention_delete on audit_events
  for delete to nightwatch_audit_retention_owner
  using (occurred_at < now() - interval '365 days');
grant select, delete on audit_events to nightwatch_audit_retention_owner;

-- Deletes at most p_limit events past the 365-day cutoff; returns the count.
create function purge_expired_audit_events(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'audit purge limit must be between 1 and 10000';
  end if;

  with expired as (
    select e.id, e.occurred_at
    from audit_events as e
    where e.occurred_at < now() - interval '365 days'
    order by e.occurred_at
    limit p_limit
  )
  delete from audit_events as e
  using expired
  where e.id = expired.id and e.occurred_at = expired.occurred_at;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Owner-only partition maintenance (DB-09). Keeps the previous month, the
-- current month and p_months_ahead more, and drops partitions whose whole
-- range ended more than 366 days ago. There is no DEFAULT partition: a
-- missing partition fails the insert loudly instead of hiding rows.
-- Partitions get FORCE RLS with no policy and no grants, so the runtime role
-- reaches them only through the parent.
create function ensure_audit_event_partitions(p_months_ahead integer)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_first timestamp := date_trunc('month', timezone('UTC', now())) - interval '1 month';
  v_month timestamp;
  v_name text;
  v_child record;
begin
  if p_months_ahead is null or p_months_ahead < 0 or p_months_ahead > 12 then
    raise exception 'audit partition months ahead must be between 0 and 12';
  end if;

  for i in 0..(p_months_ahead + 1) loop
    v_month := v_first + make_interval(months => i);
    v_name := format('audit_events_p%s', to_char(v_month, 'YYYYMM'));
    if to_regclass(format('public.%I', v_name)) is null then
      execute format(
        'create table public.%I partition of public.audit_events for values from (%L) to (%L)',
        v_name,
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
    where i.inhparent = 'public.audit_events'::regclass
  loop
    if v_child.relname ~ '^audit_events_p[0-9]{6}$'
      and timezone('UTC', to_date(right(v_child.relname, 6), 'YYYYMM') + interval '1 month')
        < now() - interval '366 days'
    then
      execute format('drop table public.%I', v_child.relname);
    end if;
  end loop;
end;
$$;

alter function purge_expired_audit_events(integer)
  owner to nightwatch_audit_retention_owner;
alter function ensure_audit_event_partitions(integer)
  owner to nightwatch_owner;

revoke all on function purge_expired_audit_events(integer) from public;
revoke all on function ensure_audit_event_partitions(integer) from public;
grant execute on function purge_expired_audit_events(integer) to nightwatch;
grant execute on function ensure_audit_event_partitions(integer) to nightwatch_owner;

select ensure_audit_event_partitions(3);
