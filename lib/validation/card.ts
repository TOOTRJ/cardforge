import { z } from "zod";
import { isWatermarkPresetKey } from "@/lib/cards/watermark";
import { COLLECTOR_SWITCH_VALUES } from "@/lib/cards/collector-line";
import { HOLO_STAMP_SWITCH_VALUES } from "@/lib/cards/holo-stamp";
import {
  CARD_LANG_VALUES,
  COLLECTOR_NUMBER_MAX,
  COLLECTOR_NUMBER_PATTERN,
  SET_CODE_MAX,
  SET_CODE_MIN,
  SET_CODE_PATTERN,
} from "@/lib/cards/collector-fields";
import { LEGACY_SUPABASE_HOSTS } from "@/lib/media/storage-hosts";
import {
  CARD_FINISH_VALUES,
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  DFC_ICON_FAMILY_VALUES,
  FRAME_TEMPLATE_VALUES,
  RARITY_VALUES,
  RETIRED_CARD_FINISHES,
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
 *  for the local Supabase stack (127.0.0.1/localhost storage URLs in dev).
 *  The loopback allowance is gated to non-production so a user can't store a
 *  `http://127.0.0.1/…` value that a server-side fetch (OG bake, AI art
 *  refetch) would then request in prod. */
export const isSafeImageUrl = (value: string): boolean =>
  value.startsWith("https://") ||
  (process.env.NODE_ENV !== "production" &&
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(value));

/** Hosts the SERVER is allowed to fetch image bytes from (OG data-URI bake,
 *  AI parent-art refetch). A stored `*_url` is user-influenced, so fetching it
 *  server-side is an SSRF sink — restrict to our storage bucket + Scryfall's
 *  CDN (plus loopback in dev for the local stack). Everything else — internal
 *  services, cloud metadata endpoints, arbitrary hosts — is refused. */
/** Storage hosts this project has EVER minted public URLs on — see
 *  lib/media/storage-hosts.ts (client-safe; re-exported here for the
 *  existing importers). */
export { LEGACY_SUPABASE_HOSTS };

function allowedServerImageFetchHosts(): Set<string> {
  const hosts = new Set<string>(["cards.scryfall.io", "api.scryfall.com", ...LEGACY_SUPABASE_HOSTS]);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      hosts.add(new URL(supabaseUrl).host);
    } catch {
      /* misconfigured env — fall through with just the Scryfall hosts */
    }
  }
  return hosts;
}

export function isAllowedServerImageFetchUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const devLoopback =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !devLoopback) return false;
  return devLoopback || allowedServerImageFetchHosts().has(url.host);
}

/** A card title's (and a second face's) maximum length — the DB's
 *  `cards_title_length` CHECK (migration 0122, TODO 1.12). 150, not 120, so
 *  the longest printed name imports: Unhinged #107's "Our Market Research
 *  Shows That Players Like Really Long Card Names…" is 141 characters. Deck,
 *  challenge and news titles keep their own 120. */
export const CARD_TITLE_MAX = 150;
const CARD_TITLE_MAX_MESSAGE = `Title must be ${CARD_TITLE_MAX} characters or fewer.`;

export const cardTitleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(CARD_TITLE_MAX, CARD_TITLE_MAX_MESSAGE);

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

// ⚠️ zod materializes .default() values even through .partial() — an omitted
// key comes out of parsing as the default, NOT undefined. On the update
// path that turns a partial payload into a destructive wipe of every
// defaulted column (bit us live 2026-07-10: the AI paint-and-publish
// update erased color_identity/subtypes on every generated card). Each
// defaulted schema below therefore keeps a default-FREE base that
// updateCardSchema uses, and only createCardSchema sees the defaults.

const cardSubtypesBaseSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, "Subtype cannot be empty.")
      .max(40, "Each subtype must be 40 characters or fewer."),
  )
  .max(10, "A card can have up to 10 subtypes.");

const cardSubtypesSchema = cardSubtypesBaseSchema.default([]);

// Freeform discovery tags. Normalized to lowercase alphanumeric + spaces/hyphens,
// deduped, ≤30 chars each, ≤12 total — matching the DB cardinality check (0034).
function normalizeTags(tags: string[]): string[] {
  return Array.from(
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
  ).slice(0, 12);
}

const cardTagsBaseSchema = z.array(z.string()).transform(normalizeTags);

// The collector fields (migration 0133, TODO 4.9a) — each mirrors its CHECK
// through lib/cards/collector-fields.ts (tests/unit/db/card-collector-
// fields-migration.test.ts holds the two together). `null` clears; `undefined`
// leaves the column alone on update.
/** cards_set_code_format: the PRINTED set code, upper-cased before the
 *  check so "dmu" stores as "DMU". */
