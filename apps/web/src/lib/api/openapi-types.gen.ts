/**
 * GENERATED FILE — DO NOT EDIT.
 * Produced by `bun run codegen` (apps/web/scripts/codegen-openapi.mjs) from
 * the apps/api OpenAPI document (GET /api/v1/openapi.json, emitted in-process
 * by apps/api's `bun run emit-openapi`). Regenerate after contract changes.
 */

export interface paths {
    "/api/onboarding/invitations/{invitationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Public invitation preview for the accept-invitation page */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    invitationId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Pending, unexpired invitation preview */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            invitation: {
                                id: string;
                                /** Format: email */
                                email: string;
                                organizationName: string;
                                /** @enum {string} */
                                role: "owner" | "admin" | "viewer" | "auditor";
                                /** Format: date-time */
                                expiresAt: string;
                            };
                        };
                    };
                };
                /** @description Unknown, expired or cancelled invitation */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/me/context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Authenticated context for tenant selection */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Verified session, memberships and active selection */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            user: {
                                id: string;
                                name: string;
                                /** Format: email */
                                email: string;
                                emailVerified: boolean;
                                twoFactorEnabled: boolean;
                            };
                            organizations: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                slug: string;
                                /** @enum {string} */
                                role: "owner" | "admin" | "viewer" | "auditor";
                            }[];
                            /** Format: uuid */
                            lastActiveTenantId: string | null;
                        };
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description Email not verified */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/me/active-org": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Switch the active organization (membership-verified) */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        organizationId: string;
                    };
                };
            };
            responses: {
                /** @description Updated context with the new active selection */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            user: {
                                id: string;
                                name: string;
                                /** Format: email */
                                email: string;
                                emailVerified: boolean;
                                twoFactorEnabled: boolean;
                            };
                            organizations: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                slug: string;
                                /** @enum {string} */
                                role: "owner" | "admin" | "viewer" | "auditor";
                            }[];
                            /** Format: uuid */
                            lastActiveTenantId: string | null;
                        };
                    };
                };
                /** @description Invalid input */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description Email not verified or not an organization member */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness probe */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Process is alive */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            status: "ok";
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Readiness probe (database check; no Redis in this phase) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Service is ready */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            status: "ready" | "not_ready";
                            checks: {
                                [key: string]: "ok" | "fail";
                            };
                        };
                    };
                };
                /** @description Service is not ready */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            status: "ready" | "not_ready";
                            checks: {
                                [key: string]: "ok" | "fail";
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/version": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Service identity */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Name and version from package.json */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            name: string;
                            version: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/hello": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Greeting vertical slice */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Greeting with the server timestamp */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            message: string;
                            /** Format: date-time */
                            timestamp: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
