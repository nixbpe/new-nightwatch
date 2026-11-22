-- System management in the system (F-022, S7.2). A Project maintainer creates a System with its
-- first row, renames it and deletes it, so a System no longer always comes from a file:
-- `file_name` is null for one created on the screen (its check already passes on null). The
-- upload time and uploader stay as the time and person of the creation.
-- `revision` is the token of a stale-System check: a rename or delete names the revision it
-- read, so a System renamed or replaced meanwhile is never overwritten. The Project-wide name
-- stays unique through `name_key` (inventory_systems_project_name_key); the writers hold the
-- Project lock, so a clash is refused with a message before the index would fire.

alter table inventory_systems
  add column revision integer not null default 1 check (revision >= 1),
  alter column file_name drop not null;

-- A rename rewrites the name and its key and bumps the revision; nothing else of a System is
-- rewritten. Insert and delete were granted by 0030, the counters by 0038.
grant update (name, name_key, revision) on inventory_systems to nightwatch;

-- The list is 0038's plus the three System actions; the category and target rules already
-- cover organization.project.% and the project target type.
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
    'organization.project.inventory.system.create',
    'organization.project.inventory.system.rename',
    'organization.project.inventory.system.delete',
    'organization.project.vulnerability.run',
    'organization.project.vulnerability.sample',
    'organization.project.vulnerability.triage'
  )
);