export const cardSetCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    SET_CODE_PATTERN,
    `Set code must be ${SET_CODE_MIN}–${SET_CODE_MAX} letters or digits.`,
  )
  .nullable()
  .optional();
/** cards_collector_number_format: 1–12 of digits, letters, ★, †, / and -. */
export const cardCollectorNumberSchema = z
  .string()
  .trim()
  .min(1, "Collector number can't be blank.")
  .max(COLLECTOR_NUMBER_MAX, `Collector number must be ${COLLECTOR_NUMBER_MAX} characters or fewer.`)
  .regex(COLLECTOR_NUMBER_PATTERN, "Collector number can use digits, letters, ★, †, / and - only.")
  .nullable()
  .optional();
/** cards_lang_valid: one of Scryfall's 18 language codes. The column is NOT
 *  NULL (default 'en'), so there is no `null`: omitted leaves it alone. */
export const cardLangSchema = z.enum(CARD_LANG_VALUES).optional();

export const cardTagsSchema = z
  .array(z.string())
  .default([])
  .transform(normalizeTags);

const cardColorIdentityBaseSchema = z
  .array(z.enum(COLOR_IDENTITY_VALUES))
  .max(7, "Color identity has at most 7 values.");

const cardColorIdentitySchema = cardColorIdentityBaseSchema.default([]);

const cardRaritySchema = z.enum(RARITY_VALUES).optional();
const cardTypeSchema = z.enum(CARD_TYPE_VALUES).optional();

const cardVisibilityBaseSchema = z.enum(VISIBILITY_VALUES);
const cardVisibilitySchema = cardVisibilityBaseSchema.default("private");

const artPositionBaseSchema = z
  .object({
    focalX: z.number().min(0).max(1).optional(),
    focalY: z.number().min(0).max(1).optional(),
    scale: z.number().min(0.1).max(4).optional(),
    // Legacy key: accepted (two old rows carry rotation: 0) but never rendered
    // — it is not part of ArtPosition (types/card.ts).
    rotation: z.number().min(-180).max(180).optional(),
  })
  .strict();

const artPositionSchema = artPositionBaseSchema.default({});

// A retired finish (RETIRED_CARD_FINISHES, migration 0119) reads as the
// finish that draws the same pixels, so an old draft or remix never fails to
// parse; anything else unknown is still refused.
const cardFinishSchema = z.preprocess(
  (value) =>
    typeof value === "string" ? (RETIRED_CARD_FINISHES.get(value) ?? value) : value,
  z.enum(CARD_FINISH_VALUES),
);

// The per-card anatomy switches (lib/cards/anatomy.ts; TODO 4.6.0): the
// legendary crown and the two-colour frame are ADDITIONS, opt-in per card
// (owner rule 2026-09-29). Booleans only; absent = off. No DB CHECK exists on
// frame_style, so the schema is the one gate.
const frameStyleBaseSchema = z
  .object({
    finish: cardFinishSchema.optional(),
    template: z.enum(FRAME_TEMPLATE_VALUES).optional(),
    crown: z.boolean().optional(),
    twoColor: z.boolean().optional(),
    // The collector line's switches (TODO 4.9b, lib/cards/collector-line.ts):
    // a printed style, the owner's explicit "off", or absent (a stored card
    // from before the line); the foil-printing ★ is `true` or absent.
    collector: z.enum(COLLECTOR_SWITCH_VALUES).optional(),
    star: z.literal(true).optional(),
    // The holofoil stamp's switch (TODO 4.9c, lib/cards/holo-stamp.ts):
    // "auto" (rares and mythics), "oval" / "triangle" (always), "none", or
    // absent (a card from before the stamp).
    stamp: z.enum(HOLO_STAMP_SWITCH_VALUES).optional(),
    // The transform icon family (TODO 5.0a, lib/cards/dfc.ts): one of the
    // five families or absent. The save drops it on any template that is
    // not a transform front body (normalizeAnatomy) — none exists until
    // 5.1a, so no stored card can carry it yet.
    dfcIcon: z.enum(DFC_ICON_FAMILY_VALUES).optional(),
  })
  .strict();

export const frameStyleSchema = frameStyleBaseSchema.default({});

const pairColorSchema = z.enum(["white", "blue", "black", "red", "green"]);

/**
 * An EDIT's change to the anatomy switches (updateCardAction). Edits never
 * send frame_style — the frame, finish and colour are locked structure
 * (lib/creator/revise.ts) — so the switches travel on their own key and the
 * action merges them over the STORED frame_style. `pair` confirms the colour
 * pair of a stored "multicolor" card when its owner switches the two-colour
 * frame on (owner decision 2026-09-29: pre-filled from the cost, never
 * derived at render); the action accepts it only as a refinement of a
 * multicolour identity that names no other colour.
 */
