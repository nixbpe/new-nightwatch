-- Runtime code must not SELECT or UPSERT the pre-context dispatch ledger.
-- This function derives scope columns from an RLS-protected intent on the
-- caller's current transaction and preserves ledger idempotency internally.

revoke insert on notification_dispatch_ledger from nightwatch;

create function create_notification_dispatch(
  p_id text,
  p_intent_id text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_scope_kind text;
  v_tenant_id uuid;
  v_user_id text;
begin
  select intent.scope_kind, intent.tenant_id, intent.user_id
  into v_scope_kind, v_tenant_id, v_user_id
  from notification_intents as intent
  where intent.id = p_intent_id
    and (
      (intent.scope_kind = 'tenant'
        and intent.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      or
      (intent.scope_kind = 'account'
        and intent.user_id = nullif(current_setting('app.user_id', true), ''))
    );

  if not found then
    raise exception 'notification dispatch intent is outside current scope'
      using errcode = '42501';
  end if;

  insert into notification_dispatch_ledger
    (id, intent_id, scope_kind, tenant_id, user_id)
  values (p_id, p_intent_id, v_scope_kind, v_tenant_id, v_user_id)
  on conflict (intent_id) do nothing;
end;
$$;

revoke all on function create_notification_dispatch(text, text) from public;
grant execute on function create_notification_dispatch(text, text) to nightwatch;
