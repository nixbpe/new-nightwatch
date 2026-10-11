-- Project membership management (F-002). Roles change and members are removed
-- by Project administrators, so the runtime role gets update (role) and delete
-- on project_members. project_id, tenant_id and user_id stay immutable (DB-12).
grant update (role), delete on project_members to nightwatch;

-- Audit actions for membership changes. Only the action list grows: category
-- 'project' and target type 'member' already pass their checks, and
-- audit_events_category_matches_action covers 'organization.project.%'.
alter table audit_events drop constraint audit_events_action_check;
alter table audit_events add constraint audit_events_action_check check (
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
    'organization.audit-log.export',
    'organization.project.create',
    'organization.project.update',
    'organization.project.delete',
    'organization.project.member.add',
    'organization.project.member.role.update',
    'organization.project.member.remove'
  )
);
