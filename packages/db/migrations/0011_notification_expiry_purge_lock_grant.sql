-- The purge function keeps SKIP LOCKED for bounded concurrent cleanup;
-- PostgreSQL requires UPDATE privilege to lock the expired rows even though
-- the function performs no UPDATE. No UPDATE RLS policy grants row access.
grant update on notification_inbox_items to nightwatch_notification_expiry_purge_owner;
