import { z } from "zod";
import { VISIBILITY_VALUES } from "@/types/card";

// Mirrors the DB check constraints on the card_sets table exactly.
// supabase/migrations/0009_card_sets.sql is the source of truth.

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const optionalEmptyString = (schema: z.ZodString) =>
  schema.optional().or(z.literal("").transform(() => undefined));

export const setTitleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(120, "Title must be 120 characters or fewer.");

export const setSlugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required.")
  .max(80, "Slug must be 80 characters or fewer.")
  .regex(
    SLUG_PATTERN,
    "Slug must use lowercase letters, numbers, and hyphens (no leading/trailing hyphen).",
  );

export const setDescriptionSchema = optionalEmptyString(
  z
    .string()
    .trim()
    .max(1000, "Description must be 1000 characters or fewer."),
);

export const setCoverUrlSchema = optionalEmptyString(
  z
    .string()
    .trim()
    .max(2048, "Cover URL must be 2048 characters or fewer.")
    .url("Cover URL must be a valid URL."),
);

export const setVisibilitySchema = z
  .enum(VISIBILITY_VALUES)
  .default("private");

export const createSetSchema = z.object({
  title: setTitleSchema,
  slug: setSlugSchema.optional(),
  description: setDescriptionSchema,
  cover_url: setCoverUrlSchema,
  visibility: setVisibilitySchema,
});

export const updateSetSchema = createSetSchema.partial();

export type CreateSetInput = z.infer<typeof createSetSchema>;
export type UpdateSetInput = z.infer<typeof updateSetSchema>;
