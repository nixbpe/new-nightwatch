-- Dispatch failures retain only a bounded, allowlisted recovery reason and a
-- fixed operator-safe summary. No transport, database, payload, or content error
-- is accepted by this boundary.
alter table notification_dispatch_ledger
  add column failure_reason text,
  add column failure_summary text,
  add constraint notification_dispatch_ledger_failure_reason_check
    check (
      failure_reason is null
      or failure_reason in (
        'QUEUE_ADD_FAILED',
        'QUEUE_ACK_FAILED',
        'INVALID_SCOPE',
        'MATERIALIZATION_EXHAUSTED'
      )
    ),
  add constraint notification_dispatch_ledger_failure_summary_length_check
    check (failure_summary is null or char_length(failure_summary) <= 160),
  add constraint notification_dispatch_ledger_failure_summary_check
    check (
      (failure_reason is null and failure_summary is null)
      or (
        failure_reason is not null
        and failure_summary is not null
        and failure_summary = case failure_reason
          when 'QUEUE_ADD_FAILED' then 'Unable to submit notification work for delivery.'
          when 'QUEUE_ACK_FAILED' then 'Notification delivery submission could not be confirmed.'
          when 'INVALID_SCOPE' then 'Notification delivery work had an invalid scope.'
          when 'MATERIALIZATION_EXHAUSTED' then 'Notification delivery work exhausted processing retries.'
        end
      )
    );

-- Retire the obsolete unclassified failure transition instead of preserving a
-- compatibility path that could create an undiagnosable failure.
revoke all on function fail_notification_dispatch(text, text) from public;
revoke all on function fail_notification_dispatch(text, text) from nightwatch;
drop function fail_notification_dispatch(text, text);

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
    where ledger.status in ('pending', 'failed')
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

create function fail_notification_dispatch(
  p_id text,
  p_claim_token text,
  p_failure_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_failure_summary text;
begin
  case p_failure_reason
    when 'QUEUE_ADD_FAILED' then
      v_failure_summary := 'Unable to submit notification work for delivery.';
    when 'QUEUE_ACK_FAILED' then
      v_failure_summary := 'Notification delivery submission could not be confirmed.';
    when 'INVALID_SCOPE' then
      v_failure_summary := 'Notification delivery work had an invalid scope.';
    when 'MATERIALIZATION_EXHAUSTED' then
      v_failure_summary := 'Notification delivery work exhausted processing retries.';
    else
      raise exception 'invalid notification dispatch failure reason'
        using errcode = '22023';
  end case;

  update notification_dispatch_ledger
  set status = 'failed',
      failure_reason = p_failure_reason,
      failure_summary = v_failure_summary,
      updated_at = now()
  where id = p_id
    and status in ('claimed', 'enqueued')
    and claim_token = p_claim_token;

  return found;
end;
$$;

create or replace function complete_notification_dispatch(
  p_id text,
  p_claim_token text
)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  with completed as (
    update notification_dispatch_ledger
    set status = 'completed',
        failure_reason = null,
        failure_summary = null,
        updated_at = now()
    where id = p_id
      and status = 'enqueued'
      and claim_token = p_claim_token
    returning 1
  )
  select exists(select 1 from completed);
$$;

revoke all on function claim_notification_dispatches(text, integer) from public;
revoke all on function fail_notification_dispatch(text, text, text) from public;
revoke all on function complete_notification_dispatch(text, text) from public;
grant execute on function claim_notification_dispatches(text, integer) to nightwatch;
grant execute on function fail_notification_dispatch(text, text, text) to nightwatch;
grant execute on function complete_notification_dispatch(text, text) to nightwatch;
