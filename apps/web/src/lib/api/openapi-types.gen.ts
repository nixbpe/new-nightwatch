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
    "/api/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List visible notification inbox items */
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    cursor?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Visible personal and active-organization items */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: ({
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                scope: "account";
                                organizationId: unknown;
                                /** @enum {string} */
                                eventType: "PASSWORD_CHANGED" | "MFA_ENABLED" | "MFA_DISABLED";
                                /** Format: date-time */
                                occurredAt: string;
                                /** Format: date-time */
                                readAt: string | null;
                                actor: unknown;
                                category: unknown;
                            } | {
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                scope: "organization";
                                /** Format: uuid */
                                organizationId: string;
                                /** @enum {string} */
                                eventType: "ORG-NOTIFICATION-SETTINGS-CHANGED";
                                /** Format: date-time */
                                occurredAt: string;
                                /** Format: date-time */
                                readAt: string | null;
                                actor: {
                                    displayName: string;
                                };
                                /** @enum {string} */
                                category: "notification-settings";
                            })[];
                            nextCursor: string | null;
                            unreadCount: number;
                            /** Format: uuid */
                            organizationId: string | null;
                        };
                    };
                };
                /** @description Invalid request input or cursor */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "INVALID_INPUT";
                                message: string;
                                details?: unknown;
                            };
                        } | {
                            error: {
                                /** @enum {string} */
                                code: "INVALID_CURSOR";
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
                                /** @enum {string} */
                                code: "UNAUTHENTICATED";
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description Email is not verified */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "EMAIL_NOT_VERIFIED";
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
    "/api/notifications/unread-count": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Count unread visible notification inbox items */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Unread count for visible notification scope */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            unreadCount: number;
                            /** Format: uuid */
                            organizationId: string | null;
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
                                /** @enum {string} */
                                code: "UNAUTHENTICATED";
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description Email is not verified */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "EMAIL_NOT_VERIFIED";
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
    "/api/notifications/{id}/open": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Open a notification and atomically mark it read */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Opened notification detail */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            scope: "account";
                            organizationId: unknown;
                            /** @enum {string} */
                            eventType: "PASSWORD_CHANGED" | "MFA_ENABLED" | "MFA_DISABLED";
                            /** Format: date-time */
                            occurredAt: string;
                            /** Format: date-time */
                            readAt: string | null;
                            actor: unknown;
                            category: unknown;
                        } | {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            scope: "organization";
                            /** Format: uuid */
                            organizationId: string;
                            /** @enum {string} */
                            eventType: "ORG-NOTIFICATION-SETTINGS-CHANGED";
                            /** Format: date-time */
                            occurredAt: string;
                            /** Format: date-time */
                            readAt: string | null;
                            actor: {
                                displayName: string;
                            };
                            /** @enum {string} */
                            category: "notification-settings";
                        };
                    };
                };
                /** @description Invalid request input */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "INVALID_INPUT";
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
                                /** @enum {string} */
                                code: "UNAUTHENTICATED";
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description Email is not verified */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "EMAIL_NOT_VERIFIED";
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description Notification item is not visible or no longer exists */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "NOTIFICATION_NOT_FOUND";
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/notifications/{id}/read": {
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
        /** Mark a notification read */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The notification read transition */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** Format: date-time */
                            readAt: string;
                        };
                    };
                };
                /** @description Invalid request input */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "INVALID_INPUT";
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
                                /** @enum {string} */
                                code: "UNAUTHENTICATED";
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description Email is not verified */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "EMAIL_NOT_VERIFIED";
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description Notification item is not visible or no longer exists */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "NOTIFICATION_NOT_FOUND";
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
    "/api/notifications/read-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark all currently visible notifications read */
        post: {
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
                        expectedOrganizationId: string | null;
                    };
                };
            };
            responses: {
                /** @description Count of items newly marked read */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            markedCount: number;
                        };
                    };
                };
                /** @description Invalid request input */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "INVALID_INPUT";
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
                                /** @enum {string} */
                                code: "UNAUTHENTICATED";
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description Email is not verified */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "EMAIL_NOT_VERIFIED";
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description The server resolves a different active scope than expected */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "INBOX_SCOPE_CHANGED";
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/organizations/{organizationId}/notification-settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get organization notification settings */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    organizationId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Organization notification settings */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            organizationId: string;
                            settingsChangedEnabled: boolean;
                            version: number;
                        };
                    };
                };
                /** @description Invalid request input */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "INVALID_INPUT";
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
                                /** @enum {string} */
                                code: "UNAUTHENTICATED";
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description Email is unverified, membership is denied, or permission is denied */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "EMAIL_NOT_VERIFIED";
                                message: string;
                                details?: unknown;
                            };
                        } | {
                            error: {
                                /** @enum {string} */
                                code: "MEMBERSHIP_DENIED";
                                message: string;
                                details?: unknown;
                            };
                        } | {
                            error: {
                                /** @enum {string} */
                                code: "PERMISSION_DENIED";
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
        /** Update organization notification settings with compare-and-swap */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    organizationId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        settingsChangedEnabled: boolean;
                        expectedVersion: number;
                    };
                };
            };
            responses: {
                /** @description Updated organization notification settings */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            organizationId: string;
                            settingsChangedEnabled: boolean;
                            version: number;
                        };
                    };
                };
                /** @description Invalid request input */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "INVALID_INPUT";
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
                                /** @enum {string} */
                                code: "UNAUTHENTICATED";
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description Email is unverified, membership is denied, or permission is denied */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "EMAIL_NOT_VERIFIED";
                                message: string;
                                details?: unknown;
                            };
                        } | {
                            error: {
                                /** @enum {string} */
                                code: "MEMBERSHIP_DENIED";
                                message: string;
                                details?: unknown;
                            };
                        } | {
                            error: {
                                /** @enum {string} */
                                code: "PERMISSION_DENIED";
                                message: string;
                                details?: unknown;
                            };
                        };
                    };
                };
                /** @description The settings version is stale */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "SETTINGS_VERSION_CONFLICT";
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
    "/api/organizations/{organizationId}/members/{memberId}/role": {
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
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    organizationId: string;
                    memberId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        role: "owner" | "admin" | "viewer" | "auditor";
                    };
                };
            };
            responses: {
                /** @description Updated member */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            member: {
                                id: string;
                                userId: string;
                                /** Format: uuid */
                                organizationId: string;
                                /** @enum {string} */
                                role: "owner" | "admin" | "viewer" | "auditor";
                            };
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/organizations/{organizationId}/members/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    organizationId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Left organization */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            member: {
                                id: string;
                                userId: string;
                                /** Format: uuid */
                                organizationId: string;
                                /** @enum {string} */
                                role: "owner" | "admin" | "viewer" | "auditor";
                            };
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/organizations/{organizationId}/members/{memberId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    organizationId: string;
                    memberId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Revoked member */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            member: {
                                id: string;
                                userId: string;
                                /** Format: uuid */
                                organizationId: string;
                                /** @enum {string} */
                                role: "owner" | "admin" | "viewer" | "auditor";
                            };
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
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
