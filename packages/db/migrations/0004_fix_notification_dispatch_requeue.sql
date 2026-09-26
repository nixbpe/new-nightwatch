-- Repair 0002's stale-requeue UPDATE: its selected CTE was referenced without
-- appearing in UPDATE ... FROM, which raised SQLSTATE 42P01 at runtime.

create or replace function requeue_stale_notification_dispatches(
  p_claimed_before timestamptz,
  p_limit integer
)
returns table (id text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'notification dispatch requeue limit must be between 1 and 100';
  end if;

  return query
  with selected as (
    select ledger.id
    from notification_dispatch_ledger as ledger
    where ledger.status in ('claimed', 'enqueued')
      and coalesce(ledger.enqueued_at, ledger.claimed_at) < p_claimed_before
    order by coalesce(ledger.enqueued_at, ledger.claimed_at), ledger.id
    for update skip locked
    limit p_limit
  ), requeued as (
    update notification_dispatch_ledger as ledger
    set status = 'pending',
        claim_token = null,
        claimed_at = null,
        enqueued_at = null,
        updated_at = now()
    from selected
    where ledger.id = selected.id
    returning ledger.id
  )
  select requeued.id from requeued;
end;
$$;

revoke all on function requeue_stale_notification_dispatches(timestamptz, integer) from public;
grant execute on function requeue_stale_notification_dispatches(timestamptz, integer) to nightwatch;
