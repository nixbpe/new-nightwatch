-- Row editing in the system (F-022, S7.1). A Project maintainer adds, edits and deletes single
-- rows, so a row now records where its last change came from (S7.5): an import of a named
-- file, or an edit in the system, with who and when. Rows written by earlier uploads are
-- backfilled from their System's upload, so they keep the original file name and time.
-- `revision` is the token of a stale-row check: a save or delete names the revision it read.
-- `row_key` is the one definition of the duplicate key (Vendor, Product and Version, trimmed
-- and case-insensitive); a System name is the System itself. Rows of earlier uploads may share
-- a key, so it is indexed but not unique, and the writer enforces it under the Project lock.

alter table inventory_rows
  add column revision integer not null default 1 check (revision >= 1),
  add column source_kind text,
  add column source_file_name text,
  add column changed_by text,
  add column changed_at timestamptz,
  add column row_key text generated always as (
    lower(btrim(vendor)) || E'\x01' || lower(btrim(product)) || E'\x01' || lower(btrim(version))
  ) stored;

update inventory_rows r
set source_kind = 'import',
    source_file_name = s.file_name,
    changed_by = s.uploaded_by,
    changed_at = s.uploaded_at
from inventory_systems s
where s.id = r.system_id;

alter table inventory_rows
  alter column source_kind set not null,
  alter column changed_by set not null,
  alter column changed_at set not null,
  alter column changed_at set default now(),
  add constraint inventory_rows_source check (
    source_kind in ('import', 'manual')
    and (source_kind = 'import') = (source_file_name is not null)
    and (source_file_name is null or char_length(source_file_name) between 1 and 255)
  );

create index inventory_rows_key_idx on inventory_rows (system_id, row_key);

-- An edit rewrites the seven columns, the row's state and its provenance; a delete removes
-- the row. The System's counters are recounted from its rows after every change. Tenant,
-- Project, System, line and the generated key are never rewritten.
grant delete on inventory_rows to nightwatch;
grant update (owner, vendor, product, version, layer, environment, exposure, usable, issues,
  revision, source_kind, source_file_name, changed_by, changed_at) on inventory_rows to nightwatch;
grant update (total_rows, usable_rows) on inventory_systems to nightwatch;

-- The list is 0036's plus the three row actions; the category and target rules already cover
-- organization.project.% and the project target type.
alter table audit_events drop constraint audit_events_action_check;
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
    'organization.aws_connection.tested', 'organization.aws_connection.updated',
    'organization.aws_connection.disconnected',
    'organization.aws_connection.test', 'organization.aws_connection.update',
    'organization.aws_connection.delete',
    'organization.project.aws_connection.test', 'organization.project.aws_connection.update',
    'organization.project.aws_connection.delete',
    'organization.project.inventory.upload',
    'organization.project.inventory.mapping.update',
    'organization.project.inventory.row.create',
    'organization.project.inventory.row.update',
    'organization.project.inventory.row.delete',
    'organization.project.vulnerability.run',
    'organization.project.vulnerability.sample',
    'organization.project.vulnerability.triage'
  )
);
