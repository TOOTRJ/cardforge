import { z } from "zod";
import {
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
  VISIBILITY_VALUES,
} from "@/types/card";

// ---------------------------------------------------------------------------
// Primitive field schemas — mirror the cards table check constraints from
// supabase/migrations/0003_card_data_model.sql exactly. Every constraint here
// has a matching one in the DB; the DB is the source of truth.
// ---------------------------------------------------------------------------

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const optionalEmptyString = (schema: z.ZodString) =>
  schema
    .optional()
    .or(z.literal("").transform(() => undefined));

export const cardTitleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(120, "Title must be 120 characters or fewer.");

export const cardSlugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required.")
  .max(80, "Slug must be 80 characters or fewer.")
  .regex(
    SLUG_PATTERN,
    "Slug must use lowercase letters, numbers, and hyphens (no leading/trailing hyphen).",
  );

export const cardCostSchema = optionalEmptyString(
  z
    .string()
    .trim()
    .max(64, "Cost must be 64 characters or fewer."),
);

export const cardSupertypeSchema = optionalEmptyString(
  z
    .string()
    .trim()
    .max(64, "Supertype must be 64 characters or fewer."),
);

export const cardRulesTextSchema = optionalEmptyString(
  z
    .string()
    .trim()
    .max(4000, "Rules text must be 4000 characters or fewer."),
);

export const cardFlavorTextSchema = optionalEmptyString(
  z
    .string()
    .trim()
    .max(1000, "Flavor text must be 1000 characters or fewer."),
);

export const cardStatStringSchema = optionalEmptyString(
  z
    .string()
    .trim()
    .max(16, "Value must be 16 characters or fewer."),
);

export const cardArtistCreditSchema = optionalEmptyString(
  z
    .string()
    .trim()
    .max(120, "Artist credit must be 120 characters or fewer."),
);

export const cardArtUrlSchema = optionalEmptyString(
  z
    .string()
    .trim()
    .max(2048, "Art URL must be 2048 characters or fewer.")
    .url("Art URL must be a valid URL."),
);

export const cardSubtypesSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, "Subtype cannot be empty.")
      .max(40, "Each subtype must be 40 characters or fewer."),
  )
  .max(10, "A card can have up to 10 subtypes.")
  .default([]);

export const cardColorIdentitySchema = z
  .array(z.enum(COLOR_IDENTITY_VALUES))
  .max(7, "Color identity has at most 7 values.")
  .default([]);

export const cardRaritySchema = z.enum(RARITY_VALUES).optional();
export const cardTypeSchema = z.enum(CARD_TYPE_VALUES).optional();
export const cardVisibilitySchema = z.enum(VISIBILITY_VALUES).default("private");

export const artPositionSchema = z
  .object({
    focalX: z.number().min(0).max(1).optional(),
    focalY: z.number().min(0).max(1).optional(),
    scale: z.number().min(0.1).max(4).optional(),
  })
  .strict()
  .default({});

export const frameStyleSchema = z
  .object({
    border: z.enum(["thin", "thick", "ornate"]).optional(),
    accent: z.enum(["warm", "cool", "neutral"]).optional(),
  })
  .strict()
  .default({});

const uuidSchema = z.string().uuid("Must be a valid UUID.");

// ---------------------------------------------------------------------------
// Composite schemas — the shapes server actions consume.
// ---------------------------------------------------------------------------

const baseCardSchema = z.object({
  title: cardTitleSchema,
  slug: cardSlugSchema.optional(),
  game_system_id: uuidSchema,
  template_id: uuidSchema.optional(),
  cost: cardCostSchema,
  color_identity: cardColorIdentitySchema,
  supertype: cardSupertypeSchema,
  card_type: cardTypeSchema,
  subtypes: cardSubtypesSchema,
  rarity: cardRaritySchema,
  rules_text: cardRulesTextSchema,
  flavor_text: cardFlavorTextSchema,
  power: cardStatStringSchema,
  toughness: cardStatStringSchema,
  loyalty: cardStatStringSchema,
  defense: cardStatStringSchema,
  artist_credit: cardArtistCreditSchema,
  art_url: cardArtUrlSchema,
  art_position: artPositionSchema,
  frame_style: frameStyleSchema,
  visibility: cardVisibilitySchema,
  parent_card_id: uuidSchema.optional(),
});

export const createCardSchema = baseCardSchema;

// Update accepts the same shape but everything is optional. We model it as a
// partial of the base — the action layer rejects empty payloads.
export const updateCardSchema = baseCardSchema.partial();

export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardInput = z.infer<typeof updateCardSchema>;

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

const SLUG_REPLACE = /[^a-z0-9]+/g;
const SLUG_TRIM = /^-+|-+$/g;

/**
 * Convert a free-form title into a kebab-case slug that matches the DB
 * `cards_slug_format` check constraint. Caller should still ensure
 * uniqueness within the owner's namespace.
 */
export function slugify(input: string, max = 80): string {
  // U+0300–U+036F is the Unicode combining diacritical marks block; stripping
  // those after NFKD-normalizing folds "café" → "cafe" before slug cleanup.
  const DIACRITIC_PATTERN = /[̀-ͯ]/g;
  const cleaned = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(DIACRITIC_PATTERN, "")
    .replace(SLUG_REPLACE, "-")
    .replace(SLUG_TRIM, "")
    .slice(0, max);
  return cleaned.length > 0 ? cleaned : "untitled-card";
}

export { SLUG_PATTERN };
