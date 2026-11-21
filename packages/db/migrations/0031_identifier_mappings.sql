-- Identifier mapping (F-018). One row per distinct vendor and product pair of a
-- Project's inventory maps it to a CPE 2.3 name or a purl. A pair is never matched
-- (F-019) until its status is 'confirmed'; 'unmapped' records that a reviewer found
-- no CPE or purl, which the UI shows as not covered, never as no CVE found.
--
-- The version is not part of the key, so a product that is confirmed once is not
-- asked about again for other versions (S2.3).

create table inventory_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  vendor_key text not null check (char_length(vendor_key) <= 200),
  product_key text not null check (char_length(product_key) <= 200),
  vendor text not null check (char_length(vendor) <= 200),
  product text not null check (char_length(product) <= 200),
  status text not null check (status in ('pending', 'confirmed', 'unmapped')),
  cpe text check (cpe is null or (char_length(cpe) <= 512 and cpe ~ '^cpe:2\.3:[aho]:')),
  purl text check (purl is null or (char_length(purl) <= 512 and purl ~ '^pkg:[a-z]')),
  -- Similarity of the suggested CPE to the inventory text, 0 to 1; null when typed by hand.
  confidence real check (confidence is null or confidence between 0 and 1),
  source text check (source is null or source in ('central', 'nvd', 'manual')),
  confirmed_by text,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint inventory_mappings_pair_key unique (project_id, vendor_key, product_key),
  constraint inventory_mappings_state check (
    case status
      when 'pending' then confirmed_at is null and (cpe is null or purl is null)
      when 'confirmed' then num_nonnulls(cpe, purl) >= 1 and confirmed_at is not null
        and source is not null
      else num_nonnulls(cpe, purl) = 0 and confirmed_at is not null
    end
  ),
  foreign key (project_id, tenant_id)
    references projects (id, tenant_id) on delete cascade
);

create index inventory_mappings_status_idx
  on inventory_mappings (tenant_id, project_id, status);

-- Projects that uploaded an inventory under 0030 have no mappings yet. Each distinct
-- vendor and product pair of their usable rows enters the review queue as pending, the
-- same pairs and keys a new upload creates, so the queue does not wait for another
-- upload. This runs before row level security is forced, as the owner role.
insert into inventory_mappings (tenant_id, project_id, vendor_key, product_key, vendor, product, status)
select distinct on (tenant_id, project_id, lower(vendor), lower(product))
  tenant_id, project_id, lower(vendor), lower(product), vendor, product, 'pending'
from inventory_rows
where usable
order by tenant_id, project_id, lower(vendor), lower(product), vendor, product;

alter table inventory_mappings enable row level security;
alter table inventory_mappings force row level security;

create policy inventory_mappings_tenant_context on inventory_mappings
  as restrictive for all to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null)
  with check (nullif(current_setting('app.tenant_id', true), '') is not null);
create policy inventory_mappings_tenant_access on inventory_mappings
  for all to nightwatch
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, delete on inventory_mappings to nightwatch;
grant update (vendor, product, status, cpe, purl, confidence, source, confirmed_by,
  confirmed_at, updated_at) on inventory_mappings to nightwatch;

-- The shared catalog (Q-05): only "vendor and product string to CPE or purl" pairs that
-- an operator of NightWatch confirmed. No Organization, Project, version or user count.
-- Requests read it inside a tenant context (DB-05); only the owner role writes it.
create table catalog_product_mappings (
  vendor_key text not null check (char_length(vendor_key) <= 200),
  product_key text not null check (char_length(product_key) <= 200),
  cpe text check (cpe is null or (char_length(cpe) <= 512 and cpe ~ '^cpe:2\.3:[aho]:')),
  purl text check (purl is null or (char_length(purl) <= 512 and purl ~ '^pkg:[a-z]')),
  created_at timestamptz not null default now(),
  primary key (vendor_key, product_key),
  check (num_nonnulls(cpe, purl) >= 1)
);

alter table catalog_product_mappings enable row level security;
alter table catalog_product_mappings force row level security;

create policy catalog_product_mappings_read on catalog_product_mappings
  for select to nightwatch
  using (nullif(current_setting('app.tenant_id', true), '') is not null);

grant select on catalog_product_mappings to nightwatch;

alter table audit_events drop constraint audit_events_action_check;
alter table audit_events add constraint audit_events_action_check check (
  action in (
    'organization.monitor.create', 'organization.monitor.update', 'organization.monitor.pause',
    'organization.monitor.resume', 'organization.monitor.delete', 'organization.monitor.secret.set',
    'organization.monitor.secret.replace', 'organization.notification-settings.monitor-alerts.update',
    'organization.notification-settings.update', 'organization.member.role.update',
    'organization.member.revoke', 'organization.member.leave', 'organization.invitation.create',
    'organization.invitation.resend', 'organization.invitation.cancel', 'organization.audit-log.export',
    'organization.project.create', 'organization.project.update', 'organization.project.delete',
    'organization.project.member.add', 'organization.project.member.role.update',
    'organization.project.member.remove',
    'organization.aws_connection.tested', 'organization.aws_connection.updated',
    'organization.aws_connection.disconnected',
    'organization.aws_connection.test', 'organization.aws_connection.update',
    'organization.aws_connection.delete',
    'organization.project.aws_connection.test', 'organization.project.aws_connection.update',
    'organization.project.aws_connection.delete',
    'organization.project.inventory.upload',
    'organization.project.inventory.mapping.update'
  )
);
