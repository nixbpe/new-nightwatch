-- Minimum grant (TSQL-13): the runtime only ever marks inbox items read, so
-- it may update read_at alone. RLS WITH CHECK constrains only the scope, so a
-- table-wide UPDATE would let runtime statements retarget recipients or
-- rewrite event, actor, and occurrence fields.
revoke update on notification_inbox_items from nightwatch;
grant update (read_at) on notification_inbox_items to nightwatch;
