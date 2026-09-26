-- Backfill only the effective verified-MFA baseline for users that predate the
-- notification projection. This intentionally creates no intent, dispatch, or inbox rows.
--
-- The native auth mutation changes the Better Auth source rows before it calls
-- recordAccountMfaTransition. Locking those source rows before the shared
-- advisory lock uses the same order, preventing a migration/auth deadlock and
-- making each source read and projection write one ordered per-user operation.
do $$
declare
  v_user_id text;
  v_verified boolean;
begin
  for v_user_id in
    select u.id
    from "user" as u
    join "twoFactor" as two_factor on two_factor.user_id = u.id
    where u.two_factor_enabled is true
      and two_factor.verified is true
  loop
    select true
    into v_verified
    from "user" as u
    join "twoFactor" as two_factor on two_factor.user_id = u.id
    where u.id = v_user_id
      and u.two_factor_enabled is true
      and two_factor.verified is true
    for update of u, two_factor;

    if v_verified then
      perform pg_advisory_xact_lock(
        hashtext('notification-mfa:' || v_user_id)::bigint
      );

      insert into notification_account_mfa_state (user_id, verified_enabled)
      values (v_user_id, true)
      on conflict (user_id) do update
        set verified_enabled = excluded.verified_enabled,
            updated_at = now()
        where notification_account_mfa_state.verified_enabled is distinct from excluded.verified_enabled;
    end if;
  end loop;
end $$;
