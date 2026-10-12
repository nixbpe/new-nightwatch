-- Monitors belong to a Project (F-011). Existing monitor data is wiped and not
-- migrated (AC-08): no Project can be chosen for a row that predates Projects.
--
-- TRUNCATE lists every table that references monitors and has no CASCADE, so a
-- table this migration does not know about makes it fail instead of being
-- emptied. TRUNCATE is not filtered by row-level security, unlike DELETE.
-- audit_events keeps its rows: it is append-only and holds no foreign key to
-- monitors.
truncate table
  monitors,
  monitor_secrets,
  monitor_schedule,
  monitor_check_results,
  monitor_check_hourly,
  monitor_incidents,
  monitor_events,
  monitor_last_responses;

-- Monitor notifications without a Project cannot link to a monitor route and
-- are no longer readable (their subject needs projectId). Deleting the intent
-- cascades to recipients, inbox items and the dispatch ledger. FORCE RLS would
-- hide every row from this role, so it is lifted on the intents (delete) and the
-- inbox items (check) and restored;
-- the check afterwards fails the migration if a row survived.
alter table notification_intents no force row level security;
alter table notification_inbox_items no force row level security;

delete from notification_intents where event_type like 'MONITOR\_%';

do $$
begin
  if exists (select 1 from notification_intents where event_type like 'MONITOR\_%')
    or exists (select 1 from notification_inbox_items where event_type like 'MONITOR\_%')
  then
    raise exception 'monitor notifications survived the F-011 wipe';
  end if;
end;
$$;

alter table notification_intents force row level security;
alter table notification_inbox_items force row level security;

alter table monitors
  add column project_id uuid not null;

-- The composite key keeps a monitor in the Organization of its Project.
-- Deleting a Project removes its monitors and, through their own cascades,
-- secrets, schedule rows, results, rollups, incidents, events and last responses.
alter table monitors
  add constraint monitors_project_fkey
    foreign key (project_id, tenant_id)
    references projects (id, tenant_id) on delete cascade;

-- A Create replay is looked up inside one Project, so the same
-- client_request_id used in another Project is a new request.
alter table monitors drop constraint monitors_client_request_key;
alter table monitors
  add constraint monitors_client_request_key
    unique (tenant_id, project_id, client_request_id);

create index monitors_project_idx on monitors (tenant_id, project_id, id);

-- Monitor notifications carry their Project so the inbox links to the Project
-- route. No FK: a notification outlives the monitor and its Project.
alter table notification_intents add column subject_project_id uuid;
alter table notification_inbox_items add column subject_project_id uuid;

alter table notification_intents
  add constraint notification_intents_monitor_project_check
    check (event_type not like 'MONITOR\_%' or subject_project_id is not null);
alter table notification_inbox_items
  add constraint notification_inbox_items_monitor_project_check
    check (event_type not like 'MONITOR\_%' or subject_project_id is not null);
