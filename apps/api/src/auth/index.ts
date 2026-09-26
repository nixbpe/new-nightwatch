import {
  initializeAccountMfaState,
  insertAccountNotificationIntent,
  recordAccountMfaTransition,
  type Database,
  type NotificationTransaction,
} from "@nightwatch/db";
import {
  AppError,
  type AuthEnv,
  type Env,
  type Logger,
} from "@nightwatch/shared";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  organization,
  type OrganizationOptions,
  twoFactor,
} from "better-auth/plugins";

import {
  buildInvitationEmail,
  buildResetPasswordEmail,
  buildVerificationEmail,
} from "./emails";
import { assertInvitationAdmitsSignup } from "./invitations";
import type { Mailer } from "./mailer";
import {
  markResetCredentialWrite,
  type AccountNotificationOriginWriter,
  withAccountNotificationOrigins,
} from "./auth-origin-intents";
import { withMemberRaceTranslation } from "./member-race";
import { organizationRoles } from "./permissions";

const BLOCKED_NATIVE_ORGANIZATION_MUTATION_PATHS: Record<string, true> = {
  "/organization/update-member-role": true,
  "/organization/remove-member": true,
  "/organization/leave": true,
};

/**
 * Extract the invitation continuation ID from the signup's callbackURL.
 * Only a same-origin callbackURL qualifies, and only the invitationId
 * value itself is ever forwarded — never the raw callbackURL — so the
 * verification email cannot become an open redirect into arbitrary
 * origins.
 */
export function extractInvitationContinuation(
  authEnv: AuthEnv,
  verifyUrl: string,
): string | null {
  let callback: string | null;
  try {
    callback = new URL(verifyUrl).searchParams.get("callbackURL");
  } catch {
    return null;
  }
  if (!callback) return null;
  try {
    const callbackUrl = new URL(callback, authEnv.APP_URL);
    if (callbackUrl.origin !== new URL(authEnv.APP_URL).origin) {
      return null;
    }
    const invitationId = callbackUrl.searchParams.get("invitationId");
    if (invitationId && /^[A-Za-z0-9_-]{1,64}$/.test(invitationId)) {
      return invitationId;
    }
    return null;
  } catch {
    return null;
  }
}

/** Session view exposed to the app and the later OrgAccess slice. */
export type AuthSession = {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    twoFactorEnabled?: boolean | null;
  };
  session: {
    id: string;
    token: string;
    expiresAt: Date | string;
  };
};

/**
 * Composed authentication boundary. `handler` mounts the raw Better Auth
 * endpoints at /api/auth/*; `getSession` is the only session entry point
 * application code may use (auth.api.getSession with request headers).
 */

export type Auth = {
  handler: (request: Request) => Promise<Response>;
  getSession: (headers: Headers) => Promise<AuthSession | null>;
};
export type AuthDeps = {
  env: Env;
  authEnv: AuthEnv;
  logger: Logger;
  database: Database;
  mailer: Mailer;
  originWriter?: AccountNotificationOriginWriter<NotificationTransaction>;
};

