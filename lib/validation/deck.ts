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

export const deckFormatSchema = z.enum(DECK_FORMAT_VALUES).default("commander");

export const deckVisibilitySchema = z
  .enum(VISIBILITY_VALUES)
  .default("private");

export const createDeckSchema = z.object({
  title: deckTitleSchema,
  slug: deckSlugSchema.optional(),
  description: deckDescriptionSchema,
  cover_url: deckCoverUrlSchema,
  format: deckFormatSchema,
  visibility: deckVisibilitySchema,
});

export const updateDeckSchema = createDeckSchema.partial();

export type CreateDeckInput = z.infer<typeof createDeckSchema>;
export type UpdateDeckInput = z.infer<typeof updateDeckSchema>;
