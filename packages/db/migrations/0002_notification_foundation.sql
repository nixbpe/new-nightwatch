-- Durable in-app notification domain state. These tables are intentionally
-- separate from Better Auth's pre-tenant auth tables: account-scoped rows are
-- subject to FORCE RLS and require a verified transaction-local app.user_id.

create table notification_org_settings (
  tenant_id uuid primary key references organization (id) on delete cascade,
  org_settings_changed_enabled boolean not null default true,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notification_intents (
  id text primary key,
  scope_kind text not null check (scope_kind in ('tenant', 'account')),
  tenant_id uuid references organization (id) on delete cascade,
  user_id text references "user" (id) on delete cascade,
  origin text not null unique,
  event_type text not null check (event_type in (
    'ORG-NOTIFICATION-SETTINGS-CHANGED',
    'PASSWORD_CHANGED',
    'MFA_ENABLED',
    'MFA_DISABLED'
  )),
  occurred_at timestamptz not null,
  expires_at timestamptz not null,
  actor_user_id text references "user" (id) on delete set null,
  actor_display_name text,
  created_at timestamptz not null default now(),
  constraint notification_intents_scope_check check (
    (scope_kind = 'tenant' and tenant_id is not null and user_id is null
      and event_type = 'ORG-NOTIFICATION-SETTINGS-CHANGED')
    or
    (scope_kind = 'account' and tenant_id is null and user_id is not null
      and event_type in ('PASSWORD_CHANGED', 'MFA_ENABLED', 'MFA_DISABLED'))
  ),
  constraint notification_intents_id_origin_key unique (id, origin),
  constraint notification_intents_scope_identity_key
    unique nulls not distinct (id, scope_kind, tenant_id, user_id)
);

create index notification_intents_tenant_occurred_idx
  on notification_intents (tenant_id, occurred_at desc, id desc)
  where scope_kind = 'tenant';
create index notification_intents_user_occurred_idx
  on notification_intents (user_id, occurred_at desc, id desc)
  where scope_kind = 'account';

create table notification_intent_recipients (
  intent_id text not null,
  origin text not null,
  recipient_user_id text not null references "user" (id) on delete cascade,
  scope_kind text not null check (scope_kind in ('tenant', 'account')),
  tenant_id uuid references organization (id) on delete cascade,
  user_id text references "user" (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (intent_id, recipient_user_id),
  constraint notification_intent_recipients_origin_recipient_key
    unique (origin, recipient_user_id),
  constraint notification_intent_recipients_intent_origin_fkey
    foreign key (intent_id, origin)
    references notification_intents (id, origin) on delete cascade,
  constraint notification_intent_recipients_intent_scope_fkey
    foreign key (intent_id, scope_kind, tenant_id, user_id)
    references notification_intents (id, scope_kind, tenant_id, user_id) on delete cascade,
  constraint notification_intent_recipients_scope_check check (
    (scope_kind = 'tenant' and tenant_id is not null and user_id is null)
    or
    (scope_kind = 'account' and tenant_id is null and user_id = recipient_user_id)
  )
);

create index notification_intent_recipients_tenant_idx
  on notification_intent_recipients (tenant_id, recipient_user_id)
  where scope_kind = 'tenant';
create index notification_intent_recipients_user_idx
  on notification_intent_recipients (user_id, recipient_user_id)
  where scope_kind = 'account';

create table notification_inbox_items (
  id text primary key,
  intent_id text not null references notification_intents (id) on delete cascade,
  origin text not null,
  recipient_user_id text not null references "user" (id) on delete cascade,
  scope_kind text not null check (scope_kind in ('tenant', 'account')),
  tenant_id uuid references organization (id) on delete cascade,
  user_id text references "user" (id) on delete cascade,
  event_type text not null check (event_type in (
    'ORG-NOTIFICATION-SETTINGS-CHANGED',
    'PASSWORD_CHANGED',
    'MFA_ENABLED',
    'MFA_DISABLED'
  )),
  occurred_at timestamptz not null,
  expires_at timestamptz not null,
  actor_user_id text references "user" (id) on delete set null,
  actor_display_name text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_inbox_items_origin_recipient_key
    unique (origin, recipient_user_id),
  constraint notification_inbox_items_intent_origin_fkey
    foreign key (intent_id, origin)
    references notification_intents (id, origin) on delete cascade,
  constraint notification_inbox_items_intent_scope_fkey
    foreign key (intent_id, scope_kind, tenant_id, user_id)
    references notification_intents (id, scope_kind, tenant_id, user_id) on delete cascade,
  constraint notification_inbox_items_scope_check check (
    (scope_kind = 'tenant' and tenant_id is not null and user_id is null
      and event_type = 'ORG-NOTIFICATION-SETTINGS-CHANGED')
    or
    (scope_kind = 'account' and tenant_id is null and user_id = recipient_user_id
      and event_type in ('PASSWORD_CHANGED', 'MFA_ENABLED', 'MFA_DISABLED'))
  )
);

create index notification_inbox_items_tenant_visible_idx
  on notification_inbox_items (tenant_id, recipient_user_id, occurred_at desc, id desc)
  where scope_kind = 'tenant';
create index notification_inbox_items_user_visible_idx
  on notification_inbox_items (user_id, recipient_user_id, occurred_at desc, id desc)
  where scope_kind = 'account';

create table notification_account_mfa_state (
  user_id text primary key references "user" (id) on delete cascade,
  verified_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- The dispatch ledger has no presentation or protected event content. Runtime
-- code can create a scope-bound entry, but only its bounded SECURITY DEFINER
-- claim function can discover unclaimed work before a tenant/account context.
create table notification_dispatch_ledger (
  id text primary key,
  intent_id text not null unique references notification_intents (id) on delete cascade,
  scope_kind text not null check (scope_kind in ('tenant', 'account')),
  tenant_id uuid references organization (id) on delete cascade,
  user_id text references "user" (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'enqueued', 'failed', 'completed')),
  claim_token text,
  claimed_at timestamptz,
  enqueued_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_dispatch_ledger_scope_check check (
    (scope_kind = 'tenant' and tenant_id is not null and user_id is null)
    or
    (scope_kind = 'account' and tenant_id is null and user_id is not null)
  ),
  constraint notification_dispatch_ledger_intent_scope_fkey
    foreign key (intent_id, scope_kind, tenant_id, user_id)
    references notification_intents (id, scope_kind, tenant_id, user_id) on delete cascade
);

create index notification_dispatch_ledger_claim_idx
  on notification_dispatch_ledger (status, created_at, id);

-- `timestamptz + interval` is not immutable, so PostgreSQL cannot use it in
-- a generated column. The trigger keeps expiry bound to event occurrence,
-- never enqueue or read time.
create function notification_set_expiry()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.expires_at := new.occurred_at + interval '30 days';
  return new;
end;
$$;

create trigger notification_intents_set_expiry
before insert or update of occurred_at on notification_intents
for each row execute function notification_set_expiry();
create trigger notification_inbox_items_set_expiry
before insert or update of occurred_at on notification_inbox_items
for each row execute function notification_set_expiry();

alter table notification_org_settings enable row level security;
alter table notification_org_settings force row level security;
alter table notification_intents enable row level security;
alter table notification_intents force row level security;
alter table notification_intent_recipients enable row level security;
alter table notification_intent_recipients force row level security;
alter table notification_inbox_items enable row level security;
alter table notification_inbox_items force row level security;
alter table notification_account_mfa_state enable row level security;
alter table notification_account_mfa_state force row level security;
alter table notification_dispatch_ledger enable row level security;
alter table notification_dispatch_ledger force row level security;

create policy notification_org_settings_tenant_context on notification_org_settings
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy notification_org_settings_tenant_access on notification_org_settings
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy notification_intents_tenant_context on notification_intents
  as restrictive for all to nightwatch
  using (scope_kind <> 'tenant' or nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (scope_kind <> 'tenant' or nullif(current_setting('app.tenant_id', true), '') is not null);
create policy notification_intents_account_context on notification_intents
  as restrictive for all to nightwatch
  using (scope_kind <> 'account' or nullif(current_setting('app.user_id', true), '') is not null)
  with check (scope_kind <> 'account' or nullif(current_setting('app.user_id', true), '') is not null);
create policy notification_intents_tenant_access on notification_intents
  for all to nightwatch
  using (scope_kind = 'tenant' and tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (scope_kind = 'tenant' and tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy notification_intents_account_access on notification_intents
  for all to nightwatch
  using (scope_kind = 'account' and user_id = nullif(current_setting('app.user_id', true), ''))
  with check (scope_kind = 'account' and user_id = nullif(current_setting('app.user_id', true), ''));

create policy notification_intent_recipients_tenant_context on notification_intent_recipients
  as restrictive for all to nightwatch
  using (scope_kind <> 'tenant' or nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (scope_kind <> 'tenant' or nullif(current_setting('app.tenant_id', true), '') is not null);
create policy notification_intent_recipients_account_context on notification_intent_recipients
  as restrictive for all to nightwatch
  using (scope_kind <> 'account' or nullif(current_setting('app.user_id', true), '') is not null)
  with check (scope_kind <> 'account' or nullif(current_setting('app.user_id', true), '') is not null);
create policy notification_intent_recipients_tenant_access on notification_intent_recipients
  for all to nightwatch
  using (scope_kind = 'tenant' and tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (scope_kind = 'tenant' and tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy notification_intent_recipients_account_access on notification_intent_recipients
  for all to nightwatch
  using (scope_kind = 'account' and user_id = nullif(current_setting('app.user_id', true), ''))
  with check (scope_kind = 'account' and user_id = nullif(current_setting('app.user_id', true), ''));

create policy notification_inbox_items_tenant_context on notification_inbox_items
  as restrictive for all to nightwatch
  using (scope_kind <> 'tenant' or nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (scope_kind <> 'tenant' or nullif(current_setting('app.tenant_id', true), '') is not null);
create policy notification_inbox_items_account_context on notification_inbox_items
  as restrictive for all to nightwatch
  using (scope_kind <> 'account' or nullif(current_setting('app.user_id', true), '') is not null)
  with check (scope_kind <> 'account' or nullif(current_setting('app.user_id', true), '') is not null);
create policy notification_inbox_items_tenant_access on notification_inbox_items
  for all to nightwatch
  using (scope_kind = 'tenant' and tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (scope_kind = 'tenant' and tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy notification_inbox_items_account_access on notification_inbox_items
  for all to nightwatch
  using (scope_kind = 'account' and user_id = nullif(current_setting('app.user_id', true), ''))
  with check (scope_kind = 'account' and user_id = nullif(current_setting('app.user_id', true), ''));

create policy notification_account_mfa_state_user_context on notification_account_mfa_state
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.user_id', true), '') is not null)
  with check (nullif(current_setting('app.user_id', true), '') is not null);
create policy notification_account_mfa_state_user_access on notification_account_mfa_state
  for all to nightwatch
  using (user_id = nullif(current_setting('app.user_id', true), ''))
  with check (user_id = nullif(current_setting('app.user_id', true), ''));

create policy notification_dispatch_ledger_owner_access on notification_dispatch_ledger
  for all to nightwatch_owner
  using (true)
  with check (true);
create policy notification_dispatch_ledger_tenant_insert on notification_dispatch_ledger
  for insert to nightwatch
  with check (
    scope_kind = 'tenant'
    and tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id is null
  );
create policy notification_dispatch_ledger_account_insert on notification_dispatch_ledger
  for insert to nightwatch
  with check (
    scope_kind = 'account'
    and tenant_id is null
    and user_id = nullif(current_setting('app.user_id', true), '')
  );

grant select, insert, update on notification_org_settings to nightwatch;
grant select, insert on notification_intents to nightwatch;
grant select, insert on notification_intent_recipients to nightwatch;
grant select, insert, update on notification_inbox_items to nightwatch;
grant select, insert, update on notification_account_mfa_state to nightwatch;
grant insert on notification_dispatch_ledger to nightwatch;

create function claim_notification_dispatches(p_claim_token text, p_limit integer)
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

revoke all on function claim_notification_dispatches(text, integer) from public;
grant execute on function claim_notification_dispatches(text, integer) to nightwatch;

-- Recovery is deliberately bounded and token-guarded. A process that crashes
-- after claim but before/partway through enqueue leaves a lease that this
-- restricted function requeues; it cannot read ledger content or alter a
-- different claim.
create function requeue_stale_notification_dispatches(
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
    where ledger.id = selected.id
    returning ledger.id
  )
  select requeued.id from requeued;
end;
$$;

create function mark_notification_dispatch_enqueued(
  p_id text,
  p_claim_token text
)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  with marked as (
    update notification_dispatch_ledger
    set status = 'enqueued',
        enqueued_at = now(),
        updated_at = now()
    where id = p_id
      and status = 'claimed'
      and claim_token = p_claim_token
    returning 1
  )
  select exists(select 1 from marked);
$$;

create function fail_notification_dispatch(
  p_id text,
  p_claim_token text
)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  with failed as (
    update notification_dispatch_ledger
    set status = 'failed',
        updated_at = now()
    where id = p_id
      and status in ('claimed', 'enqueued')
      and claim_token = p_claim_token
    returning 1
  )
  select exists(select 1 from failed);
$$;

revoke all on function requeue_stale_notification_dispatches(timestamptz, integer) from public;
revoke all on function mark_notification_dispatch_enqueued(text, text) from public;
revoke all on function fail_notification_dispatch(text, text) from public;
grant execute on function requeue_stale_notification_dispatches(timestamptz, integer) to nightwatch;
grant execute on function mark_notification_dispatch_enqueued(text, text) to nightwatch;
grant execute on function fail_notification_dispatch(text, text) to nightwatch;

create function resolve_notification_dispatch_claim(
  p_id text,
  p_claim_token text
)
returns table (
  intent_id text,
  scope_kind text,
  tenant_id uuid,
  user_id text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select ledger.intent_id, ledger.scope_kind, ledger.tenant_id, ledger.user_id
  from notification_dispatch_ledger as ledger
  where ledger.id = p_id
    and ledger.claim_token = p_claim_token
    and ledger.status in ('claimed', 'enqueued');
$$;

create function complete_notification_dispatch(
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
        updated_at = now()
    where id = p_id
      and status = 'enqueued'
      and claim_token = p_claim_token
    returning 1
  )
  select exists(select 1 from completed);
$$;

revoke all on function resolve_notification_dispatch_claim(text, text) from public;
revoke all on function complete_notification_dispatch(text, text) from public;
grant execute on function resolve_notification_dispatch_claim(text, text) to nightwatch;
grant execute on function complete_notification_dispatch(text, text) to nightwatch;

create function purge_expired_notification_inbox_items(p_limit integer)
returns table (id text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'notification inbox purge limit must be between 1 and 100';
  end if;

  return query
  with selected as (
    select item.id
    from notification_inbox_items as item
    where item.expires_at <= now()
    order by item.expires_at, item.id
    for update skip locked
    limit p_limit
  ), purged as (
    delete from notification_inbox_items as item
    using selected
    where item.id = selected.id
    returning item.id
  )
  select purged.id from purged;
end;
$$;

revoke all on function purge_expired_notification_inbox_items(integer) from public;
grant execute on function purge_expired_notification_inbox_items(integer) to nightwatch;
