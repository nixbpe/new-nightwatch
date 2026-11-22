-- Email for the new-CVE notification (F-020, S4.3). One row per recipient of the intent, made
-- in the same transaction as the intent. The Worker has no owner role (DB-09): it claims rows
-- through a claim function with a dedicated no-login owner role (DB-10), sends through SMTP
-- outside any transaction (REQ-01) and ends the row through a finish function.
--
-- A mail is sent at most once per claim, not exactly once: if the Worker stops between the
-- SMTP acceptance and the finish call, the lease expires and the next claim sends it again.

create table notification_email_jobs (
  intent_id text not null,
  origin text not null,
  recipient_user_id text not null,
  tenant_id uuid not null references organization (id) on delete cascade,
  state text not null default 'pending'
    check (state in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  claim_token uuid,
  claimed_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (intent_id, recipient_user_id),
  -- The recipient is part of the intent's snapshot; the intent is purged after 30 days.
  foreign key (intent_id, origin) references notification_intents (id, origin) on delete cascade,
  constraint notification_email_jobs_sent check ((state = 'sent') = (sent_at is not null))
);

create index notification_email_jobs_due_idx
  on notification_email_jobs (next_attempt_at)
  where state in ('pending', 'sending');

alter table notification_email_jobs enable row level security;
alter table notification_email_jobs force row level security;

create policy notification_email_jobs_tenant_context on notification_email_jobs
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy notification_email_jobs_tenant_access on notification_email_jobs
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- The notification step writes the rows and the Worker reads what it sends within a tenant
-- context. Claiming and finishing go through the functions below.
grant select, insert on notification_email_jobs to nightwatch;

create role nightwatch_email_job_owner
  nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
grant usage on schema public to nightwatch_email_job_owner;

create policy notification_email_jobs_claim_select on notification_email_jobs
  for select to nightwatch_email_job_owner
  using (true);
create policy notification_email_jobs_claim_update on notification_email_jobs
  for update to nightwatch_email_job_owner
  using (state in ('pending', 'sending'))
  with check (true);
grant select on notification_email_jobs to nightwatch_email_job_owner;
grant update (state, attempt_count, claim_token, claimed_until, next_attempt_at, sent_at)
  on notification_email_jobs to nightwatch_email_job_owner;

-- Claims up to p_limit due rows: pending, or sending under an expired lease. A row that used
-- its 5 attempts is ended as failed instead of being claimed again. The lease lasts 5 minutes.
create function claim_notification_email_jobs(p_limit integer)
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

  update notification_email_jobs as j
  set state = 'failed', claim_token = null, claimed_until = null
  where j.state in ('pending', 'sending')
    and j.attempt_count >= 5
    and (j.claimed_until is null or j.claimed_until < now());

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

-- Ends a claim. 'sent' and 'skipped' (the recipient may no longer receive it) end the row,
-- 'retry' puts it back after 5 minutes times the attempts so far, 'failed' ends it. A token
-- that is no longer current changes nothing.
create function finish_notification_email_job(
  p_intent text,
  p_user text,
  p_token uuid,
  p_outcome text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rows integer;
begin
  if p_outcome is null or p_outcome not in ('sent', 'skipped', 'retry', 'failed') then
    raise exception 'email job outcome must be sent, skipped, retry or failed';
  end if;
  update notification_email_jobs as j
  set state = case p_outcome
        when 'sent' then 'sent'
        when 'skipped' then 'skipped'
        when 'retry' then 'pending'
        else 'failed' end,
      sent_at = case when p_outcome = 'sent' then now() end,
      claim_token = null,
      claimed_until = null,
      next_attempt_at = case when p_outcome = 'retry'
        then now() + make_interval(mins => 5 * j.attempt_count)
        else j.next_attempt_at end
  where j.intent_id = p_intent and j.recipient_user_id = p_user
    and j.claim_token = p_token and j.state = 'sending';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

alter function claim_notification_email_jobs(integer) owner to nightwatch_email_job_owner;
alter function finish_notification_email_job(text, text, uuid, text)
  owner to nightwatch_email_job_owner;
revoke all on function claim_notification_email_jobs(integer) from public;
revoke all on function finish_notification_email_job(text, text, uuid, text) from public;
grant execute on function claim_notification_email_jobs(integer) to nightwatch;
grant execute on function finish_notification_email_job(text, text, uuid, text) to nightwatch;
