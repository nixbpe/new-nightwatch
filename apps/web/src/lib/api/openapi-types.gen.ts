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
    "/api/onboarding/invitations/{invitationId}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Accept an invitation for the verified recipient */
        post: {
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
                /** @description Accepted membership */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            organizationId: string;
                        };
                    };
                };
                /** @description Invitation unavailable to this recipient */
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
                /** @description Already a member or organization at capacity */
                409: {
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
                            } | ({
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                scope: "organization";
                                /** Format: uuid */
                                organizationId: string;
                                /** Format: date-time */
                                occurredAt: string;
                                /** Format: date-time */
                                readAt: string | null;
                                /** @enum {string} */
                                eventType: "ORG-NOTIFICATION-SETTINGS-CHANGED";
                                actor: {
                                    displayName: string;
                                };
                                /** @enum {string} */
                                category: "notification-settings";
                            } | {
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                scope: "organization";
                                /** Format: uuid */
                                organizationId: string;
                                /** Format: date-time */
                                occurredAt: string;
                                /** Format: date-time */
                                readAt: string | null;
                                actor: unknown;
                                /** @enum {string} */
                                category: "monitor";
                                subject: {
                                    /** Format: uuid */
                                    monitorId: string;
                                    monitorName: string;
                                };
                                /** @enum {string} */
                                eventType: "MONITOR_DOWN";
                                reason: string;
                                sslNotAfter: unknown;
                            } | {
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                scope: "organization";
                                /** Format: uuid */
                                organizationId: string;
                                /** Format: date-time */
                                occurredAt: string;
                                /** Format: date-time */
                                readAt: string | null;
                                actor: unknown;
                                /** @enum {string} */
                                category: "monitor";
                                subject: {
                                    /** Format: uuid */
                                    monitorId: string;
                                    monitorName: string;
                                };
                                /** @enum {string} */
                                eventType: "MONITOR_RECOVERED";
                                reason: unknown;
                                sslNotAfter: unknown;
                            } | {
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                scope: "organization";
                                /** Format: uuid */
                                organizationId: string;
                                /** Format: date-time */
                                occurredAt: string;
                                /** Format: date-time */
                                readAt: string | null;
                                actor: unknown;
                                /** @enum {string} */
                                category: "monitor";
                                subject: {
                                    /** Format: uuid */
                                    monitorId: string;
                                    monitorName: string;
                                };
                                /** @enum {string} */
                                eventType: "MONITOR_SSL_CAUTION" | "MONITOR_SSL_DANGER" | "MONITOR_SSL_EXPIRED";
                                reason: unknown;
                                /** Format: date-time */
                                sslNotAfter: string;
                            }))[];
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
                        } | ({
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            scope: "organization";
                            /** Format: uuid */
                            organizationId: string;
                            /** Format: date-time */
                            occurredAt: string;
                            /** Format: date-time */
                            readAt: string | null;
                            /** @enum {string} */
                            eventType: "ORG-NOTIFICATION-SETTINGS-CHANGED";
                            actor: {
                                displayName: string;
                            };
                            /** @enum {string} */
                            category: "notification-settings";
                        } | {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            scope: "organization";
                            /** Format: uuid */
                            organizationId: string;
                            /** Format: date-time */
                            occurredAt: string;
                            /** Format: date-time */
                            readAt: string | null;
                            actor: unknown;
                            /** @enum {string} */
                            category: "monitor";
                            subject: {
                                /** Format: uuid */
                                monitorId: string;
                                monitorName: string;
                            };
                            /** @enum {string} */
                            eventType: "MONITOR_DOWN";
                            reason: string;
                            sslNotAfter: unknown;
                        } | {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            scope: "organization";
                            /** Format: uuid */
                            organizationId: string;
                            /** Format: date-time */
                            occurredAt: string;
                            /** Format: date-time */
                            readAt: string | null;
                            actor: unknown;
                            /** @enum {string} */
                            category: "monitor";
                            subject: {
                                /** Format: uuid */
                                monitorId: string;
                                monitorName: string;
                            };
                            /** @enum {string} */
                            eventType: "MONITOR_RECOVERED";
                            reason: unknown;
                            sslNotAfter: unknown;
                        } | {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            scope: "organization";
                            /** Format: uuid */
                            organizationId: string;
                            /** Format: date-time */
                            occurredAt: string;
                            /** Format: date-time */
                            readAt: string | null;
                            actor: unknown;
                            /** @enum {string} */
                            category: "monitor";
                            subject: {
                                /** Format: uuid */
                                monitorId: string;
                                monitorName: string;
                            };
                            /** @enum {string} */
                            eventType: "MONITOR_SSL_CAUTION" | "MONITOR_SSL_DANGER" | "MONITOR_SSL_EXPIRED";
                            reason: unknown;
                            /** Format: date-time */
                            sslNotAfter: string;
                        });
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
                            monitorAlertsEnabled: boolean;
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
                        settingsChangedEnabled?: boolean;
                        monitorAlertsEnabled?: boolean;
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
                            monitorAlertsEnabled: boolean;
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
    "/api/organizations/{organizationId}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    offset?: number;
                };
                header?: never;
                path: {
                    organizationId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated organization members */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            organizationId: string;
                            members: {
                                id: string;
                                userId: string;
                                name: string;
                                /** Format: email */
                                email: string;
                                /** @enum {string} */
                                role: "owner" | "admin" | "viewer" | "auditor";
                            }[];
                            page: {
                                limit: number;
                                offset: number;
                                total: number;
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
    "/api/organizations/{organizationId}/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
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
                        email: string;
                        /** @enum {string} */
                        role: "owner" | "admin" | "viewer" | "auditor";
                    };
                };
            };
            responses: {
                /** @description Invitation persisted; SMTP transport result */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            created: true;
                            /** @enum {string} */
                            emailDispatch: "accepted" | "failed";
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
    "/api/organizations/{organizationId}/monitors/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test a monitor configuration before it is created */
        post: {
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
                        name: string;
                        url: string;
                        /** @default 300 */
                        intervalSeconds?: number;
                        /** @default 10 */
                        timeoutSeconds?: number;
                        /**
                         * @default GET
                         * @enum {string}
                         */
                        method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
                        /** @default [] */
                        headers?: {
                            id?: string;
                            name: string;
                            value?: string;
                            /** @default false */
                            secret?: boolean;
                        }[];
                        /** @default [] */
                        queryParams?: {
                            name: string;
                            value: string;
                        }[];
                        /** @default null */
                        body?: {
                            /** @enum {string} */
                            type: "json" | "text";
                            content: string;
                        } | null;
                        /** @default 200-299 */
                        expectedStatus?: string;
                        /** @default [] */
                        assertions?: ({
                            /** @enum {string} */
                            kind: "jsonPathEquals";
                            path: string;
                            expected: string;
                        } | {
                            /** @enum {string} */
                            kind: "bodyContains";
                            text: string;
                        } | {
                            /** @enum {string} */
                            kind: "responseTimeBelow";
                            ms: number;
                        })[];
                        /**
                         * @default {
                         *       "type": "none"
                         *     }
                         */
                        auth?: {
                            /** @enum {string} */
                            type: "none";
                        } | {
                            /** @enum {string} */
                            type: "bearer";
                        } | {
                            /** @enum {string} */
                            type: "basic";
                        } | {
                            /** @enum {string} */
                            type: "apiKey";
                            headerName: string;
                        };
                        /** @default [] */
                        secrets?: {
                            slot: string;
                            value: string;
                        }[];
                    };
                };
            };
            responses: {
                /** @description The result of one check of the target, not recorded. Target problems (DNS, TLS, timeout, blocked address, redirects) are results, not errors */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            result: {
                                /** Format: date-time */
                                checkedAt: string;
                                /** @enum {string} */
                                outcome: "pass" | "fail" | "check_error";
                                httpStatus: number | null;
                                responseTimeMs: number | null;
                                /** @enum {string|null} */
                                failureReason: "http_status" | "assertion_failed" | "timeout" | "dns_not_found" | "connect_refused" | "connect_failed" | "tls_invalid" | "blocked_address" | "redirect_blocked" | "redirect_limit" | "body_read_failed" | "secret_decrypt_failed" | "internal_egress_failed" | "resolver_unavailable" | "executor_error" | null;
                                /** @enum {string|null} */
                                tlsReason: "expired" | "hostname_mismatch" | "untrusted" | "self_signed" | "handshake_failed" | null;
                                assertions: {
                                    /** @enum {string} */
                                    kind: "jsonPathEquals" | "bodyContains" | "responseTimeBelow";
                                    expected: string;
                                    actual: string | null;
                                    actualType: string | null;
                                    actualTruncated: boolean;
                                    /** @enum {string} */
                                    status: "pass" | "fail" | "not_evaluated";
                                    /** @enum {string|null} */
                                    reason: "not_json" | "path_not_found" | "multiple_matches" | "type_mismatch" | "no_body" | "undecodable" | "value_mismatch" | "text_not_found" | "too_slow" | "no_response" | null;
                                }[];
                                url: string;
                                evaluatedFromPrefix: boolean;
                                ssl: {
                                    /** @enum {string} */
                                    level: "ok" | "caution" | "danger" | "expired" | "not_https" | "unreadable" | "no_data";
                                    daysRemaining: number | null;
                                    host: string | null;
                                    issuer: string | null;
                                    /** Format: date-time */
                                    notAfter: string | null;
                                };
                            };
                        };
                    };
                };
                /** @description Invalid monitor input */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_INVALID";
                                message: string;
                                details: {
                                    fields: {
                                        field: string;
                                        /** @enum {string} */
                                        reason: "required" | "too_long" | "invalid_format" | "blocked_scheme" | "embedded_credentials" | "blocked_port" | "blocked_header" | "duplicate" | "crlf" | "auth_header_conflict" | "invalid_json" | "invalid_jsonpath" | "body_assertion_with_head" | "out_of_range" | "too_many";
                                    }[];
                                };
                            };
                        } | {
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
                /** @description The request body is not JSON */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "UNSUPPORTED_MEDIA_TYPE";
                                message: string;
                            };
                        };
                    };
                };
                /** @description Test rate limit reached; Retry-After carries the wait in seconds */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_TEST_RATE_LIMITED";
                                message: string;
                                details: {
                                    retryAfterSeconds: number;
                                };
                            };
                        };
                    };
                };
                /** @description The rate limiter is unavailable, or credential encryption is not configured for a kept secret; no request was sent */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "RATE_LIMIT_UNAVAILABLE";
                                message: string;
                            };
                        } | {
                            error: {
                                /** @enum {string} */
                                code: "CREDENTIALS_UNAVAILABLE";
                                message: string;
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
    "/api/organizations/{organizationId}/monitors/{monitorId}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test a configuration in the edit form of an existing monitor */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    organizationId: string;
                    monitorId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        url: string;
                        /** @default 300 */
                        intervalSeconds?: number;
                        /** @default 10 */
                        timeoutSeconds?: number;
                        /**
                         * @default GET
                         * @enum {string}
                         */
                        method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
                        /** @default [] */
                        headers?: {
                            id?: string;
                            name: string;
                            value?: string;
                            /** @default false */
                            secret?: boolean;
                        }[];
                        /** @default [] */
                        queryParams?: {
                            name: string;
                            value: string;
                        }[];
                        /** @default null */
                        body?: {
                            /** @enum {string} */
                            type: "json" | "text";
                            content: string;
                        } | null;
                        /** @default 200-299 */
                        expectedStatus?: string;
                        /** @default [] */
                        assertions?: ({
                            /** @enum {string} */
                            kind: "jsonPathEquals";
                            path: string;
                            expected: string;
                        } | {
                            /** @enum {string} */
                            kind: "bodyContains";
                            text: string;
                        } | {
                            /** @enum {string} */
                            kind: "responseTimeBelow";
                            ms: number;
                        })[];
                        /**
                         * @default {
                         *       "type": "none"
                         *     }
                         */
                        auth?: {
                            /** @enum {string} */
                            type: "none";
                        } | {
                            /** @enum {string} */
                            type: "bearer";
                        } | {
                            /** @enum {string} */
                            type: "basic";
                        } | {
                            /** @enum {string} */
                            type: "apiKey";
                            headerName: string;
                        };
                        /** @default [] */
                        secrets?: {
                            slot: string;
                            /** @enum {string} */
                            action: "keep" | "replace" | "delete";
                            value?: string;
                        }[];
                    };
                };
            };
            responses: {
                /** @description The result of one check of the target, not recorded. Target problems (DNS, TLS, timeout, blocked address, redirects) are results, not errors */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            result: {
                                /** Format: date-time */
                                checkedAt: string;
                                /** @enum {string} */
                                outcome: "pass" | "fail" | "check_error";
                                httpStatus: number | null;
                                responseTimeMs: number | null;
                                /** @enum {string|null} */
                                failureReason: "http_status" | "assertion_failed" | "timeout" | "dns_not_found" | "connect_refused" | "connect_failed" | "tls_invalid" | "blocked_address" | "redirect_blocked" | "redirect_limit" | "body_read_failed" | "secret_decrypt_failed" | "internal_egress_failed" | "resolver_unavailable" | "executor_error" | null;
                                /** @enum {string|null} */
                                tlsReason: "expired" | "hostname_mismatch" | "untrusted" | "self_signed" | "handshake_failed" | null;
                                assertions: {
                                    /** @enum {string} */
                                    kind: "jsonPathEquals" | "bodyContains" | "responseTimeBelow";
                                    expected: string;
                                    actual: string | null;
                                    actualType: string | null;
                                    actualTruncated: boolean;
                                    /** @enum {string} */
                                    status: "pass" | "fail" | "not_evaluated";
                                    /** @enum {string|null} */
                                    reason: "not_json" | "path_not_found" | "multiple_matches" | "type_mismatch" | "no_body" | "undecodable" | "value_mismatch" | "text_not_found" | "too_slow" | "no_response" | null;
                                }[];
                                url: string;
                                evaluatedFromPrefix: boolean;
                                ssl: {
                                    /** @enum {string} */
                                    level: "ok" | "caution" | "danger" | "expired" | "not_https" | "unreadable" | "no_data";
                                    daysRemaining: number | null;
                                    host: string | null;
                                    issuer: string | null;
                                    /** Format: date-time */
                                    notAfter: string | null;
                                };
                            };
                        };
                    };
                };
                /** @description Invalid monitor input */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_INVALID";
                                message: string;
                                details: {
                                    fields: {
                                        field: string;
                                        /** @enum {string} */
                                        reason: "required" | "too_long" | "invalid_format" | "blocked_scheme" | "embedded_credentials" | "blocked_port" | "blocked_header" | "duplicate" | "crlf" | "auth_header_conflict" | "invalid_json" | "invalid_jsonpath" | "body_assertion_with_head" | "out_of_range" | "too_many";
                                    }[];
                                };
                            };
                        } | {
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
                /** @description The monitor does not exist, is malformed or belongs to another Organization */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_NOT_FOUND";
                                message: string;
                            };
                        };
                    };
                };
                /** @description The request body is not JSON */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "UNSUPPORTED_MEDIA_TYPE";
                                message: string;
                            };
                        };
                    };
                };
                /** @description The scheme, host or port changed while a stored secret is kept; nothing was sent */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_SECRET_ORIGIN_CHANGED";
                                message: string;
                            };
                        };
                    };
                };
                /** @description Test rate limit reached; Retry-After carries the wait in seconds */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_TEST_RATE_LIMITED";
                                message: string;
                                details: {
                                    retryAfterSeconds: number;
                                };
                            };
                        };
                    };
                };
                /** @description The rate limiter is unavailable, or credential encryption is not configured for a kept secret; no request was sent */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "RATE_LIMIT_UNAVAILABLE";
                                message: string;
                            };
                        } | {
                            error: {
                                /** @enum {string} */
                                code: "CREDENTIALS_UNAVAILABLE";
                                message: string;
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
    "/api/organizations/{organizationId}/monitors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List monitors with health, SSL level and uptime */
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    offset?: number | null;
                    health?: "up" | "down" | "unknown" | "paused";
                    q?: string;
                };
                header?: never;
                path: {
                    organizationId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description One page of monitors and the Organization summary */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            summary: {
                                up: number;
                                down: number;
                                unknown: number;
                                paused: number;
                                total: number;
                                /** @enum {number} */
                                limit: 50;
                            };
                            monitors: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                url: string;
                                /** @enum {string} */
                                status: "active" | "paused";
                                /** @enum {string} */
                                health: "up" | "down" | "unknown" | "paused";
                                /** @enum {string|null} */
                                healthReason: "never_checked" | "stale" | "awaiting_new_config" | "check_error" | null;
                                lastKnownDown: boolean;
                                consecutiveFailures: number;
                                /** Format: date-time */
                                lastCheckAt: string | null;
                                openIncident: {
                                    /** Format: date-time */
                                    startedAt: string;
                                    reason: string;
                                } | null;
                                lastResponseTimeMs: number | null;
                                ssl: {
                                    /** @enum {string} */
                                    level: "ok" | "caution" | "danger" | "expired" | "not_https" | "unreadable" | "no_data";
                                    daysRemaining: number | null;
                                    host: string | null;
                                };
                                uptime: {
                                    h24: {
                                        percent: number | null;
                                        checks: number;
                                        coveragePercent: number;
                                    };
                                    d30: {
                                        percent: number | null;
                                        checks: number;
                                        coveragePercent: number;
                                    };
                                };
                            }[];
                            page: {
                                limit: number;
                                offset: number;
                                total: number;
                            };
                            /** Format: date-time */
                            dataAsOf: string;
                        };
                    };
                };
                /** @description Invalid query */
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
                /** @description Email is unverified or membership is denied */
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
        /** Create a monitor */
        post: {
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
                        name: string;
                        url: string;
                        /** @default 300 */
                        intervalSeconds?: number;
                        /** @default 10 */
                        timeoutSeconds?: number;
                        /**
                         * @default GET
                         * @enum {string}
                         */
                        method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
                        /** @default [] */
                        headers?: {
                            id?: string;
                            name: string;
                            value?: string;
                            /** @default false */
                            secret?: boolean;
                        }[];
                        /** @default [] */
                        queryParams?: {
                            name: string;
                            value: string;
                        }[];
                        /** @default null */
                        body?: {
                            /** @enum {string} */
                            type: "json" | "text";
                            content: string;
                        } | null;
                        /** @default 200-299 */
                        expectedStatus?: string;
                        /** @default [] */
                        assertions?: ({
                            /** @enum {string} */
                            kind: "jsonPathEquals";
                            path: string;
                            expected: string;
                        } | {
                            /** @enum {string} */
                            kind: "bodyContains";
                            text: string;
                        } | {
                            /** @enum {string} */
                            kind: "responseTimeBelow";
                            ms: number;
                        })[];
                        /**
                         * @default {
                         *       "type": "none"
                         *     }
                         */
                        auth?: {
                            /** @enum {string} */
                            type: "none";
                        } | {
                            /** @enum {string} */
                            type: "bearer";
                        } | {
                            /** @enum {string} */
                            type: "basic";
                        } | {
                            /** @enum {string} */
                            type: "apiKey";
                            headerName: string;
                        };
                        /** Format: uuid */
                        clientRequestId: string;
                        /** @default [] */
                        secrets?: {
                            slot: string;
                            value: string;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Created, or the original monitor of a replayed request */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            monitor: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                url: string;
                                /** @enum {string} */
                                method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
                                intervalSeconds: number;
                                timeoutSeconds: number;
                                headers: {
                                    id?: string;
                                    name: string;
                                    value?: string;
                                    secret: boolean;
                                }[];
                                queryParams: {
                                    name: string;
                                    value: string;
                                }[];
                                body: {
                                    /** @enum {string} */
                                    type: "json" | "text";
                                    content: string;
                                } | null;
                                expectedStatus: string;
                                assertions: ({
                                    /** @enum {string} */
                                    kind: "jsonPathEquals";
                                    path: string;
                                    expected: string;
                                } | {
                                    /** @enum {string} */
                                    kind: "bodyContains";
                                    text: string;
                                } | {
                                    /** @enum {string} */
                                    kind: "responseTimeBelow";
                                    ms: number;
                                })[];
                                auth: {
                                    /** @enum {string} */
                                    type: "none";
                                } | {
                                    /** @enum {string} */
                                    type: "bearer";
                                } | {
                                    /** @enum {string} */
                                    type: "basic";
                                } | {
                                    /** @enum {string} */
                                    type: "apiKey";
                                    headerName: string;
                                };
                                secretSlots: {
                                    slot: string;
                                    /** @enum {boolean} */
                                    configured: true;
                                }[];
                                /** @enum {string} */
                                status: "active" | "paused";
                                version: number;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                updatedAt: string;
                            };
                        };
                    };
                };
                /** @description Invalid monitor input */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_INVALID";
                                message: string;
                                details: {
                                    fields: {
                                        field: string;
                                        /** @enum {string} */
                                        reason: "required" | "too_long" | "invalid_format" | "blocked_scheme" | "embedded_credentials" | "blocked_port" | "blocked_header" | "duplicate" | "crlf" | "auth_header_conflict" | "invalid_json" | "invalid_jsonpath" | "body_assertion_with_head" | "out_of_range" | "too_many";
                                    }[];
                                };
                            };
                        } | {
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
                /** @description The Organization is at its monitor limit */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_LIMIT_REACHED";
                                message: string;
                            };
                        };
                    };
                };
                /** @description The request body is not JSON */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "UNSUPPORTED_MEDIA_TYPE";
                                message: string;
                            };
                        };
                    };
                };
                /** @description The host is or resolves to a forbidden address */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_TARGET_BLOCKED";
                                message: string;
                                details: {
                                    /** @enum {string} */
                                    field: "url";
                                };
                            };
                        };
                    };
                };
                /** @description Credential encryption is not configured, so secret values cannot be stored or read */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "CREDENTIALS_UNAVAILABLE";
                                message: string;
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
    "/api/organizations/{organizationId}/monitors/{monitorId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Monitor configuration with health, SSL level and uptime */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    organizationId: string;
                    monitorId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The monitor with its computed state */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            monitor: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                url: string;
                                /** @enum {string} */
                                method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
                                intervalSeconds: number;
                                timeoutSeconds: number;
                                headers: {
                                    id?: string;
                                    name: string;
                                    value?: string;
                                    secret: boolean;
                                }[];
                                queryParams: {
                                    name: string;
                                    value: string;
                                }[];
                                body: {
                                    /** @enum {string} */
                                    type: "json" | "text";
                                    content: string;
                                } | null;
                                expectedStatus: string;
                                assertions: ({
                                    /** @enum {string} */
                                    kind: "jsonPathEquals";
                                    path: string;
                                    expected: string;
                                } | {
                                    /** @enum {string} */
                                    kind: "bodyContains";
                                    text: string;
                                } | {
                                    /** @enum {string} */
                                    kind: "responseTimeBelow";
                                    ms: number;
                                })[];
                                auth: {
                                    /** @enum {string} */
                                    type: "none";
                                } | {
                                    /** @enum {string} */
                                    type: "bearer";
                                } | {
                                    /** @enum {string} */
                                    type: "basic";
                                } | {
                                    /** @enum {string} */
                                    type: "apiKey";
                                    headerName: string;
                                };
                                secretSlots: {
                                    slot: string;
                                    /** @enum {boolean} */
                                    configured: true;
                                }[];
                                /** @enum {string} */
                                status: "active" | "paused";
                                version: number;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                updatedAt: string;
                                /** @enum {string} */
                                health: "up" | "down" | "unknown" | "paused";
                                /** @enum {string|null} */
                                healthReason: "never_checked" | "stale" | "awaiting_new_config" | "check_error" | null;
                                lastKnownDown: boolean;
                                consecutiveFailures: number;
                                /** Format: date-time */
                                lastCheckAt: string | null;
                                openIncident: {
                                    /** Format: date-time */
                                    startedAt: string;
                                    reason: string;
                                } | null;
                                lastResult: {
                                    /** Format: date-time */
                                    scheduledFor: string;
                                    /** Format: date-time */
                                    checkedAt: string;
                                    /** @enum {string} */
                                    outcome: "pass" | "fail" | "check_error";
                                    httpStatus: number | null;
                                    responseTimeMs: number | null;
                                    /** @enum {string|null} */
                                    failureReason: "http_status" | "assertion_failed" | "timeout" | "dns_not_found" | "connect_refused" | "connect_failed" | "tls_invalid" | "blocked_address" | "redirect_blocked" | "redirect_limit" | "body_read_failed" | "secret_decrypt_failed" | "internal_egress_failed" | "resolver_unavailable" | "executor_error" | null;
                                    /** @enum {string|null} */
                                    tlsReason: "expired" | "hostname_mismatch" | "untrusted" | "self_signed" | "handshake_failed" | null;
                                    assertions: {
                                        /** @enum {string} */
                                        kind: "jsonPathEquals" | "bodyContains" | "responseTimeBelow";
                                        expected: string;
                                        actual: string | null;
                                        actualType: string | null;
                                        actualTruncated: boolean;
                                        /** @enum {string} */
                                        status: "pass" | "fail" | "not_evaluated";
                                        /** @enum {string|null} */
                                        reason: "not_json" | "path_not_found" | "multiple_matches" | "type_mismatch" | "no_body" | "undecodable" | "value_mismatch" | "text_not_found" | "too_slow" | "no_response" | null;
                                    }[];
                                    url: string;
                                    configVersion: number;
                                    evaluatedFromPrefix: boolean;
                                } | null;
                                ssl: {
                                    /** @enum {string} */
                                    state: "ok" | "caution" | "danger" | "expired" | "not_https" | "unreadable" | "no_data";
                                    host: string | null;
                                    issuer: string | null;
                                    /** Format: date-time */
                                    notAfter: string | null;
                                    daysRemaining: number | null;
                                    reason: string | null;
                                };
                                uptime: {
                                    h24: {
                                        percent: number | null;
                                        checks: number;
                                        coveragePercent: number;
                                    };
                                    d7: {
                                        percent: number | null;
                                        checks: number;
                                        coveragePercent: number;
                                    };
                                    d30: {
                                        percent: number | null;
                                        checks: number;
                                        coveragePercent: number;
                                    };
                                };
                                /** Format: date-time */
                                dataAsOf: string;
                            };
                        };
                    };
                };
                /** @description Invalid query */
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
                /** @description Email is unverified or membership is denied */
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
                /** @description The monitor does not exist, is malformed or belongs to another Organization */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_NOT_FOUND";
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        /** Delete a monitor and its history */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    organizationId: string;
                    monitorId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Invalid monitor input */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_INVALID";
                                message: string;
                                details: {
                                    fields: {
                                        field: string;
                                        /** @enum {string} */
                                        reason: "required" | "too_long" | "invalid_format" | "blocked_scheme" | "embedded_credentials" | "blocked_port" | "blocked_header" | "duplicate" | "crlf" | "auth_header_conflict" | "invalid_json" | "invalid_jsonpath" | "body_assertion_with_head" | "out_of_range" | "too_many";
                                    }[];
                                };
                            };
                        } | {
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
                /** @description The monitor does not exist, is malformed or belongs to another Organization */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_NOT_FOUND";
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        /** Replace the configuration of a monitor */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    organizationId: string;
                    monitorId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        url: string;
                        /** @default 300 */
                        intervalSeconds?: number;
                        /** @default 10 */
                        timeoutSeconds?: number;
                        /**
                         * @default GET
                         * @enum {string}
                         */
                        method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
                        /** @default [] */
                        headers?: {
                            id?: string;
                            name: string;
                            value?: string;
                            /** @default false */
                            secret?: boolean;
                        }[];
                        /** @default [] */
                        queryParams?: {
                            name: string;
                            value: string;
                        }[];
                        /** @default null */
                        body?: {
                            /** @enum {string} */
                            type: "json" | "text";
                            content: string;
                        } | null;
                        /** @default 200-299 */
                        expectedStatus?: string;
                        /** @default [] */
                        assertions?: ({
                            /** @enum {string} */
                            kind: "jsonPathEquals";
                            path: string;
                            expected: string;
                        } | {
                            /** @enum {string} */
                            kind: "bodyContains";
                            text: string;
                        } | {
                            /** @enum {string} */
                            kind: "responseTimeBelow";
                            ms: number;
                        })[];
                        /**
                         * @default {
                         *       "type": "none"
                         *     }
                         */
                        auth?: {
                            /** @enum {string} */
                            type: "none";
                        } | {
                            /** @enum {string} */
                            type: "bearer";
                        } | {
                            /** @enum {string} */
                            type: "basic";
                        } | {
                            /** @enum {string} */
                            type: "apiKey";
                            headerName: string;
                        };
                        expectedVersion: number;
                        /** @default [] */
                        secrets?: {
                            slot: string;
                            /** @enum {string} */
                            action: "keep" | "replace" | "delete";
                            value?: string;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Updated monitor */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            monitor: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                url: string;
                                /** @enum {string} */
                                method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
                                intervalSeconds: number;
                                timeoutSeconds: number;
                                headers: {
                                    id?: string;
                                    name: string;
                                    value?: string;
                                    secret: boolean;
                                }[];
                                queryParams: {
                                    name: string;
                                    value: string;
                                }[];
                                body: {
                                    /** @enum {string} */
                                    type: "json" | "text";
                                    content: string;
                                } | null;
                                expectedStatus: string;
                                assertions: ({
                                    /** @enum {string} */
                                    kind: "jsonPathEquals";
                                    path: string;
                                    expected: string;
                                } | {
                                    /** @enum {string} */
                                    kind: "bodyContains";
                                    text: string;
                                } | {
                                    /** @enum {string} */
                                    kind: "responseTimeBelow";
                                    ms: number;
                                })[];
                                auth: {
                                    /** @enum {string} */
                                    type: "none";
                                } | {
                                    /** @enum {string} */
                                    type: "bearer";
                                } | {
                                    /** @enum {string} */
                                    type: "basic";
                                } | {
                                    /** @enum {string} */
                                    type: "apiKey";
                                    headerName: string;
                                };
                                secretSlots: {
                                    slot: string;
                                    /** @enum {boolean} */
                                    configured: true;
                                }[];
                                /** @enum {string} */
                                status: "active" | "paused";
                                version: number;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                updatedAt: string;
                            };
                        };
                    };
                };
                /** @description Invalid monitor input */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_INVALID";
                                message: string;
                                details: {
                                    fields: {
                                        field: string;
                                        /** @enum {string} */
                                        reason: "required" | "too_long" | "invalid_format" | "blocked_scheme" | "embedded_credentials" | "blocked_port" | "blocked_header" | "duplicate" | "crlf" | "auth_header_conflict" | "invalid_json" | "invalid_jsonpath" | "body_assertion_with_head" | "out_of_range" | "too_many";
                                    }[];
                                };
                            };
                        } | {
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
                /** @description The monitor does not exist, is malformed or belongs to another Organization */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_NOT_FOUND";
                                message: string;
                            };
                        };
                    };
                };
                /** @description The expected version is stale */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_VERSION_CONFLICT";
                                message: string;
                                details: {
                                    currentVersion: number;
                                };
                            };
                        };
                    };
                };
                /** @description The request body is not JSON */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "UNSUPPORTED_MEDIA_TYPE";
                                message: string;
                            };
                        };
                    };
                };
                /** @description The host is or resolves to a forbidden address, or the scheme, host or port changed while a secret is kept */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_TARGET_BLOCKED";
                                message: string;
                                details: {
                                    /** @enum {string} */
                                    field: "url";
                                };
                            };
                        } | {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_SECRET_ORIGIN_CHANGED";
                                message: string;
                            };
                        };
                    };
                };
                /** @description Credential encryption is not configured, so secret values cannot be stored or read */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "CREDENTIALS_UNAVAILABLE";
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/organizations/{organizationId}/monitors/{monitorId}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pause a monitor (idempotent) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    organizationId: string;
                    monitorId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The monitor, paused */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            monitor: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                url: string;
                                /** @enum {string} */
                                method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
                                intervalSeconds: number;
                                timeoutSeconds: number;
                                headers: {
                                    id?: string;
                                    name: string;
                                    value?: string;
                                    secret: boolean;
                                }[];
                                queryParams: {
                                    name: string;
                                    value: string;
                                }[];
                                body: {
                                    /** @enum {string} */
                                    type: "json" | "text";
                                    content: string;
                                } | null;
                                expectedStatus: string;
                                assertions: ({
                                    /** @enum {string} */
                                    kind: "jsonPathEquals";
                                    path: string;
                                    expected: string;
                                } | {
                                    /** @enum {string} */
                                    kind: "bodyContains";
                                    text: string;
                                } | {
                                    /** @enum {string} */
                                    kind: "responseTimeBelow";
                                    ms: number;
                                })[];
                                auth: {
                                    /** @enum {string} */
                                    type: "none";
                                } | {
                                    /** @enum {string} */
                                    type: "bearer";
                                } | {
                                    /** @enum {string} */
                                    type: "basic";
                                } | {
                                    /** @enum {string} */
                                    type: "apiKey";
                                    headerName: string;
                                };
                                secretSlots: {
                                    slot: string;
                                    /** @enum {boolean} */
                                    configured: true;
                                }[];
                                /** @enum {string} */
                                status: "active" | "paused";
                                version: number;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                updatedAt: string;
                            };
                        };
                    };
                };
                /** @description Invalid monitor input */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_INVALID";
                                message: string;
                                details: {
                                    fields: {
                                        field: string;
                                        /** @enum {string} */
                                        reason: "required" | "too_long" | "invalid_format" | "blocked_scheme" | "embedded_credentials" | "blocked_port" | "blocked_header" | "duplicate" | "crlf" | "auth_header_conflict" | "invalid_json" | "invalid_jsonpath" | "body_assertion_with_head" | "out_of_range" | "too_many";
                                    }[];
                                };
                            };
                        } | {
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
                /** @description The monitor does not exist, is malformed or belongs to another Organization */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_NOT_FOUND";
                                message: string;
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
    "/api/organizations/{organizationId}/monitors/{monitorId}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume a monitor (idempotent) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    organizationId: string;
                    monitorId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The monitor, active */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            monitor: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                url: string;
                                /** @enum {string} */
                                method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
                                intervalSeconds: number;
                                timeoutSeconds: number;
                                headers: {
                                    id?: string;
                                    name: string;
                                    value?: string;
                                    secret: boolean;
                                }[];
                                queryParams: {
                                    name: string;
                                    value: string;
                                }[];
                                body: {
                                    /** @enum {string} */
                                    type: "json" | "text";
                                    content: string;
                                } | null;
                                expectedStatus: string;
                                assertions: ({
                                    /** @enum {string} */
                                    kind: "jsonPathEquals";
                                    path: string;
                                    expected: string;
                                } | {
                                    /** @enum {string} */
                                    kind: "bodyContains";
                                    text: string;
                                } | {
                                    /** @enum {string} */
                                    kind: "responseTimeBelow";
                                    ms: number;
                                })[];
                                auth: {
                                    /** @enum {string} */
                                    type: "none";
                                } | {
                                    /** @enum {string} */
                                    type: "bearer";
                                } | {
                                    /** @enum {string} */
                                    type: "basic";
                                } | {
                                    /** @enum {string} */
                                    type: "apiKey";
                                    headerName: string;
                                };
                                secretSlots: {
                                    slot: string;
                                    /** @enum {boolean} */
                                    configured: true;
                                }[];
                                /** @enum {string} */
                                status: "active" | "paused";
                                version: number;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                updatedAt: string;
                            };
                        };
                    };
                };
                /** @description Invalid monitor input */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_INVALID";
                                message: string;
                                details: {
                                    fields: {
                                        field: string;
                                        /** @enum {string} */
                                        reason: "required" | "too_long" | "invalid_format" | "blocked_scheme" | "embedded_credentials" | "blocked_port" | "blocked_header" | "duplicate" | "crlf" | "auth_header_conflict" | "invalid_json" | "invalid_jsonpath" | "body_assertion_with_head" | "out_of_range" | "too_many";
                                    }[];
                                };
                            };
                        } | {
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
                /** @description The monitor does not exist, is malformed or belongs to another Organization */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_NOT_FOUND";
                                message: string;
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
    "/api/organizations/{organizationId}/monitors/recent-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Recent incidents and SSL levels across the Organization */
        get: {
            parameters: {
                query?: {
                    limit?: number;
                };
                header?: never;
                path: {
                    organizationId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Events of the last 30 days, newest first */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            events: {
                                /** @enum {string} */
                                kind: "incident_opened" | "incident_closed" | "ssl_level";
                                /** Format: uuid */
                                monitorId: string;
                                monitorName: string;
                                /** Format: date-time */
                                at: string;
                                reason: string | null;
                                durationSeconds?: number;
                                /** @enum {string} */
                                sslLevel?: "ok" | "caution" | "danger" | "expired" | "not_https" | "unreadable" | "no_data";
                                daysRemaining?: number;
                            }[];
                        };
                    };
                };
                /** @description Invalid query */
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
                /** @description Email is unverified or membership is denied */
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
        patch?: never;
        trace?: never;
    };
    "/api/organizations/{organizationId}/monitors/{monitorId}/checks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Check history, newest first */
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    offset?: number | null;
                };
                header?: never;
                path: {
                    organizationId: string;
                    monitorId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description One page of results and the URL changes inside it */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            checks: {
                                /** Format: date-time */
                                scheduledFor: string;
                                /** Format: date-time */
                                checkedAt: string;
                                /** @enum {string} */
                                outcome: "pass" | "fail" | "check_error";
                                httpStatus: number | null;
                                responseTimeMs: number | null;
                                /** @enum {string|null} */
                                failureReason: "http_status" | "assertion_failed" | "timeout" | "dns_not_found" | "connect_refused" | "connect_failed" | "tls_invalid" | "blocked_address" | "redirect_blocked" | "redirect_limit" | "body_read_failed" | "secret_decrypt_failed" | "internal_egress_failed" | "resolver_unavailable" | "executor_error" | null;
                                /** @enum {string|null} */
                                tlsReason: "expired" | "hostname_mismatch" | "untrusted" | "self_signed" | "handshake_failed" | null;
                                assertions: {
                                    /** @enum {string} */
                                    kind: "jsonPathEquals" | "bodyContains" | "responseTimeBelow";
                                    expected: string;
                                    actual: string | null;
                                    actualType: string | null;
                                    actualTruncated: boolean;
                                    /** @enum {string} */
                                    status: "pass" | "fail" | "not_evaluated";
                                    /** @enum {string|null} */
                                    reason: "not_json" | "path_not_found" | "multiple_matches" | "type_mismatch" | "no_body" | "undecodable" | "value_mismatch" | "text_not_found" | "too_slow" | "no_response" | null;
                                }[];
                                url: string;
                                configVersion: number;
                                evaluatedFromPrefix: boolean;
                            }[];
                            page: {
                                limit: number;
                                offset: number;
                                total: number;
                            };
                            urlChanges: {
                                /** Format: date-time */
                                at: string;
                                url: string;
                            }[];
                        };
                    };
                };
                /** @description Invalid query */
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
                /** @description Email is unverified or membership is denied */
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
                /** @description The monitor does not exist, is malformed or belongs to another Organization */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_NOT_FOUND";
                                message: string;
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
    "/api/organizations/{organizationId}/monitors/{monitorId}/incidents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Incident history, newest first */
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    offset?: number | null;
                };
                header?: never;
                path: {
                    organizationId: string;
                    monitorId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description One page of incidents */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            incidents: {
                                /** Format: uuid */
                                id: string;
                                /** Format: date-time */
                                startedAt: string;
                                /** Format: date-time */
                                endedAt: string | null;
                                durationSeconds: number;
                                startReason: string;
                                startHttpStatus: number | null;
                                /** @enum {string|null} */
                                endReason: "recovered" | "paused_by_user" | null;
                            }[];
                            page: {
                                limit: number;
                                offset: number;
                                total: number;
                            };
                        };
                    };
                };
                /** @description Invalid query */
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
                /** @description Email is unverified or membership is denied */
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
                /** @description The monitor does not exist, is malformed or belongs to another Organization */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_NOT_FOUND";
                                message: string;
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
    "/api/organizations/{organizationId}/monitors/{monitorId}/response-times": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Response times: per-check points for 24 h, hourly buckets for 7 d and 30 d */
        get: {
            parameters: {
                query?: {
                    range?: "24h" | "7d" | "30d";
                };
                header?: never;
                path: {
                    organizationId: string;
                    monitorId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The series with its pauses and configuration changes */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            range: "24h";
                            points: {
                                /** Format: date-time */
                                at: string;
                                responseTimeMs: number | null;
                                /** @enum {string} */
                                outcome: "pass" | "fail" | "check_error";
                            }[];
                            gaps: {
                                /** Format: date-time */
                                from: string;
                                /** Format: date-time */
                                to: string;
                            }[];
                            /** @enum {string} */
                            unit: "ms";
                            pauses: {
                                /** Format: date-time */
                                from: string;
                                /** Format: date-time */
                                to: string;
                            }[];
                            configChanges: {
                                /** Format: date-time */
                                at: string;
                                urlChanged: boolean;
                                url?: string;
                            }[];
                        } | {
                            /** @enum {string} */
                            range: "7d" | "30d";
                            buckets: {
                                /** Format: date-time */
                                hourStart: string;
                                avgMs: number | null;
                                maxMs: number | null;
                                checks: number;
                                responseChecks: number;
                            }[];
                            /** @enum {string} */
                            unit: "ms";
                            pauses: {
                                /** Format: date-time */
                                from: string;
                                /** Format: date-time */
                                to: string;
                            }[];
                            configChanges: {
                                /** Format: date-time */
                                at: string;
                                urlChanged: boolean;
                                url?: string;
                            }[];
                        };
                    };
                };
                /** @description Invalid query */
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
                /** @description Email is unverified or membership is denied */
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
                /** @description The monitor does not exist, is malformed or belongs to another Organization */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                /** @enum {string} */
                                code: "MONITOR_NOT_FOUND";
                                message: string;
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
        /** Readiness probe (database and Redis checks when configured) */
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
