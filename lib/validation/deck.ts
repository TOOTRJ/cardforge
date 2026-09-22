import { z } from "zod";
import { DECK_FORMAT_VALUES } from "@/types/deck";
import { VISIBILITY_VALUES } from "@/types/card";
import { isSafeImageUrl } from "@/lib/validation/card";

// Mirrors the DB check constraints on the decks table exactly.
// supabase/migrations/0055_decks.sql is the source of truth.

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const optionalEmptyString = (schema: z.ZodType<string>) =>
  schema.optional().or(z.literal("").transform(() => undefined));

/** Like optionalEmptyString, but an explicit `null` is a valid value meaning
 *  "clear this field" — the edit form sends it for an emptied input (0055
 *  columns are nullable). `undefined`/"" still mean "unchanged". */
const clearableString = (schema: z.ZodType<string>) =>
  optionalEmptyString(schema).or(z.null());

const deckTitleSchema = z
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

const deckDescriptionSchema = clearableString(
  z
    .string()
    .trim()
    .max(2000, "Description must be 2000 characters or fewer."),
);

const deckCoverUrlSchema = clearableString(
  z
    .string()
    .trim()
    .max(2048, "Cover URL must be 2048 characters or fewer.")
    .url("Cover URL must be a valid URL.")
    .refine(isSafeImageUrl, "Cover URL must be an https:// URL."),
);

// Cover focal point — {focalX, focalY} in 0..1 (migration 0057). `null`
// clears back to centered.
const deckCoverPositionSchema = z.object({
  focalX: z.number().min(0).max(1),
  focalY: z.number().min(0).max(1),
});

// ⚠️ zod materializes .default() values even through .partial() — see the
// matching note in lib/validation/card.ts. updateDeckSchema overrides the
// defaulted fields with their default-free bases so a partial update (e.g.
// the AI cover attach) can't silently reset format/visibility.
const deckFormatBaseSchema = z.enum(DECK_FORMAT_VALUES);
const deckFormatSchema = deckFormatBaseSchema.default("commander");

// Decks default to public (like cards) — sharing the build is the point.
// The DB column default stays 'private' as the conservative fallback for
// writes that bypass this schema.
const deckVisibilityBaseSchema = z.enum(VISIBILITY_VALUES);
const deckVisibilitySchema = deckVisibilityBaseSchema.default("public");

export const createDeckSchema = z.object({
  title: deckTitleSchema,
  slug: deckSlugSchema.optional(),
  description: deckDescriptionSchema,
  cover_url: deckCoverUrlSchema,
  cover_position: deckCoverPositionSchema.nullable().optional(),
  format: deckFormatSchema,
  visibility: deckVisibilitySchema,
  /** Tribe/archetype key from lib/decks/deck-types.ts (AI starting point). */
  deck_type: z.string().trim().max(60).nullable().optional(),
  /** Commander power bracket 1–5; null for other formats. */
  bracket: z.coerce.number().int().min(1).max(5).nullable().optional(),
});

export const updateDeckSchema = createDeckSchema.partial().extend({
  format: deckFormatBaseSchema.optional(),
  visibility: deckVisibilityBaseSchema.optional(),
});
