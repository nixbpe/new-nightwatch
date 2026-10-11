import { z } from "zod";

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

// ---- Route parameters and error envelopes ------------------------------------

export const projectOrganizationParamsSchema = z.object({
  organizationId: z.uuid(),
});
/** A malformed id answers 404 like a missing one, so it is parsed in the service. */
export const projectParamsSchema = projectOrganizationParamsSchema.extend({
  projectId: z.string().max(64),
});

export const PROJECT_ERROR_CODES = [
  "PROJECT_NOT_FOUND",
  "PROJECT_SLUG_TAKEN",
  "PROJECT_LIMIT_REACHED",
] as const;
export type ProjectErrorCode = (typeof PROJECT_ERROR_CODES)[number];

function projectErrorSchema<Code extends ProjectErrorCode>(code: Code) {
  return z.object({
    error: z.object({
      code: z.literal(code),
      message: z.string().min(1),
    }),
  });
}

export const projectNotFoundErrorResponseSchema =
  projectErrorSchema("PROJECT_NOT_FOUND");
export const projectLimitReachedErrorResponseSchema = projectErrorSchema(
  "PROJECT_LIMIT_REACHED",
);
export const projectSlugTakenErrorResponseSchema = z.object({
  error: z.object({
    code: z.literal("PROJECT_SLUG_TAKEN"),
    message: z.string().min(1),
    details: z.object({ field: z.literal("slug") }),
  }),
});
