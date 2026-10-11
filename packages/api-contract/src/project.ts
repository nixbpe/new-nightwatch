import { z } from "zod";

import { organizationRoleSchema } from "./auth";

// Browser-safe on purpose (PKG-01): depends on zod only. The web app validates
// forms with these schemas and apps/api parses requests with them. Lengths are
// counted after trim, in code points, as PostgreSQL's char_length does.

export const PROJECT_LIMIT_PER_ORGANIZATION = 50;

const projectName = z.string().trim().min(1).max(80);
const projectSlug = z.string().regex(/^[a-z0-9-]{3,40}$/);
// An empty description is stored as no description.
const projectDescription = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const createProjectRequestSchema = z.strictObject({
  name: projectName,
  slug: projectSlug,
  description: projectDescription.optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

// No slug, organizationId or tenantId: a Project keeps its slug and its
// Organization for life.
export const updateProjectRequestSchema = z
  .strictObject({ name: projectName, description: projectDescription })
  .partial()
  .refine((body) => Object.keys(body).length > 0);
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const projectRoleSchema = z.enum(["admin", "member"]);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

export const projectSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  /** `null` when the user is not a member; only an Owner or Admin can see such a Project. */
  myRole: projectRoleSchema.nullable(),
  updatedAt: z.iso.datetime(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectListResponseSchema = z.object({
  projects: z.array(projectSummarySchema),
});
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

/**
 * `GET /{projectId}`: the summary plus the administrator count the header
 * shows. The list keeps `projectSummarySchema`.
 */
export const projectDetailSchema = projectSummarySchema.extend({
  adminCount: z.number().int().nonnegative(),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

// ---- Members -----------------------------------------------------------------

export const PROJECT_MEMBER_ADD_MAX = 100;
export const PROJECT_MEMBER_CANDIDATE_LIMIT = 50;
export const PROJECT_MEMBER_SEARCH_MAX_LENGTH = 100;

export const projectMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  organizationRole: organizationRoleSchema,
  projectRole: projectRoleSchema,
  /** When the user joined the Project (`project_members.created_at`). */
  joinedAt: z.iso.datetime(),
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;

/** Administrators first, then by name, then by user id. */
export const projectMemberListResponseSchema = z.object({
  members: z.array(projectMemberSchema),
});
export type ProjectMemberListResponse = z.infer<
  typeof projectMemberListResponseSchema
>;

/**
 * The whole member list after the change, and the users this request inserted.
 * A user who was already in the Project keeps their role and is not listed in
 * `addedUserIds`.
 */
export const addProjectMembersResponseSchema =
  projectMemberListResponseSchema.extend({ addedUserIds: z.array(z.string()) });
export type AddProjectMembersResponse = z.infer<
  typeof addProjectMembersResponseSchema
>;

/** Any Organization member matching `q`; `projectRole` is `null` for one who is not in the Project. */
export const projectMemberCandidateSchema = projectMemberSchema
  .omit({ projectRole: true, joinedAt: true })
  .extend({ projectRole: projectRoleSchema.nullable() });
export type ProjectMemberCandidate = z.infer<
  typeof projectMemberCandidateSchema
>;

export const projectMemberCandidatesQuerySchema = z.object({
  /** Matches name or email, case-insensitive. Omitted or blank lists the first members by name. */
  q: z.string().trim().max(PROJECT_MEMBER_SEARCH_MAX_LENGTH).optional(),
});

/** At most `PROJECT_MEMBER_CANDIDATE_LIMIT`, sorted by name then user id. */
export const projectMemberCandidatesResponseSchema = z.object({
  candidates: z.array(projectMemberCandidateSchema),
});
export type ProjectMemberCandidatesResponse = z.infer<
  typeof projectMemberCandidatesResponseSchema
>;

/** `role` is required: the API never guesses between admin and member. */
export const addProjectMembersRequestSchema = z.strictObject({
  userIds: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(PROJECT_MEMBER_ADD_MAX),
  role: projectRoleSchema,
});
export type AddProjectMembersRequest = z.infer<
  typeof addProjectMembersRequestSchema
>;

export const updateProjectMemberRequestSchema = z.strictObject({
  role: projectRoleSchema,
});
export type UpdateProjectMemberRequest = z.infer<
  typeof updateProjectMemberRequestSchema
>;

// ---- Route parameters and error envelopes ------------------------------------

export const projectOrganizationParamsSchema = z.object({
  organizationId: z.uuid(),
});
/** A malformed id answers 404 like a missing one, so it is parsed in the service. */
export const projectParamsSchema = projectOrganizationParamsSchema.extend({
  projectId: z.string(),
});
export const projectMemberParamsSchema = projectParamsSchema.extend({
  userId: z.string(),
});

export const PROJECT_ERROR_CODES = [
  "PROJECT_NOT_FOUND",
  "PROJECT_SLUG_TAKEN",
  "PROJECT_LIMIT_REACHED",
  "LAST_PROJECT_ADMIN",
  "PROJECT_MEMBER_NOT_IN_ORGANIZATION",
  "PROJECT_MEMBER_NOT_FOUND",
] as const;
export type ProjectErrorCode = (typeof PROJECT_ERROR_CODES)[number];

function projectErrorSchema<Code extends string>(code: Code) {
  return z.object({
    error: z.object({
      code: z.literal(code),
      message: z.string().min(1),
    }),
  });
}

/** The app-wide 400 for a request that fails its schema. */
export const projectValidationErrorResponseSchema =
  projectErrorSchema("VALIDATION_ERROR");
export const projectNotFoundErrorResponseSchema =
  projectErrorSchema("PROJECT_NOT_FOUND");
export const projectLimitReachedErrorResponseSchema = projectErrorSchema(
  "PROJECT_LIMIT_REACHED",
);
export const lastProjectAdminErrorResponseSchema =
  projectErrorSchema("LAST_PROJECT_ADMIN");
export const projectMemberNotInOrganizationErrorResponseSchema =
  projectErrorSchema("PROJECT_MEMBER_NOT_IN_ORGANIZATION");
export const projectMemberNotFoundErrorResponseSchema = projectErrorSchema(
  "PROJECT_MEMBER_NOT_FOUND",
);
export const projectSlugTakenErrorResponseSchema = z.object({
  error: z.object({
    code: z.literal("PROJECT_SLUG_TAKEN"),
    message: z.string().min(1),
    details: z.object({ field: z.literal("slug") }),
  }),
});
