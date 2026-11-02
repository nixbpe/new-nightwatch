-- Event-time DNS hostname only. Existing intents and inbox rows stay null.
alter table notification_intents
  add column subject_monitor_hostname text,
  add constraint notification_intents_monitor_hostname_length
    check (subject_monitor_hostname is null or length(subject_monitor_hostname) between 1 and 253),
  add constraint notification_intents_monitor_hostname_event
    check (event_type like 'MONITOR\_%' or subject_monitor_hostname is null);

alter table notification_inbox_items
  add column subject_monitor_hostname text,
  add constraint notification_inbox_monitor_hostname_length
    check (subject_monitor_hostname is null or length(subject_monitor_hostname) between 1 and 253),
  add constraint notification_inbox_monitor_hostname_event
    check (event_type like 'MONITOR\_%' or subject_monitor_hostname is null);
