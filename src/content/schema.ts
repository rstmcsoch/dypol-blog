import { z } from "zod";
import { publicationStatuses } from "./types";

/**
 * Provider-agnostic contract for a future editor or automation agent.
 * Validate this payload on the server, then store one canonical article.
 * This phase does not expose a public write route.
 */
const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string().min(1) }),
  z.object({
    type: z.literal("heading"),
    level: z.union([z.literal(2), z.literal(3)]),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("list"),
    ordered: z.boolean().optional(),
    items: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("quote"),
    text: z.string().min(1),
    attribution: z.string().optional(),
  }),
  z.object({
    type: z.literal("code"),
    language: z.string().optional(),
    code: z.string().min(1),
  }),
]);

export const articlePayloadSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  excerpt: z.string().min(1),
  status: z.enum(publicationStatuses),
  publishedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  categoryId: z.string().min(1),
  tagIds: z.array(z.string().min(1)),
  motif: z.enum(["corner", "band", "split", "stamp", "stack", "edge"]),
  featured: z.boolean(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  blocks: z.array(blockSchema).min(1),
});

export type ArticlePayload = z.infer<typeof articlePayloadSchema>;

export type FieldError = { path: string; message: string };

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldError[] };

export function validateArticlePayload(input: unknown): ValidationResult<ArticlePayload> {
  const parsed = articlePayloadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  return { ok: true, data: parsed.data };
}
