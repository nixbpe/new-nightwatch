-- ON CONFLICT (intent_id) requires SELECT on the inferred unique index. RLS
-- exposes no ledger rows to the dispatch-origin owner, so this preserves its
-- write-only scoped behavior while allowing idempotent dispatch creation.
grant select on notification_dispatch_ledger to nightwatch_notification_dispatch_origin_owner;
