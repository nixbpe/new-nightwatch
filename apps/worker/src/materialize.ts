import { z } from "zod";

import {
  resolveNotificationDispatchClaim,
  withAccountContextRaw,
  withTenantContextRaw,
  type Database,
} from "@nightwatch/db";

const notificationScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account"), userId: z.string().min(1) }),
  z.object({ kind: z.literal("tenant"), tenantId: z.uuid() }),
]);

export type NotificationScope = z.infer<typeof notificationScopeSchema>;

const materializeJobDataSchema = z.object({
  dispatchId: z.string().min(1),
  claimToken: z.string().min(1),
  scope: notificationScopeSchema,
});

export type MaterializeJobData = z.infer<typeof materializeJobDataSchema>;

type ResolvedClaim = {
  intentId: string;
  scope: NotificationScope;
};

export type MaterializationDependencies = {
  resolveClaim: (
    dispatchId: string,
    claimToken: string,
  ) => Promise<ResolvedClaim | null>;
  materializeAndComplete: (
    claim: ResolvedClaim,
    dispatchId: string,
    claimToken: string,
  ) => Promise<void>;
};

export function assertMaterializeJobData(
  value: unknown,
): asserts value is MaterializeJobData {
  materializeJobDataSchema.parse(value);
}

// Payload scope is untrusted transport metadata; the ledger claim is authoritative.
export async function processMaterialization(
  job: MaterializeJobData,
  dependencies: MaterializationDependencies,
): Promise<void> {
  const claim = await dependencies.resolveClaim(job.dispatchId, job.claimToken);
  if (!claim) throw new Error("notification dispatch claim is unavailable");
  if (!sameScope(job.scope, claim.scope)) {
    throw new Error("job scope does not match the committed dispatch claim");
  }
  await dependencies.materializeAndComplete(
    claim,
    job.dispatchId,
    job.claimToken,
  );
}

export function createMaterializationDependencies(
  database: Database,
): MaterializationDependencies {
  return {
    async resolveClaim(dispatchId, claimToken) {
      const claim = await resolveNotificationDispatchClaim(database, {
        id: dispatchId,
        claimToken,
      });
      if (!claim) return null;
      const scope = toScope(claim.scopeKind, claim.tenantId, claim.userId);
      return scope ? { intentId: claim.intentId, scope } : null;
    },
    async materializeAndComplete(claim, dispatchId, claimToken) {
      const materialize = async (client: {
        query: (text: string, values?: string[]) => Promise<unknown>;
      }) => {
        if (claim.scope.kind === "account") {
          await client.query(
            `insert into notification_inbox_items
            (id, intent_id, origin, recipient_user_id, scope_kind, user_id,
             event_type, occurred_at, actor_user_id, actor_display_name)
           select gen_random_uuid()::text,
                  intent.id, intent.origin, recipient.recipient_user_id, intent.scope_kind,
                  intent.user_id, intent.event_type, intent.occurred_at,
                  intent.actor_user_id, intent.actor_display_name
           from notification_intents as intent
           join notification_intent_recipients as recipient
             on recipient.intent_id = intent.id
           where intent.id = $1
             and intent.scope_kind = 'account'
             and recipient.scope_kind = 'account'
             and recipient.recipient_user_id = $2
             and intent.expires_at > now()
           on conflict (origin, recipient_user_id) do nothing`,
            [claim.intentId, claim.scope.userId],
          );
          return;
        }

        await client.query(
          "select 1 from organization where id = $1 for share",
          [claim.scope.tenantId],
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtext($1)::bigint)",
          [`notification-membership:${claim.scope.tenantId}`],
        );
        await client.query(
          `insert into notification_inbox_items
          (id, intent_id, origin, recipient_user_id, scope_kind, tenant_id,
           event_type, occurred_at, actor_user_id, actor_display_name,
           subject_monitor_id, subject_monitor_name, monitor_reason, ssl_not_after,
           subject_audit_export_id)
         select gen_random_uuid()::text,
                intent.id, intent.origin, recipient.recipient_user_id, intent.scope_kind,
                intent.tenant_id, intent.event_type, intent.occurred_at,
                intent.actor_user_id, intent.actor_display_name,
                intent.subject_monitor_id, intent.subject_monitor_name,
                intent.monitor_reason, intent.ssl_not_after,
                intent.subject_audit_export_id
         from notification_intents as intent
         join notification_intent_recipients as recipient
           on recipient.intent_id = intent.id
         join member as current_member
           on current_member.organization_id = intent.tenant_id
          and current_member.user_id = recipient.recipient_user_id
          and (
            -- An export result goes to its requester while they are a member (P-07).
            intent.event_type in ('AUDIT_EXPORT_READY', 'AUDIT_EXPORT_FAILED')
            or exists (
              select 1
              from unnest(string_to_array(current_member.role, ',')) as role_token(value)
              where btrim(role_token.value) in ('owner', 'admin')
            )
          )
         where intent.id = $1
           and intent.scope_kind = 'tenant'
           and recipient.scope_kind = 'tenant'
           and intent.expires_at > now()
         on conflict (origin, recipient_user_id) do nothing`,
          [claim.intentId],
        );
      };
      const complete = async (client: {
        query: (
          text: string,
          values: string[],
        ) => Promise<{ rows: { updated: boolean }[] }>;
      }) => {
        const result = await client.query(
          "select complete_notification_dispatch($1, $2) as updated",
          [dispatchId, claimToken],
        );
        if (result.rows[0]?.updated !== true) {
          throw new Error("notification dispatch acknowledgement failed");
        }
      };

      if (claim.scope.kind === "account") {
        return withAccountContextRaw(
          database,
          claim.scope.userId,
          async (client) => {
            await materialize(client);
            return complete(client);
          },
        );
      }
      return withTenantContextRaw(
        database,
        claim.scope.tenantId,
        async (client) => {
          await materialize(client);
          return complete(client);
        },
      );
    },
  };
}

function toScope(
  kind: "tenant" | "account",
  tenantId: string | null,
  userId: string | null,
): NotificationScope | null {
  const result = notificationScopeSchema.safeParse(
    kind === "account" && tenantId === null
      ? { kind, userId }
      : kind === "tenant" && userId === null
        ? { kind, tenantId }
        : null,
  );
  return result.success ? result.data : null;
}
function sameScope(left: NotificationScope, right: NotificationScope): boolean {
  if (left.kind === "account") {
    return right.kind === "account" && left.userId === right.userId;
  }
  return right.kind === "tenant" && left.tenantId === right.tenantId;
}
