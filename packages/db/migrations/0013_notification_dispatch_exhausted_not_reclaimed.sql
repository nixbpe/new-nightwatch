-- Terminal dispatch failures stay held for recovery (QUE-04). Only transient
-- queue submission failures (and legacy unclassified failures) are claimed
-- again; MATERIALIZATION_EXHAUSTED and INVALID_SCOPE keep their diagnostic
-- reason instead of being retried every cycle ahead of newer work.
-- CREATE OR REPLACE keeps the function owner and grants from 0008.
create or replace function claim_notification_dispatches(p_claim_token text, p_limit integer)
returns table (
  id text,
  intent_id text,
  scope_kind text,
  tenant_id uuid,
  user_id text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'notification dispatch claim limit must be between 1 and 100';
  end if;

  return query
  with selected as (
    select ledger.id
    from notification_dispatch_ledger as ledger
    where ledger.status = 'pending'
       or (
         ledger.status = 'failed'
         and coalesce(ledger.failure_reason, '')
           not in ('MATERIALIZATION_EXHAUSTED', 'INVALID_SCOPE')
       )
    order by ledger.created_at, ledger.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update notification_dispatch_ledger as ledger
    set status = 'claimed',
        claim_token = p_claim_token,
        claimed_at = now(),
        failure_reason = null,
        failure_summary = null,
        attempt_count = ledger.attempt_count + 1,
        updated_at = now()
    from selected
    where ledger.id = selected.id
    returning ledger.id, ledger.intent_id, ledger.scope_kind, ledger.tenant_id, ledger.user_id
  )
  select claimed.id, claimed.intent_id, claimed.scope_kind, claimed.tenant_id, claimed.user_id
  from claimed;
end;
$$;
