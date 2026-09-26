-- Completed dispatch existence is the sole runtime-readable ledger state. The
-- restrictive policies require a verified nonempty context before either scoped
-- access policy can expose the column-limited SELECT grant below.
create policy notification_dispatch_ledger_account_select_context
  on notification_dispatch_ledger
  as restrictive for select to nightwatch
  using (
    scope_kind <> 'account'
    or nullif(current_setting('app.user_id', true), '') is not null
  );
create policy notification_dispatch_ledger_tenant_select_context
  on notification_dispatch_ledger
  as restrictive for select to nightwatch
  using (
    scope_kind <> 'tenant'
    or nullif(current_setting('app.tenant_id', true), '') is not null
  );
create policy notification_dispatch_ledger_completed_account_select
  on notification_dispatch_ledger
  for select to nightwatch
  using (
    status = 'completed'
    and scope_kind = 'account'
    and user_id = nullif(current_setting('app.user_id', true), '')
  );
create policy notification_dispatch_ledger_completed_tenant_select
  on notification_dispatch_ledger
  for select to nightwatch
  using (
    status = 'completed'
    and scope_kind = 'tenant'
    and tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

grant select (intent_id, status) on notification_dispatch_ledger to nightwatch;
