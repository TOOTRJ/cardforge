import { z } from "zod";
import { DECK_FORMAT_VALUES } from "@/types/deck";
import { VISIBILITY_VALUES } from "@/types/card";
import { isSafeImageUrl } from "@/lib/validation/card";

// Mirrors the DB check constraints on the decks table exactly.
// supabase/migrations/0055_decks.sql is the source of truth.

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const optionalEmptyString = (schema: z.ZodType<string>) =>
  schema.optional().or(z.literal("").transform(() => undefined));

export const deckTitleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(120, "Title must be 120 characters or fewer.");

export const deckSlugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required.")
  .max(80, "Slug must be 80 characters or fewer.")
  .regex(
    SLUG_PATTERN,
    "Slug must use lowercase letters, numbers, and hyphens (no leading/trailing hyphen).",
  );

export const deckDescriptionSchema = optionalEmptyString(
  z
    .string()
    .trim()
    .max(2000, "Description must be 2000 characters or fewer."),
);

export const deckCoverUrlSchema = optionalEmptyString(
  z
    .string()
    .trim()
    .max(2048, "Cover URL must be 2048 characters or fewer.")
    .url("Cover URL must be a valid URL.")
    .refine(isSafeImageUrl, "Cover URL must be an https:// URL."),
);

// Cover focal point — {focalX, focalY} in 0..1 (migration 0057). `null`
// clears back to centered.
export const deckCoverPositionSchema = z.object({
  focalX: z.number().min(0).max(1),
  focalY: z.number().min(0).max(1),
});

// ⚠️ zod materializes .default() values even through .partial() — see the
// matching note in lib/validation/card.ts. updateDeckSchema overrides the
// defaulted fields with their default-free bases so a partial update (e.g.
// the AI cover attach) can't silently reset format/visibility.
const deckFormatBaseSchema = z.enum(DECK_FORMAT_VALUES);
export const deckFormatSchema = deckFormatBaseSchema.default("commander");

// Decks default to public (like cards) — sharing the build is the point.
// The DB column default stays 'private' as the conservative fallback for
// writes that bypass this schema.
const deckVisibilityBaseSchema = z.enum(VISIBILITY_VALUES);
export const deckVisibilitySchema = deckVisibilityBaseSchema.default("public");

export const createDeckSchema = z.object({
  title: deckTitleSchema,
  slug: deckSlugSchema.optional(),
  description: deckDescriptionSchema,
  cover_url: deckCoverUrlSchema,
  cover_position: deckCoverPositionSchema.nullable().optional(),
  format: deckFormatSchema,
  visibility: deckVisibilitySchema,
});

export const updateDeckSchema = createDeckSchema.partial().extend({
  format: deckFormatBaseSchema.optional(),
  visibility: deckVisibilityBaseSchema.optional(),
});

export type CreateDeckInput = z.infer<typeof createDeckSchema>;
export type UpdateDeckInput = z.infer<typeof updateDeckSchema>;