export function createAuth(deps: AuthDeps) {
  const {
    authEnv,
    logger,
    database,
    mailer,
    originWriter: injectedOriginWriter,
  } = deps;

  const originWriter: AccountNotificationOriginWriter<NotificationTransaction> =
    injectedOriginWriter ?? {
      insertPasswordChanged: async (tx, input) => {
        await insertAccountNotificationIntent(tx, {
          ...input,
          eventType: "PASSWORD_CHANGED",
        });
      },
      initializeMfaState: initializeAccountMfaState,
      recordMfaTransition: recordAccountMfaTransition,
    };
  let runMfaRequest: (<T>(callback: () => Promise<T>) => Promise<T>) | null =
    null;
  const transactionAdapter = (tx: NotificationTransaction) =>
    withMemberRaceTranslation(
      drizzleAdapter(tx, { provider: "pg", transaction: true }),
    );
  const adapter = withAccountNotificationOrigins(
    withMemberRaceTranslation(
      drizzleAdapter(database.db, { provider: "pg", transaction: true }),
    ),
    {
      writer: originWriter,
      transaction: (callback) => database.db.transaction(callback),
      transactionAdapter: (tx, options) => transactionAdapter(tx)(options),
      onMfaRequestReady: (runInMfaRequest) => {
        runMfaRequest = runInMfaRequest;
      },
    },
  );

  // Invitation-only admission: organizations are provisioned by the
  // operator, never created through the browser. Typed explicitly so the
  // of relying on generic overload inference. The default access-control
  // instance is deliberately not passed: permission evaluation merges the
  // plugin's default roles with `roles` below and reads each role's own
  // statements, so the default AC (permissions.ts `organizationAccess`) is
  // redundant — and its statement-bound `newRole` generic cannot be
  // assigned to the plugin's `ac` slot anyway. The only `ac`-gated
  // feature, dynamic access control, stays disabled.
  const organizationOptions = {
    roles: organizationRoles,
    allowUserToCreateOrganization: false,
    // Native acceptance boundary: acceptInvitation refuses until the
    // recipient's email is verified.
    requireEmailVerificationOnInvitation: true,
    sendInvitationEmail: async (data) => {
      const mail = buildInvitationEmail(authEnv, {
        organizationName: data.organization.name,
        invitationId: data.id,
      });
      await mailer.send({ ...mail, to: data.email });
    },
  } satisfies OrganizationOptions;
  const plugins = [
    organization(organizationOptions),
    // Optional TOTP second factor with encrypted backup-code recovery;
    // enrollment stays off until the user enables it.
    twoFactor({ issuer: "NightWatch" }),
  ];

  const auth = betterAuth({
    appName: "NightWatch",
    baseURL: authEnv.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: authEnv.BETTER_AUTH_SECRET,
    trustedOrigins: [authEnv.CORS_ORIGIN],
    // Better Auth's default logger forwards arbitrary error arguments, which
    // can include database causes, SQL text, parameters, and invitation IDs.
    // All unexpected API failures are reported by the sanitized hook below.
    logger: { disabled: true },
    onAPIError: {
      onError: (error) => {
        if (error instanceof APIError && error.statusCode < 500) return;
        logger.error(
          { component: "better-auth", event: "api_error" },
          "authentication API request failed",
        );
        // Throwing a sanitized APIError from Better Auth's supported error
        // hook prevents the underlying router from falling back to logging
        // the original exception while retaining its native response shape.
        throw new APIError("INTERNAL_SERVER_ERROR", {
          code: "AUTH_INTERNAL_ERROR",
          message: "ไม่สามารถดำเนินการยืนยันตัวตนได้",
        });
      },
    },
    database: adapter,
    databaseHooks: {
      account: {
        create: {
          before: (account, context) => {
            if (
              context?.path === "/reset-password" &&
              account.providerId === "credential" &&
              typeof account.password === "string"
            ) {
              markResetCredentialWrite(account);
            }
            return Promise.resolve();
          },
        },
      },
    },
    // UUID IDs for every model; user IDs stay text columns carrying UUID
    // values, organizations are native UUID tenant keys.
    advanced: {
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: ({ user, token }) => {
        const mail = buildResetPasswordEmail(authEnv, token);
        // Fire-and-forget: response timing must not reveal whether the
        // account exists. Failures are logged loudly, never swallowed
        // silently.
        void mailer
          .send({ ...mail, to: user.email })
          .catch((error: unknown) => {
            logger.warn({ err: error }, "password reset mail failed");
          });
        return Promise.resolve();
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url, token }) => {
        const invitationId = extractInvitationContinuation(authEnv, url);
        const mail = buildVerificationEmail(authEnv, token, invitationId);
        await mailer.send({ ...mail, to: user.email });
      },
    },
    plugins,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (BLOCKED_NATIVE_ORGANIZATION_MUTATION_PATHS[ctx.path]) {
          throw new APIError("FORBIDDEN", {
            message: "ใช้เส้นทางจัดการสมาชิกใหม่",
          });
        }
        // Invitation gate on the RAW signup endpoint: the UI sending the
        // header is not the boundary — this hook is. Without a matching
        // pending, unexpired invitation for the signup email, signup is
        // refused before any user row is written.
        if (ctx.path !== "/sign-up/email") return;
        const body = ctx.body as { email?: unknown } | undefined;
        const email = typeof body?.email === "string" ? body.email : "";
        const invitationId = ctx.headers?.get("x-invitation-id") ?? null;
        try {
          await assertInvitationAdmitsSignup(database, {
            invitationId,
            email,
          });
        } catch (error) {
          if (error instanceof AppError) {
            throw new APIError("FORBIDDEN", { message: error.message });
          }
          throw error;
        }
      }),
    },
  });

  return {
    handler: (request: Request) => {
      const path = new URL(request.url).pathname;
      if (
        runMfaRequest !== null &&
        [
          "/api/auth/two-factor/disable",
          "/api/auth/two-factor/enable",
          "/api/auth/two-factor/verify-totp",
        ].includes(path)
      ) {
        return runMfaRequest(() => auth.handler(request));
      }
      return auth.handler(request);
    },
    getSession: async (headers: Headers) => {
      const session = await auth.api.getSession({ headers });
      return session ?? null;
    },
    api: {
      ...auth.api,
      disableTwoFactor: (
        ...args: Parameters<typeof auth.api.disableTwoFactor>
      ) =>
        runMfaRequest
          ? runMfaRequest(() => auth.api.disableTwoFactor(...args))
          : auth.api.disableTwoFactor(...args),
      enableTwoFactor: (
        ...args: Parameters<typeof auth.api.enableTwoFactor>
      ) =>
        runMfaRequest
          ? runMfaRequest(() => auth.api.enableTwoFactor(...args))
          : auth.api.enableTwoFactor(...args),
      verifyTOTP: (...args: Parameters<typeof auth.api.verifyTOTP>) =>
        runMfaRequest
          ? runMfaRequest(() => auth.api.verifyTOTP(...args))
          : auth.api.verifyTOTP(...args),
    },
  };
}