export const frameAnatomyPatchSchema = z
  .object({
    crown: z.boolean().optional(),
    twoColor: z.boolean().optional(),
    // The collector line (TODO 4.9b): a style or the owner's "off"; the ★
    // flag — `false` takes a stored `true` off (the stored key is `true` or
    // absent).
    collector: z.enum(COLLECTOR_SWITCH_VALUES).optional(),
    star: z.boolean().optional(),
    // The holofoil stamp (TODO 4.9c): "auto", "oval", "triangle" or "none".
    stamp: z.enum(HOLO_STAMP_SWITCH_VALUES).optional(),
    // The transform icon family (TODO 5.0a): a family only — there is no
    // "off" (a transform card always wears one); the save drops it off any
    // template that is not a transform front body.
    dfcIcon: z.enum(DFC_ICON_FAMILY_VALUES).optional(),
    pair: z
      .tuple([pairColorSchema, pairColorSchema])
      .refine(([a, b]) => a !== b, "Pick two different colours.")
      .optional(),
  })
  .strict()
  .refine((patch) => !patch.pair || patch.twoColor === true, {
    message: "A colour pair comes with the two-colour frame switched on.",
    path: ["pair"],
  });

const uuidSchema = z.string().uuid("Must be a valid UUID.");

// ---------------------------------------------------------------------------
// Back-face schema (Phase 11 chunk 10; the back's own body since TODO 5.0a)
//
// Same field shape as the front face, minus the shared/cross-face fields
// (rarity, finish, the set symbol, the collector fields, the anatomy
// switches, visibility, slug, owner, etc.) — those live on the front-card
// row and apply to both faces — plus, for a double-faced card (Phase 5,
// owner decision Q1: ONE card holds both faces), the back's own BODY
// (`frame_style.template`, a back-face template) and COLOUR
// (`color_identity`). Both absent on a LEGACY back (the 8 imported DFCs,
// every inline layout's second panel): the back draws on the front's
// template and colour, as it always has. No DB CHECK exists on the jsonb
// (0015 / 0041 by design), so this schema is the one gate; the actions add
// the structural rule (lib/cards/dfc.ts backBodyError: a body only under a
// front that has a back face, and only a back body — none exists until
// 5.1a).
//
// The title may be empty HERE: a private draft may keep an unnamed second
// face, and whether a save needs the name depends on the card's visibility
// (lib/cards/second-face-name.ts — TODO 3b.5), which the card actions gate
// on the row as it will be stored. Everything else is optional and follows
// the same length/format rules as the front.
// ---------------------------------------------------------------------------

const backFaceTitleSchema = z
  .string()
  .trim()
  .max(CARD_TITLE_MAX, CARD_TITLE_MAX_MESSAGE);

/** A back face's body: the template alone (the finish, the switches and the
 *  rest of FrameStyle are the card's). Any template name passes HERE — the
 *  structural rule (a back body under a DFC front) is the actions'
 *  (lib/cards/dfc.ts), which keeps this module free of the profiles. */
const backBodySchema = z.enum(FRAME_TEMPLATE_VALUES);

export const backFaceSchema = z
  .object({
    title: backFaceTitleSchema,
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
    frame_style: z.object({ template: backBodySchema }).strict().optional(),
    color_identity: cardColorIdentityBaseSchema.optional(),
  })
  .strict();

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

const faceContentSchema = z
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

// ---------------------------------------------------------------------------
// Per-card design watermark (cards.watermark, migration 0050). Preset keys
// are validated against the shipped asset list once the preset library
// lands (PR 7); until then the key is a bounded string.
// ---------------------------------------------------------------------------

const watermarkCommon = {
  opacity: z.number().min(0.04).max(0.9).optional(),
  size: z.enum(["normal", "large"]).optional(),
};

