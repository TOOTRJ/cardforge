import { z } from "zod";
import { DECK_FORMAT_VALUES } from "@/types/deck";
import { VISIBILITY_VALUES } from "@/types/card";
import { isSafeImageUrl } from "@/lib/validation/card";
import { isDefaultDeckCover } from "@/lib/decks/default-covers";
import { deckTypeByKey } from "@/lib/decks/deck-types";
import { formatHasBracket } from "@/lib/decks/deck-details";

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

// An upload's https URL (the database holds it to the owner's own storage,
// 0127), or one of the sixteen built-in backgrounds by its site-relative
// path (0150: "Shuffle" / a pick in the cover editor) — that exact list,
// never another relative path.
const httpsCoverUrlSchema = z
  .string()
  .url("Cover URL must be a valid URL.")
  .refine(isSafeImageUrl, "Cover URL must be an https:// URL.");

const deckCoverUrlSchema = clearableString(
  z
    .string()
    .trim()
    .max(2048, "Cover URL must be 2048 characters or fewer.")
    .superRefine((value, ctx) => {
      if (isDefaultDeckCover(value)) return;
      const https = httpsCoverUrlSchema.safeParse(value);
      if (!https.success) ctx.addIssue({ code: "custom", message: https.error.issues[0]?.message ?? "Cover URL must be an https:// URL." });
    }),
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

// The deck's type (0083: text ≤ 60): one of DECK_TYPES' keys
// (lib/decks/deck-types.ts — the AI wizard's list, the hero's chip), or null
// for none. A row may hold an older free-text value the list doesn't know;
// an edit that doesn't touch the field never sends it (DK5.14).
export const deckTypeSchema = z
  .string()
  .trim()
  .max(60, "Deck type must be 60 characters or fewer.")
  .refine((key) => deckTypeByKey(key) !== null, "Pick a deck type from the list.")
  .nullable();

// The Commander power bracket (0083: 1–5 or null). Only a format with a
// bracket takes one (formatHasBracket) — checked against the format being
// SAVED: on a create here, on an edit by the action (the stored format when
// the edit leaves the format alone).
export const deckBracketSchema = z.coerce
  .number()
  .int("Bracket must be a whole number.")
  .min(1, "Bracket must be between 1 and 5.")
  .max(5, "Bracket must be between 1 and 5.")
  .nullable();

/** Why a deck of `format` may not hold `bracket`, or null when it may.
 *  Clearing (null / absent) is always allowed. */
export function bracketFormatError(format: string, bracket: number | null | undefined): string | null {
  if (bracket === null || bracket === undefined) return null;
  return formatHasBracket(format) ? null : "Only a Commander deck has a bracket.";
}

const deckBaseSchema = z.object({
  title: deckTitleSchema,
  slug: deckSlugSchema.optional(),
  description: deckDescriptionSchema,
  cover_url: deckCoverUrlSchema,
  cover_position: deckCoverPositionSchema.nullable().optional(),
  format: deckFormatSchema,
  visibility: deckVisibilitySchema,
  /** Tribe/archetype key from lib/decks/deck-types.ts (AI starting point). */
  deck_type: deckTypeSchema.optional(),
  /** Commander power bracket 1–5; null for other formats. */
  bracket: deckBracketSchema.optional(),
});

export const createDeckSchema = deckBaseSchema.superRefine((deck, ctx) => {
  const message = bracketFormatError(deck.format, deck.bracket);
  if (message) ctx.addIssue({ code: "custom", path: ["bracket"], message });
});

// An edit's bracket is checked against the format it SAVES — the stored one
// when the edit leaves the format alone — so updateDeckAction runs
// bracketFormatError once it has read the deck; here only when the edit
// names both.
export const updateDeckSchema = deckBaseSchema
  .partial()
  .extend({
    format: deckFormatBaseSchema.optional(),
    visibility: deckVisibilityBaseSchema.optional(),
  })
  .superRefine((deck, ctx) => {
    if (deck.format === undefined) return;
    const message = bracketFormatError(deck.format, deck.bracket);
    if (message) ctx.addIssue({ code: "custom", path: ["bracket"], message });
  });
