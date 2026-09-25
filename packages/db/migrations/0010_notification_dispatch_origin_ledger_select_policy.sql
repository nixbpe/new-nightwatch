-- INSERT ... ON CONFLICT needs SELECT access to evaluate the unique intent
-- index. The SECURITY DEFINER owner can see only ledger rows in the caller's
-- verified transaction-local scope; the runtime role has no matching policy.
create policy notification_dispatch_ledger_dispatch_origin_select
  on notification_dispatch_ledger
  for select to nightwatch_notification_dispatch_origin_owner
  using (
    (scope_kind = 'tenant'
      and tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    or
    (scope_kind = 'account'
      and user_id = nullif(current_setting('app.user_id', true), ''))
  );
