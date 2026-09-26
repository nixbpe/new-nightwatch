-- SECURITY DEFINER notification functions must never inherit the DDL owner's
-- superuser or account-domain access. These purpose-specific roles remain
-- subject to FORCE RLS and own only the functions and table grants below.
create role nightwatch_notification_ledger_owner
  nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
create role nightwatch_notification_dispatch_origin_owner
  nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
create role nightwatch_notification_expiry_purge_owner
  nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;

grant usage on schema public to
  nightwatch_notification_ledger_owner,
  nightwatch_notification_dispatch_origin_owner,
  nightwatch_notification_expiry_purge_owner;

-- Ledger claims, lease recovery, and guarded state transitions never need to
-- inspect an account-domain table. FORCE RLS keeps this role on its
-- ledger-only policy despite owning the callable functions.
create policy notification_dispatch_ledger_function_owner_access
  on notification_dispatch_ledger
  for all to nightwatch_notification_ledger_owner
  using (true)
  with check (true);
grant select, update on notification_dispatch_ledger
  to nightwatch_notification_ledger_owner;

-- Dispatch creation may inspect only an intent that matches the caller's
-- transaction-local verified scope. Its ledger INSERT is bound to that same
-- scope, so the function cannot turn an arbitrary intent id into a dispatch.
create policy notification_intents_dispatch_origin_select
  on notification_intents
  for select to nightwatch_notification_dispatch_origin_owner
  using (
    (scope_kind = 'tenant'
      and tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    or
    (scope_kind = 'account'
      and user_id = nullif(current_setting('app.user_id', true), ''))
  );
create policy notification_dispatch_ledger_dispatch_origin_insert
  on notification_dispatch_ledger
  for insert to nightwatch_notification_dispatch_origin_owner
  with check (
    (scope_kind = 'tenant'
      and tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      and user_id is null)
    or
    (scope_kind = 'account'
      and tenant_id is null
      and user_id = nullif(current_setting('app.user_id', true), ''))
  );
grant select on notification_intents to nightwatch_notification_dispatch_origin_owner;
grant insert on notification_dispatch_ledger
  to nightwatch_notification_dispatch_origin_owner;

-- Purge ownership is constrained by RLS to rows already expired at statement
-- time; it cannot discover or delete current inbox items.
create policy notification_inbox_items_expiry_purge_select
  on notification_inbox_items
  for select to nightwatch_notification_expiry_purge_owner
  using (expires_at <= now());
create policy notification_inbox_items_expiry_purge_delete
  on notification_inbox_items
  for delete to nightwatch_notification_expiry_purge_owner
  using (expires_at <= now());
grant select, delete on notification_inbox_items
  to nightwatch_notification_expiry_purge_owner;

alter function claim_notification_dispatches(text, integer)
  owner to nightwatch_notification_ledger_owner;
alter function requeue_stale_notification_dispatches(timestamptz, integer)
  owner to nightwatch_notification_ledger_owner;
alter function mark_notification_dispatch_enqueued(text, text)
  owner to nightwatch_notification_ledger_owner;
alter function fail_notification_dispatch(text, text, text)
  owner to nightwatch_notification_ledger_owner;
alter function resolve_notification_dispatch_claim(text, text)
  owner to nightwatch_notification_ledger_owner;
alter function complete_notification_dispatch(text, text)
  owner to nightwatch_notification_ledger_owner;
alter function create_notification_dispatch(text, text)
  owner to nightwatch_notification_dispatch_origin_owner;
alter function purge_expired_notification_inbox_items(integer)
  owner to nightwatch_notification_expiry_purge_owner;

revoke all on function claim_notification_dispatches(text, integer) from public;
revoke all on function requeue_stale_notification_dispatches(timestamptz, integer) from public;
revoke all on function mark_notification_dispatch_enqueued(text, text) from public;
revoke all on function fail_notification_dispatch(text, text, text) from public;
revoke all on function resolve_notification_dispatch_claim(text, text) from public;
revoke all on function complete_notification_dispatch(text, text) from public;
revoke all on function create_notification_dispatch(text, text) from public;
revoke all on function purge_expired_notification_inbox_items(integer) from public;
grant execute on function claim_notification_dispatches(text, integer) to nightwatch;
grant execute on function requeue_stale_notification_dispatches(timestamptz, integer) to nightwatch;
grant execute on function mark_notification_dispatch_enqueued(text, text) to nightwatch;
grant execute on function fail_notification_dispatch(text, text, text) to nightwatch;
grant execute on function resolve_notification_dispatch_claim(text, text) to nightwatch;
grant execute on function complete_notification_dispatch(text, text) to nightwatch;
grant execute on function create_notification_dispatch(text, text) to nightwatch;
grant execute on function purge_expired_notification_inbox_items(integer) to nightwatch;
