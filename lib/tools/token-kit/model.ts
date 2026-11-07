import { z } from "zod";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { newCardFrameStyle, pairColorIdentity, twoColorPairOf } from "@/lib/cards/anatomy";
import { fitArtToWindow } from "@/lib/cards/art-fit";
import { hasRulesBoxText } from "@/lib/cards/card-display";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { tokenHeightOf } from "@/lib/cards/token-height";
import { isWatermarkPresetKey, WATERMARK_PRESETS } from "@/lib/cards/watermark";
import { archTokenFrameIn, autoM20TokenFrame, tokenFrameText } from "@/lib/creator/token-frame-auto";
import { enchantmentFrameFor } from "@/lib/creator/card-kinds";
import type { ArtPosition, CardWatermark, ColorIdentity, FrameStyle, FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The Token Kit (beta tool `token-kit`): every token, emblem and helper card
// a deck makes, drawn as ONE kit — one design, one set symbol, one
// watermark — by the same CardPreview the creator draws, and printed through
// the same print paths. A kit token is NOT a saved card (it never counts
// toward the card limit); "Save to My Cards" makes one a normal card through
// createCardAction.
//
// This module is the kit's pure core, shared by the browser (the live
// previews) and the server (the print render rebuilds the same preview data
// from the token's FACE and the kit's SETTINGS — never a client's
// CardPreviewData), so what prints is what the page drew:
//
//   * a FACE (`KitFace`): what the token IS — its words, colours, text and
//     stats, from its Scryfall printing or a PipGlyph card's own text;
//   * the kit's SETTINGS (`KitSettings`): how every token looks;
//   * a token's STATE (`KitItemState`): in the kit or not, copies, its art.
//
// Frames follow CLAUDE.md's token rules: the design the kit picks (full art
// or the 2014–19 arch) at the height the text asks for (tokenFrameFor /
// autoM20TokenFrame), dressed by the Artifact word, the Nyx dress for an
// Enchantment token where the kit asks for it — and ONLY a combo verified
// in the token's colour (frame_reviews). The other design stands in where
// the chosen one isn't verified; a token neither design can draw in its
// colour is listed, never drawn. An emblem draws on the emblem frame; a
// helper card (the Monarch, the Initiative, Day // Night…) on the emblem
// frame too — the one textual "game piece" frame PipGlyph has — and a
// dungeon not at all (it is a map, a layout of its own).
// ---------------------------------------------------------------------------

/** What a kit item is (lib/decks/deck-tokens.ts's kinds). */
export const KIT_ITEM_KINDS = ["token", "emblem", "helper"] as const;
export type KitItemKind = (typeof KIT_ITEM_KINDS)[number];

/** The colours a token face can be (the five and colourless). */
export const KIT_FACE_COLORS = ["white", "blue", "black", "red", "green", "colorless"] as const;
export type KitFaceColor = (typeof KIT_FACE_COLORS)[number];

const shortText = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => shortText(max).nullable();

/** One token face — the shape the server trusts from a client only after
 *  this parse (the print route), and the shape the kit stores per token. */
export const kitFaceSchema = z.object({
  kind: z.enum(KIT_ITEM_KINDS),
  /** "Treasure", "Spirit", "Chandra Emblem" → the emblem frame prints the
   *  walker's name; "The Monarch". */
  title: shortText(120).min(1),
  /** The type words left of the dash ("Artifact", "Legendary Creature") —
   *  `supertype` on a token card. */
  typeWords: optionalText(80),
  subtypes: z.array(shortText(40).min(1)).max(8),
  colors: z.array(z.enum(KIT_FACE_COLORS)).max(5),
  rulesText: optionalText(1200),
  flavorText: optionalText(400),
  power: optionalText(8),
  toughness: optionalText(8),
});
export type KitFace = z.infer<typeof kitFaceSchema>;

/** The kit's one design. */
export const KIT_DESIGNS = ["fullart", "arch"] as const;
export type KitDesign = (typeof KIT_DESIGNS)[number];

export const KIT_DESIGN_LABELS: Record<KitDesign, string> = {
  fullart: "Full art (2020 →)",
  arch: "Arch (2014–2019)",
};

/** The kit's watermark: none, each token's own mana symbol, or one of the
 *  PipGlyph presets on every token that has rules text. */
export const kitWatermarkSchema = z.union([
  z.literal("none"),
  z.literal("mana"),
  z.string().refine(isWatermarkPresetKey, "Unknown watermark."),
]);
export type KitWatermark = z.infer<typeof kitWatermarkSchema>;

export const kitSettingsSchema = z.object({
  design: z.enum(KIT_DESIGNS),
  /** The Nyx dress (the starfield name pill) on an Enchantment token, full
   *  art only — where it is verified in the token's colour. */
  nyx: z.boolean(),
  /** A Keyrune set symbol for every token, or null for the PipGlyph mark. */
  setIconCode: z
    .string()
    .trim()
    .max(32)
    .regex(/^[a-z0-9]+$/)
    .nullable(),
  watermark: kitWatermarkSchema,
  rulesAlign: z.enum(["left", "center"]),
  /** The art direction every AI picture of the kit is painted in
   *  (lib/ai/presets.ts STYLE_PRESETS id). */
  artStyle: shortText(40).min(1),
});
export type KitSettings = z.infer<typeof kitSettingsSchema>;

export const DEFAULT_KIT_SETTINGS: KitSettings = Object.freeze({
  design: "fullart",
  nyx: true,
  setIconCode: null,
  watermark: "none",
  rulesAlign: "left",
  artStyle: "classic-oil",
}) as KitSettings;

/** The most copies of one token a kit prints. */
export const KIT_MAX_COPIES = 24;

const artPositionSchema = z.object({
  focalX: z.number().min(0).max(1).optional(),
  focalY: z.number().min(0).max(1).optional(),
  scale: z.number().min(1).max(4).optional(),
});

/** One token's own choices in the kit. `artUrl` is checked where it is used
 *  (isAllowedMediaUrl: the owner's own card-art objects only). */
export const kitItemStateSchema = z.object({
  include: z.boolean(),
  copies: z.number().int().min(0).max(KIT_MAX_COPIES),
  artUrl: z.string().trim().max(2048).nullable(),
  artistCredit: optionalText(80),
  artPosition: artPositionSchema.nullable(),
});
export type KitItemState = z.infer<typeof kitItemStateSchema>;

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** A face's colours as a card stores them: colourless when none; one colour;
 *  a two-colour PAIR in printed order (the two-colour frame draws it); three
 *  or more as "multicolor" (the gold frame). */
export function kitColorIdentity(colors: readonly KitFaceColor[]): ColorIdentity[] {
  const coloured = [...new Set(colors.filter((c) => c !== "colorless"))];
  if (coloured.length === 0) return ["colorless"];
  if (coloured.length === 1) return [coloured[0]];
  const pair = twoColorPairOf(coloured);
  return pair ? [...pairColorIdentity(pair)] : ["multicolor"];
}

/** The frame colour key a face is gated in ("w" … "g", "c", gold "m"). */
export function kitColorKey(face: Pick<KitFace, "kind" | "colors">): string {
  return face.kind === "token" ? pickFrameColorKey(kitColorIdentity(face.colors)) : "c";
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/** Why a face can't be drawn in the kit. */
export type KitUndrawable = "dungeon" | "unverified";

export type KitFrame =
  | {
      ok: true;
      template: FrameTemplate;
      /** The design the frame is from — the kit's, or the other one standing
       *  in where the kit's isn't verified in the token's colour. */
      design: KitDesign | "emblem";
      standIn: boolean;
    }
  | { ok: false; reason: KitUndrawable };

/** The card type a face is drawn (and saved) as. */
export function kitCardType(face: Pick<KitFace, "kind">): "token" | "emblem" {
  return face.kind === "token" ? "token" : "emblem";
}

/** True for a helper card that is a dungeon (a venture map — no frame). */
export function isDungeonFace(face: Pick<KitFace, "kind" | "typeWords" | "subtypes">): boolean {
  return face.kind === "helper" && /^dungeon\b/i.test(face.typeWords ?? "");
}

function frameTextOf(face: KitFace) {
  return tokenFrameText({
    cardType: "token",
    supertype: face.typeWords,
    subtypes: face.subtypes,
    rulesText: face.rulesText,
    flavorText: face.flavorText,
    power: face.power,
    toughness: face.toughness,
  });
}

/**
 * The frame a face draws on in the kit, or why it can't. A token: the kit's
 * design at the height its text asks for (in the Nyx dress for an
 * Enchantment token when the kit asks, full art only, single colour only —
 * enchantmentFrameFor), each candidate only where it is VERIFIED in the
 * token's colour, the other design standing in. An emblem or a helper card:
 * the emblem frame where it is verified. A dungeon: never.
 */
export function kitFrameFor(face: KitFace, settings: Pick<KitSettings, "design" | "nyx">, verifiedKeys: ReadonlySet<string>): KitFrame {
  if (isDungeonFace(face)) return { ok: false, reason: "dungeon" };
  if (face.kind !== "token") {
    return isFrameComboAvailable("emblem", "c", verifiedKeys)
      ? { ok: true, template: "emblem", design: "emblem", standIn: false }
      : { ok: false, reason: "unverified" };
  }
  const text = frameTextOf(face);
  const colorKey = kitColorKey(face);
  const full = autoM20TokenFrame(text);
  const nyx = settings.nyx ? enchantmentFrameFor("token", full, { supertype: face.typeWords }, colorKey) : full;
  const arch = archTokenFrameIn(text, colorKey, verifiedKeys);
  const fullArt: FrameTemplate[] = nyx === full ? [full] : [nyx, full];
  const ordered: Array<{ template: FrameTemplate; design: KitDesign }> =
    settings.design === "fullart"
      ? [...fullArt.map((template) => ({ template, design: "fullart" as const })), { template: arch, design: "arch" }]
      : [{ template: arch, design: "arch" }, ...fullArt.map((template) => ({ template, design: "fullart" as const }))];
  for (const candidate of ordered) {
    if (isFrameComboAvailable(candidate.template, colorKey, verifiedKeys)) {
      return { ok: true, template: candidate.template, design: candidate.design, standIn: candidate.design !== settings.design };
    }
  }
  return { ok: false, reason: "unverified" };
}

/** The design a token template is from ("fullart" / "arch"), else null. */
export function kitDesignOfTemplate(template: FrameTemplate | string): KitDesign | null {
  const of = tokenHeightOf(template);
  return of ? (of.design === "m20" ? "fullart" : "arch") : null;
}

// ---------------------------------------------------------------------------
// The watermark
// ---------------------------------------------------------------------------

const MANA_WATERMARK_KEY: Partial<Record<string, "w" | "u" | "b" | "r" | "g" | "c">> = {
  w: "w",
  u: "u",
  b: "b",
  r: "r",
  g: "g",
  c: "c",
};

/** The watermark a face prints: only behind rules text (a textless token
 *  has no box to print it in); "mana" = the token's own colour's symbol
 *  (none on a gold token); a preset = that PipGlyph mark. */
export function kitWatermarkFor(face: KitFace, watermark: KitWatermark): CardWatermark | null {
  if (watermark === "none" || !hasRulesBoxText(face)) return null;
  if (watermark === "mana") {
    const key = MANA_WATERMARK_KEY[kitColorKey(face)];
    return key ? { kind: "mana", key, size: "normal" } : null;
  }
  return isWatermarkPresetKey(watermark) ? { kind: "preset", key: watermark, size: "normal" } : null;
}

export const KIT_WATERMARK_OPTIONS: ReadonlyArray<{ value: KitWatermark; label: string }> = [
  { value: "none", label: "None" },
  { value: "mana", label: "Mana symbol" },
  ...WATERMARK_PRESETS.map((preset) => ({ value: preset.key as KitWatermark, label: preset.label })),
];

// ---------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------

/** The art position a kit picture is drawn at: the stored one, else the
 *  automatic fit (fill the window, show the centre). */
export function kitArtPosition(position: KitItemState["artPosition"]): ArtPosition {
  return position ?? fitArtToWindow();
}

/** The fields a face saves / draws as a card (the token or emblem shape:
 *  an emblem has no colour, type words or stats). */
export function kitCardFields(face: KitFace) {
  const cardType = kitCardType(face);
  const token = cardType === "token";
  return {
    title: face.title,
    cardType,
    supertype: token ? face.typeWords || null : null,
    subtypes: token ? face.subtypes : [],
    colorIdentity: token ? kitColorIdentity(face.colors) : (["colorless"] as ColorIdentity[]),
    rulesText: face.rulesText || null,
    flavorText: face.flavorText || null,
    power: token ? face.power || null : null,
    toughness: token ? face.toughness || null : null,
  };
}

/** The frame_style a face draws with: the frame, the new-card anatomy its
 *  template draws (newCardFrameStyle: the crown on a Legendary token, the
 *  two-colour split; never a stamp or a collector line on a token) and the
 *  kit's text alignment. */
export function kitFrameStyle(face: KitFace, template: FrameTemplate, settings: Pick<KitSettings, "rulesAlign">): FrameStyle {
  const fields = kitCardFields(face);
  const style: FrameStyle = { template, ...(settings.rulesAlign === "center" ? { rulesAlign: "center" } : {}) };
  return newCardFrameStyle(style, fields.cardType, fields.colorIdentity);
}

/**
 * The CardPreviewData a kit token draws with — or null when it can't be
 * drawn (kitFrameFor). The ONE builder the page's previews and the print
 * route read, so the PDF is what the page showed.
 */
export function kitPreviewData(
  face: KitFace,
  settings: KitSettings,
  state: Pick<KitItemState, "artUrl" | "artistCredit" | "artPosition">,
  verifiedKeys: ReadonlySet<string>,
): { data: CardPreviewData; frame: Extract<KitFrame, { ok: true }> } | null {
  const frame = kitFrameFor(face, settings, verifiedKeys);
  if (!frame.ok) return null;
  const fields = kitCardFields(face);
  return {
    frame,
    data: {
      title: fields.title,
      cardType: fields.cardType,
      supertype: fields.supertype,
      subtypes: fields.subtypes,
      rarity: "common",
      colorIdentity: fields.colorIdentity,
      rulesText: fields.rulesText,
      flavorText: fields.flavorText,
      power: fields.power,
      toughness: fields.toughness,
      artistCredit: state.artistCredit || null,
      artUrl: state.artUrl || null,
      artPosition: kitArtPosition(state.artPosition),
      frameStyle: kitFrameStyle(face, frame.template, settings),
      setIconUrl: null,
      setIconCode: settings.setIconCode,
      watermark: kitWatermarkFor(face, settings.watermark),
    },
  };
}
