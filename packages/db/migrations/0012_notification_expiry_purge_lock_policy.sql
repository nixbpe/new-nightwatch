-- SELECT FOR UPDATE SKIP LOCKED also evaluates UPDATE RLS. It may lock only
-- expired rows and cannot update any row through this policy.
create policy notification_inbox_items_expiry_purge_lock
  on notification_inbox_items
  for update to nightwatch_notification_expiry_purge_owner
  using (expires_at <= now())
  with check (false);
