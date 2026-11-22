-- Read only expiry routing data, never notification content or recipient snapshots.
grant select (id, expires_at) on notification_intents to nightwatch_email_job_owner;
create policy notification_intents_email_expiry_select on notification_intents
  for select to nightwatch_email_job_owner
  using (event_type = 'VULNERABILITY_NEW');
grant delete on notification_email_jobs to nightwatch_email_job_owner;
create policy notification_email_jobs_expiry_delete on notification_email_jobs
  for delete to nightwatch_email_job_owner
  using (exists (
    select 1 from notification_intents i
    where i.id = intent_id and i.expires_at <= now()
  ) and (state <> 'sending' or claimed_until < now()));

-- SKIP LOCKED needs UPDATE visibility even for terminal rows. This policy
-- allows locking expired rows but does not authorize an update.
create policy notification_email_jobs_expiry_lock on notification_email_jobs
  for update to nightwatch_email_job_owner
  using (exists (
    select 1 from notification_intents i
    where i.id = intent_id and i.expires_at <= now()
  ))
  with check (false);

-- A single bounded batch. Recover exhausted claims before expiry so they are counted
-- for the Worker's error log. Never remove a send under a live lease.
create function maintain_notification_email_jobs(p_limit integer)
returns table (expired_count integer, failed_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'email job maintenance limit must be between 1 and 100';
  end if;

  with exhausted as (
    select j.intent_id, j.recipient_user_id
    from notification_email_jobs j
    where j.state in ('pending', 'sending') and j.attempt_count >= 5
      and (j.claimed_until is null or j.claimed_until < now())
    order by j.next_attempt_at, j.created_at
    for update skip locked
    limit p_limit
  )
  update notification_email_jobs j
  set state = 'failed', claim_token = null, claimed_until = null
  from exhausted e
  where j.intent_id = e.intent_id and j.recipient_user_id = e.recipient_user_id;
  get diagnostics failed_count = row_count;

  with expired as (
    select j.intent_id, j.recipient_user_id
    from notification_email_jobs j
    join notification_intents i on i.id = j.intent_id
    where i.expires_at <= now()
      and (j.state <> 'sending' or j.claimed_until < now())
      and not (j.state in ('pending', 'sending') and j.attempt_count >= 5)
    order by i.expires_at, j.intent_id, j.recipient_user_id
    for update of j skip locked
    limit (p_limit - failed_count)
  )
  delete from notification_email_jobs j using expired e
  where j.intent_id = e.intent_id and j.recipient_user_id = e.recipient_user_id;
  get diagnostics expired_count = row_count;
  return next;
end;
$$;

alter function maintain_notification_email_jobs(integer) owner to nightwatch_email_job_owner;
revoke all on function maintain_notification_email_jobs(integer) from public;
grant execute on function maintain_notification_email_jobs(integer) to nightwatch;

-- Exhausted claims are now recovered by maintenance, which reports their count.
create or replace function claim_notification_email_jobs(p_limit integer)
returns table (
  intent_id text,
  recipient_user_id text,
  tenant_id uuid,
  claim_token uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'email job claim limit must be between 1 and 100';
  end if;

  return query
  with due as (
    select j.intent_id as due_intent, j.recipient_user_id as due_user
    from notification_email_jobs as j
    where j.attempt_count < 5
      and (
        (j.state = 'pending' and j.next_attempt_at <= now())
        or (j.state = 'sending' and j.claimed_until < now())
      )
    order by j.next_attempt_at, j.created_at
    for update skip locked
    limit p_limit
  )
  update notification_email_jobs as j
  set state = 'sending',
      claim_token = gen_random_uuid(),
      claimed_until = now() + interval '5 minutes',
      attempt_count = j.attempt_count + 1
  from due
  where j.intent_id = due.due_intent and j.recipient_user_id = due.due_user
  returning j.intent_id, j.recipient_user_id, j.tenant_id, j.claim_token, j.attempt_count;
end;
$$;
