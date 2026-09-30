-- Monitor notifications (F-005): five tenant-scope event types, the monitor
-- subject columns they carry, and the organization toggle for down alerts.

-- The event_type CHECK of each table is unnamed in 0002, so the constraints
-- are found in pg_constraint. Each table must hold exactly the two CHECKs that
-- mention event_type (column check and scope check); anything else aborts the
-- migration instead of dropping silently.
do $$
declare
  v_table text;
  v_constraint record;
  v_count integer;
begin
  foreach v_table in array array['notification_intents', 'notification_inbox_items'] loop
    v_count := 0;
    for v_constraint in
      select conname
      from pg_constraint
      where conrelid = to_regclass('public.' || v_table)
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%event_type%'
    loop
      execute format('alter table %I drop constraint %I', v_table, v_constraint.conname);
      v_count := v_count + 1;
    end loop;
    if v_count <> 2 then
      raise exception 'expected 2 event_type CHECK constraints on %, found %', v_table, v_count;
    end if;
  end loop;
end;
$$;

alter table notification_intents
  add column subject_monitor_id uuid,
  add column subject_monitor_name text,
  add column monitor_reason text,
  add column ssl_not_after timestamptz;

alter table notification_inbox_items
  add column subject_monitor_id uuid,
  add column subject_monitor_name text,
  add column monitor_reason text,
  add column ssl_not_after timestamptz;

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
    'MONITOR_SSL_EXPIRED'
  )),
  add constraint notification_intents_scope_check check (
    (scope_kind = 'tenant' and tenant_id is not null and user_id is null
      and event_type in (
        'ORG-NOTIFICATION-SETTINGS-CHANGED',
        'MONITOR_DOWN',
        'MONITOR_RECOVERED',
        'MONITOR_SSL_CAUTION',
        'MONITOR_SSL_DANGER',
        'MONITOR_SSL_EXPIRED'
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
    'MONITOR_SSL_EXPIRED'
  )),
  add constraint notification_inbox_items_scope_check check (
    (scope_kind = 'tenant' and tenant_id is not null and user_id is null
      and event_type in (
        'ORG-NOTIFICATION-SETTINGS-CHANGED',
        'MONITOR_DOWN',
        'MONITOR_RECOVERED',
        'MONITOR_SSL_CAUTION',
        'MONITOR_SSL_DANGER',
        'MONITOR_SSL_EXPIRED'
      ))
    or
    (scope_kind = 'account' and tenant_id is null and user_id = recipient_user_id
      and event_type in ('PASSWORD_CHANGED', 'MFA_ENABLED', 'MFA_DISABLED'))
  );

alter table notification_org_settings
  add column monitor_alerts_enabled boolean not null default true;
