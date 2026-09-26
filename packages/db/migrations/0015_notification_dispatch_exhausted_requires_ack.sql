-- Separate pre-acknowledgement failures from genuine exhaustion (QUE-04,
-- QUE-14). A queued job can run while its ledger row is still `claimed`
-- (the scheduler died after queue.add but before the enqueue ack); it cannot
-- complete, and exhausting it must not record MATERIALIZATION_EXHAUSTED,
-- which 0013 holds out of automatic claims. Only an acknowledged (`enqueued`)
-- row can be exhausted; a `claimed` row is left for stale-claim recovery.
-- CREATE OR REPLACE keeps the function owner and grants from 0008.
create or replace function fail_notification_dispatch(
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
    and claim_token = p_claim_token
    and (
      status = 'enqueued'
      or (status = 'claimed' and p_failure_reason <> 'MATERIALIZATION_EXHAUSTED')
    );

  return found;
end;
$$;