const watermarkSchema = z.discriminatedUnion("kind", [
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

// ---------------------------------------------------------------------------
// Composite schemas — the shapes server actions consume.
// ---------------------------------------------------------------------------

const baseCardSchema = z.object({
  title: cardTitleSchema,
  slug: cardSlugSchema.optional(),
  game_system_id: uuidSchema,
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
  // The retired "v2" back face — a FK to another owned card (migration
  // 0041). A double-faced card is ONE row since Phase 5 (owner decision Q1;
  // its editor is TODO 5.2), so the key stays only to CLEAR a stored link
  // (`null`) until the column drops: an old tab's save that still sends it
  // must not fail validation, and a crafted uuid is refused.
  back_card_id: z.null().optional(),
  // Scryfall provenance (Phase 11 chunk 13). Set when the card was
  // imported from Scryfall via the import dialog. UUID-shaped per
  // Scryfall's id format. `null` clears; `undefined` leaves alone.
  source_scryfall_id: uuidSchema.nullable().optional(),
  // The set this card is added to + whose symbol it displays. The action
  // denormalized a set's icon onto the card (the sets feature is gone; the
  // `null` clears the association; `undefined` leaves it untouched on update.
  // Direct set-symbol override (the Set icon step, now that the sets UI is
  // hidden): an uploaded image URL or a preset Keyrune code written straight
  // onto the card's denormalized icon columns. When provided they WIN over
  // icon is a plain card field now). `null` clears back to the default PipGlyph mark;
  // `undefined` leaves the columns untouched on update.
  set_icon_url: z
    .string()
    .trim()
    .max(2048, "Icon URL must be 2048 characters or fewer.")
    .url("Icon URL must be a valid URL.")
    .refine(isSafeImageUrl, "Icon URL must be an https:// URL.")
    .nullable()
    .optional(),
  set_icon_code: z
    .string()
    .trim()
    .max(32, "Set code must be 32 characters or fewer.")
    .regex(/^[a-z0-9]+$/, "Set code must be lowercase letters and numbers only.")
    .nullable()
    .optional(),
  // The collector fields (migration 0133, TODO 4.9a): the PRINTED set code
  // (beside the Keyrune code above, never derived from it), the collector
  // number and the printing's language. Card content: editable on an
  // existing card (lib/creator/revise.ts) and filled by the Scryfall import.
  set_code: cardSetCodeSchema,
  collector_number: cardCollectorNumberSchema,
  lang: cardLangSchema,
  // A deck to drop this card into on create (a custom-only deck_cards entry,
  // mainboard ×1). Create-flow convenience only — the action ignores it on
  // update (deck membership is managed from the deck dashboard).
  deck_id: uuidSchema.nullable().optional(),
  // Structured loyalty/saga content (migration 0050). `null` clears (card
  // reverts to rules_text parsing); `undefined` leaves alone on update.
  face_content: faceContentSchema.nullable().optional(),
  // Design watermark. Same null/undefined semantics.
  watermark: watermarkSchema.nullable().optional(),
  /** Subscriber footer mark for THIS card (migration 0090): "" = none,
   *  null/omitted = fall back to the profile default. Ignored for free
   *  accounts by the actions. */
  footer_text: z.string().trim().max(40, "Keep it under 40 characters.").nullable().optional(),
  /** An admin's frame-preview save (TODO 2.3): the creator asks for it in
   *  admin preview mode. The actions honour it ONLY for an admin (checked
   *  on the server) — the card then skips the verification gate, lands
   *  private and is flagged `frame_preview` (migration 0121). Anyone else's
   *  request is ignored and the gate applies as usual. */
  frame_preview: z.boolean().optional(),
});

export const createCardSchema = baseCardSchema;

// Update accepts the same shape but everything is optional. We model it as a
// partial of the base, THEN override every defaulted field with its
// default-free base: zod fills defaults for omitted keys even through
// .partial(), and the action layer treats "defined" as "write this column" —
// without the overrides a partial update silently wipes those columns.
export const updateCardSchema = baseCardSchema.partial().extend({
  subtypes: cardSubtypesBaseSchema.optional(),
  tags: cardTagsBaseSchema.optional(),
  color_identity: cardColorIdentityBaseSchema.optional(),
  visibility: cardVisibilityBaseSchema.optional(),
  art_position: artPositionBaseSchema.optional(),
  frame_style: frameStyleBaseSchema.optional(),
  frame_anatomy: frameAnatomyPatchSchema.optional(),
});

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
/** Slugs a card can never take because the URL segment after
 *  /card/<username>/ or /card/ is a route of its own (the owner editor lives
 *  at /card/<slug>/edit). A card slugged "edit" was unreachable at its
 *  public URL; ensureUniqueSlugForUser treats these as taken and suffixes
 *  them like a duplicate title. */
export const RESERVED_CARD_SLUGS: ReadonlySet<string> = new Set([
  "edit",
  "new",
  "create",
  "remix",
  "delete",
  "api",
]);

export function isReservedCardSlug(slug: string): boolean {
  return RESERVED_CARD_SLUGS.has(slug.toLowerCase());
}

/** Lowercase, diacritics folded, non-alphanumerics collapsed to single
 *  hyphens, cut at `max` — `fallback` when nothing survives. */
export function slugify(input: string, max = 80, fallback = "untitled-card"): string {
  // U+0300–U+036F is the Unicode combining diacritical marks block; stripping
  // those after NFKD-normalizing folds "café" → "cafe" before slug cleanup.
  const DIACRITIC_PATTERN = /[̀-ͯ]/g;
  const cleaned = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(DIACRITIC_PATTERN, "")
    .replace(SLUG_REPLACE, "-")
    .replace(SLUG_TRIM, "")
    .slice(0, max)
    // A cut that lands on a hyphen would fail the slug CHECK constraints.
    .replace(SLUG_TRIM, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

export { SLUG_PATTERN };
