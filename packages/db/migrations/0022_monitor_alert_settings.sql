-- Monitor alert settings (#60): a notification configuration per monitor,
-- stored on monitors so it reads under the same transaction B lock as the
-- rest of the check config. Existing rows take the default and behave like
-- today (2-failure incident threshold, both toggles on, 30-day SSL caution).
-- RLS policy and table-level grants on monitors already cover every column
-- (0016); no grant or policy change is needed.

alter table monitors
  add column alert_failure_threshold smallint not null default 2
    check (alert_failure_threshold between 1 and 3),
  add column alert_down_enabled boolean not null default true,
  add column alert_ssl_enabled boolean not null default true,
  add column alert_ssl_caution_days smallint not null default 30
    check (alert_ssl_caution_days between 8 and 30);
