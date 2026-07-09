import { z } from "zod";
import { isWatermarkPresetKey } from "@/lib/cards/watermark";
import {
  CARD_FINISH_VALUES,
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  FRAME_TEMPLATE_VALUES,
  RARITY_VALUES,
  VISIBILITY_VALUES,
} from "@/types/card";

// ---------------------------------------------------------------------------
// Primitive field schemas — mirror the cards table check constraints from
// supabase/migrations/0003_card_data_model.sql exactly. Every constraint here
// has a matching one in the DB; the DB is the source of truth.
// ---------------------------------------------------------------------------

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const optionalEmptyString = (schema: z.ZodType<string>) =>
  schema
    .optional()
    .or(z.literal("").transform(() => undefined));

/** Blocks javascript:/data:/etc. — image URLs must be https, or http only
 *  for the local Supabase stack (127.0.0.1/localhost storage URLs in dev). */
export const isSafeImageUrl = (value: string): boolean =>
  value.startsWith("https://") ||
  /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(value);

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
    .url("Art URL must be a valid URL.")
    .refine(isSafeImageUrl, "Art URL must be an https:// URL."),
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

// Freeform discovery tags. Normalized to lowercase alphanumeric + spaces/hyphens,
// deduped, ≤30 chars each, ≤12 total — matching the DB cardinality check (0034).
export const cardTagsSchema = z
  .array(z.string())
  .default([])
  .transform((tags) =>
    Array.from(
      new Set(
        tags
          .map((tag) =>
            tag
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, "")
              .replace(/\s+/g, " ")
              .trim(),
          )
          .filter((tag) => tag.length > 0 && tag.length <= 30),
      ),
    ).slice(0, 12),
  );

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
    rotation: z.number().min(-180).max(180).optional(),
  })
  .strict()
  .default({});

export const frameStyleSchema = z
  .object({
    finish: z.enum(CARD_FINISH_VALUES).optional(),
    template: z.enum(FRAME_TEMPLATE_VALUES).optional(),
  })
  .strict()
  .default({});

const uuidSchema = z.string().uuid("Must be a valid UUID.");

// ---------------------------------------------------------------------------
// Back-face schema (Phase 11 chunk 10)
//
// Same field shape as the front face, minus the shared/cross-face fields
// (rarity, color_identity, frame_style, visibility, slug, owner, etc.) —
// those live on the front-card row and apply to both faces.
//
// Title is required so we never store an "empty" back face. Everything
// else is optional and follows the same length/format rules as the front.
// ---------------------------------------------------------------------------

export const backFaceSchema = z
  .object({
    title: cardTitleSchema,
    cost: cardCostSchema,
    card_type: cardTypeSchema,
    supertype: cardSupertypeSchema,
    subtypes: cardSubtypesSchema,
    rules_text: cardRulesTextSchema,
    flavor_text: cardFlavorTextSchema,
    power: cardStatStringSchema,
    toughness: cardStatStringSchema,
    loyalty: cardStatStringSchema,
    defense: cardStatStringSchema,
    artist_credit: cardArtistCreditSchema,
    art_url: cardArtUrlSchema,
    art_position: artPositionSchema,
  })
  .strict();

export type BackFaceInput = z.infer<typeof backFaceSchema>;

// ---------------------------------------------------------------------------
// Structured face content (cards.face_content, migration 0050) — loyalty
// ability rows / saga chapters as data. Bounds match real cards: loyalty
// rows run 1–6 (WAR uncommons = 1, Urza PW = 6), saga chapters 1–6
// (The Night of the Doctor = 2, Long List of the Ents = I–VI).
// ---------------------------------------------------------------------------

// "+1" | "-3" | "0" | "X" | "-X" — accepts the U+2212 minus Scryfall oracle
// text uses and normalizes it to ASCII so the stored form matches what
// parseLoyaltyAbilities emits (the Satori bake's fonts lack U+2212).
// Exported so the creator's client-side form schema (lib/creator/
// form-schema.ts) validates loyalty costs with the exact same rule.
export const loyaltyCostSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/−|–/g, "-"))
  .pipe(
    z
      .string()
      .regex(
        /^([+-]?\d{1,3}|[+-]?X|0)$/i,
        "Loyalty cost must look like +1, -3, 0, or X.",
      ),
  )
  .transform((v) => v.toUpperCase())
  .nullable();

export const faceContentSchema = z
  .object({
    v: z.literal(1),
    loyalty: z
      .object({
        abilities: z
          .array(
            z.object({
              cost: loyaltyCostSchema,
              text: z.string().trim().min(1).max(600),
            }),
          )
          .min(1)
          .max(6),
      })
      .optional(),
    saga: z
      .object({
        intro: z.string().trim().max(400).nullable().optional(),
        chapters: z
          .array(
            z.object({
              numerals: z
                .array(z.number().int().min(1).max(6))
                .min(1)
                .max(6),
              text: z.string().trim().min(1).max(600),
            }),
          )
          .min(1)
          .max(6),
      })
      .optional(),
  })
  .strict();

export type FaceContentInput = z.infer<typeof faceContentSchema>;

// ---------------------------------------------------------------------------
// Per-card design watermark (cards.watermark, migration 0050). Preset keys
// are validated against the shipped asset list once the preset library
// lands (PR 7); until then the key is a bounded string.
// ---------------------------------------------------------------------------

const watermarkCommon = {
  opacity: z.number().min(0.04).max(0.9).optional(),
  size: z.enum(["normal", "large"]).optional(),
};

export const watermarkSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("mana"),
      key: z.enum(["w", "u", "b", "r", "g", "c"]),
      ...watermarkCommon,
    })
    .strict(),
  z
    .object({
      kind: z.literal("preset"),
      key: z
        .string()
        .regex(/^[a-z0-9-]{1,40}$/, "Unknown watermark preset.")
        .refine(isWatermarkPresetKey, "Unknown watermark preset."),
      ...watermarkCommon,
    })
    .strict(),
  z
    .object({
      kind: z.literal("custom"),
      url: z
        .string()
        .url()
        .max(2048)
        .refine(isSafeImageUrl, "Watermark URL must be an https:// URL."),
      ...watermarkCommon,
    })
    .strict(),
]);

export type WatermarkInput = z.infer<typeof watermarkSchema>;

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
  tags: cardTagsSchema,
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
  // Optional back face (Phase 11 chunk 10). `null` clears any existing
  // back face; `undefined` (omitted) leaves it untouched on update. The
  // back_face object must validate against backFaceSchema when provided.
  back_face: backFaceSchema.nullable().optional(),
  // v2 double-faced cards: a FK to another owned card used as this card's back
  // face (fully customisable). `null` clears; `undefined` leaves alone. The
  // action pre-flights ownership + a self-reference guard (like parent_card_id).
  back_card_id: uuidSchema.nullable().optional(),
  // Scryfall provenance (Phase 11 chunk 13). Set when the card was
  // imported from Scryfall via the import dialog. UUID-shaped per
  // Scryfall's id format. `null` clears; `undefined` leaves alone.
  source_scryfall_id: uuidSchema.nullable().optional(),
  // The set this card is added to + whose symbol it displays. The action
  // denormalizes that set's icon onto the card and creates set membership.
  // `null` clears the association; `undefined` leaves it untouched on update.
  primary_set_id: uuidSchema.nullable().optional(),
  // Structured loyalty/saga content (migration 0050). `null` clears (card
  // reverts to rules_text parsing); `undefined` leaves alone on update.
  face_content: faceContentSchema.nullable().optional(),
  // Design watermark. Same null/undefined semantics.
  watermark: watermarkSchema.nullable().optional(),
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
