-- Pending invitation management (F-006): public_id names a row in list,
-- resend and cancel without exposing invitation.id (the bearer token of the
-- link); sent_at is the last send time that drives the resend cooldown.
-- Existing rows get sent_at = created_at and one random public_id each.

alter table invitation
  add column public_id uuid not null default gen_random_uuid(),
  add column sent_at timestamptz;
update invitation set sent_at = created_at;
alter table invitation
  alter column sent_at set default now(),
  alter column sent_at set not null;
create unique index invitation_public_id_key on invitation (public_id);
