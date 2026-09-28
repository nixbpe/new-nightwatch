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
  "/organization/invite-member": true,
  "/organization/accept-invitation": true,
};

// Forwards only a same-origin invitationId, never the raw callbackURL, so the
// verification email cannot become an open redirect.
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

// `getSession` is the only session entry point application code may use.
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

  // No `ac`: evaluation reads each role's own statements, and the default AC's
  // `newRole` generic doesn't fit the `ac` slot.
  const organizationOptions = {
    roles: organizationRoles,
    allowUserToCreateOrganization: false,
    membershipLimit: 1000,
    requireEmailVerificationOnInvitation: true,
    sendInvitationEmail: async (data) => {
      const mail = buildInvitationEmail(authEnv, {
        organizationName: data.organization.name,
        invitationId: data.id,
        inviterName: data.inviter.user.name,
        role: data.role,
      });
      await mailer.send({ ...mail, to: data.email });
    },
  } satisfies OrganizationOptions;
  const plugins = [
    organization(organizationOptions),
    twoFactor({ issuer: "NightWatch" }),
  ];

  const auth = betterAuth({
    appName: "NightWatch",
    baseURL: authEnv.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: authEnv.BETTER_AUTH_SECRET,
    trustedOrigins: [authEnv.CORS_ORIGIN],
    // The default logger can leak SQL, parameters and invitation IDs.
    logger: { disabled: true },
    onAPIError: {
      onError: (error) => {
        if (error instanceof APIError && error.statusCode < 500) return;
        logger.error(
          { component: "better-auth", event: "api_error" },
          "authentication API request failed",
        );
        // Rethrowing sanitized stops the router logging the original error.
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
        // Not awaited: timing must not reveal whether the account exists.
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
        // This hook, not the UI header, is the invitation gate on raw signup.
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
