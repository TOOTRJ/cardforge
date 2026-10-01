// ---------------------------------------------------------------------------
// Frame anatomy — the printed pieces a card switches on one by one (TODO
// 4.6.0): the legendary crown (4.6a) and the two-colour frame (4.6b).
//
// THE OWNER RULE (2026-09-29, docs/FRAMES.md "Additions vs corrections"):
// these are ADDITIONS, so each is OPT-IN PER CARD, stored as card data in
// `frame_style` (FrameStyle.crown / FrameStyle.twoColor):
//   • the renderers draw a piece only when its switch is `true` — absent and
//     `false` are both today's look, so no card stored before a piece
//     shipped ever changes (no layout sweep, no badge);
//   • a NEW card starts with every switch on (NEW_CARD_ANATOMY in the
//     creator; createCardAction stamps a payload that names none — the AI
//     jobs), with an off switch;
//   • an import follows the printing, and names only what the printing
//     says (owner round 17, 2026-09-30; importedAnatomy): the crown for a
//     Legendary printing (on with the `legendary` frame effect, off without
//     it and on any showcase), the two-colour frame and its pair only for a
//     two-colour printing — any other switch is left to the new-card
//     default, so a card made Legendary or given a pair later starts on;
//   • every save drops a switch the saved template can't draw for the card
//     (normalizeAnatomy), so a template that gains a piece later (4.6f
//     wave 2) never changes a card stored on it before — and a LAND keeps
//     the two-colour switch only on a land frame (twoColorFits).
//
// A template draws a piece when its PROFILES entry declares it
// (FrameProfile.overlays for the crown band, FrameProfile.crownMasters for a
// crown baked into `-legendary` masters, FrameProfile.twoColorMasters for
// the pairs). The crown band is declared on m15, m15artifact and m15land
// (4.6a, template-layout.ts M15_CROWN); the pairs came with 4.6b; the
// borderless frames draw the floating crown from their crowned twins and
// the pinline-only pair (4.6f, wave 2a). A card draws a piece only with its
// switch on, so a declaration changes no stored card.
//
// The colour PAIR is card data too (owner decision 2026-09-29): exactly two
// WUBRG words in `color_identity`, in any order, the "multicolor" token
// ignored (the AI writes ["blue","white","multicolor"]). It is picked in the
// creator's "Two colours" row, pre-filled from the cost, and written by the
// AI and the import — never derived from the cost at render time. The DRESS
// (gold-split or hybrid) is what print does for the card's cost, derived at
// render (twoColorDressOf).
//
// Pure and client-safe: the preview, the bake, the creator, the actions and
// the import mapper all read these same functions.
// ---------------------------------------------------------------------------

import { supertypeHasWord } from "@/lib/cards/card-display";
import { canonicalColorSequence } from "@/lib/cards/mana-order";
import { TWO_COLOR_PAIRS, type TwoColorPair } from "@/lib/cards/frame-reference-registry";
import { legendaryMasterKey } from "@/lib/cards/master-key";
import {
  getFrameProfile,
  type FrameOverlaySlot,
  type FrameProfile,
  type Rect,
  type TwoColorDress,
} from "@/lib/cards/template-layout";
import type { ColorIdentity, FrameStyle, FrameTemplate } from "@/types/card";

export { TWO_COLOR_PAIRS, type TwoColorPair, type TwoColorDress };

/** The per-card anatomy switches, in FrameStyle. */
export const FRAME_ANATOMY_KEYS = ["crown", "twoColor"] as const;
export type FrameAnatomyKey = (typeof FRAME_ANATOMY_KEYS)[number];
export type FrameAnatomyStyle = Pick<FrameStyle, FrameAnatomyKey>;

/** What a template can draw: the crown, and the two-colour dresses it has
 *  pair masters for. */
export type FrameAnatomy = { crown: boolean; twoColor: readonly TwoColorDress[] };

type AnatomyProfile = Pick<FrameProfile, "overlays" | "twoColorMasters" | "twoColorForLands" | "crownMasters">;

/** The switches a NEW card starts with (the creator's create and remix
 *  forms): every piece on. The renderers draw only what the template can,
 *  and the save drops the rest (normalizeAnatomy), so the new-card preview
 *  is exactly what the saved bake draws on any template. */
export const NEW_CARD_ANATOMY: Readonly<Required<FrameAnatomyStyle>> = Object.freeze({
  crown: true,
  twoColor: true,
});

export function frameAnatomyOfProfile(profile: AnatomyProfile): FrameAnatomy {
  return {
    // The crown is drawn either as an overlay band (4.6a) or baked into the
    // template's `-legendary` masters (4.6f, FrameProfile.crownMasters).
    crown: (profile.overlays ?? []).some((slot) => slot.anatomy === "crown") || profile.crownMasters === true,
    twoColor: profile.twoColorMasters ?? [],
  };
}

/** What `template` draws — from its CODE profile (overlays and pair masters
 *  are code-owned; an admin override never adds one). An unknown or legacy
 *  template reads as m15, as the renderers do (getFrameProfile). */
export function frameAnatomyOf(template: FrameTemplate | string | null | undefined): FrameAnatomy {
  return frameAnatomyOfProfile(getFrameProfile(template ?? undefined));
}

/** True when a template with `anatomy` draws the piece `key` at all. */
export function anatomyDrawn(anatomy: FrameAnatomy, key: FrameAnatomyKey): boolean {
  return key === "crown" ? anatomy.crown : anatomy.twoColor.length > 0;
}

/**
 * True when a card of `cardType` can wear the two-colour frame on `profile`:
 * the profile has pair masters, and a LAND only where they are a land
 * frame's (FrameProfile.twoColorForLands: m15land). On m15 or m15artifact a
 * two-colour land would wear a nonland frame's gold-split (Shadowwood Hollow
 * and Sunfade Citadel, lands stored with no template and drawn on m15) —
 * owner round 17, 2026-09-30: the switch is hidden there, never offered. The
 * ONE rule the renderers (resolveTwoColor), the save (normalizeAnatomy), an
 * edit's flip (applyFrameAnatomyPatch) and the creator's switch
 * (offersTwoColor) share, so the preview never draws what the save drops.
 */
export function twoColorFits(profile: AnatomyProfile, cardType: string | null | undefined): boolean {
  if ((profile.twoColorMasters ?? []).length === 0) return false;
  return cardType !== "land" || profile.twoColorForLands === true;
}

/** twoColorFits for a stored template (its CODE profile, like
 *  frameAnatomyOf). */
export function twoColorFitsTemplate(
  template: FrameTemplate | string | null | undefined,
  cardType: string | null | undefined,
): boolean {
  return twoColorFits(getFrameProfile(template ?? undefined), cardType);
}

/** The ONE render rule for a switch: on only when it is exactly `true`. */
export function anatomyOn(
  style: FrameAnatomyStyle | null | undefined,
  key: FrameAnatomyKey,
): boolean {
  return style?.[key] === true;
}

/** The switches a new card saved on `template` defaults to: `true` for each
 *  piece the template draws (whatever the card's type or colours, so the
 *  crown appears if the card becomes Legendary later), nothing else. */
export function anatomyDefaults(
  template: FrameTemplate | string | null | undefined,
): FrameAnatomyStyle {
  const anatomy = frameAnatomyOf(template);
  const out: FrameAnatomyStyle = {};
  for (const key of FRAME_ANATOMY_KEYS) {
    if (anatomyDrawn(anatomy, key)) out[key] = true;
  }
  return out;
}

/**
 * The frame style as it is SAVED (create and update): a switch for a piece
 * the template can't draw is dropped — a `true`, so a template that gains
 * that piece later never changes the card, and a `false` too, since absent
 * already means off (a stored frame_style names only the switches its
 * template draws). So is the two-colour switch of a LAND on a template
 * whose pairs aren't a land frame's (twoColorFits: m15, m15artifact — owner
 * round 17, 2026-09-30), whatever the payload says. A switch the template
 * draws is kept either way — `false` is its owner's explicit "off".
 * Everything else is kept as it is. Returns the input itself when nothing is
 * dropped.
 */
export function normalizeAnatomy<T extends FrameAnatomyStyle>(
  frameStyle: T,
  template: FrameTemplate | string | null | undefined,
  cardType: string | null | undefined,
): T {
  const profile = getFrameProfile(template ?? undefined);
  const anatomy = frameAnatomyOfProfile(profile);
  let out = frameStyle;
  for (const key of FRAME_ANATOMY_KEYS) {
    const drawn = key === "twoColor" ? twoColorFits(profile, cardType) : anatomyDrawn(anatomy, key);
    if (key in frameStyle && !drawn) {
      if (out === frameStyle) out = { ...frameStyle };
      delete out[key];
    }
  }
  return out;
}

/**
 * A NEW card's stored frame style (createCardAction — the one insert behind
 * the creator, the AI jobs and remixes): every switch the payload doesn't
 * name defaults to its template's (anatomyDefaults) — an import names only
 * what its printing says (importedAnatomy), so the rest get this default
 * too — then the save rule applies (normalizeAnatomy, with the card's type).
 * An explicit `false` (a crownless Legendary printing, a Legendary
 * showcase, the creator's off switch) stays. The input itself when nothing changes.
 */
export function newCardFrameStyle<T extends FrameStyle>(frameStyle: T, cardType: string | null | undefined): T {
  const defaults = anatomyDefaults(frameStyle.template);
  let stamped = frameStyle;
  for (const key of FRAME_ANATOMY_KEYS) {
    if (stamped[key] === undefined && defaults[key] !== undefined) {
      if (stamped === frameStyle) stamped = { ...frameStyle };
      stamped[key] = defaults[key];
    }
  }
  return normalizeAnatomy(stamped, frameStyle.template, cardType);
}

/** The anatomy switches a stored frame_style names (booleans only) — what a
 *  remix keeps of its parent's (the creator's remixValuesFrom, and the AI
 *  deck remix of an own card): an explicit off stays off, and a switch the
 *  parent never set gets the new-card default. */
export function storedAnatomyOf(frameStyle: unknown): FrameAnatomyStyle {
  const stored = (frameStyle ?? {}) as Record<string, unknown>;
  const out: FrameAnatomyStyle = {};
  for (const key of FRAME_ANATOMY_KEYS) {
    const value = stored[key];
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Colour pairs
// ---------------------------------------------------------------------------

const WORD_LETTER: Partial<Record<ColorIdentity, string>> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};

const LETTER_WORD: Record<string, ColorIdentity> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

function pairOfLetters(letters: Iterable<string>): TwoColorPair | null {
  const distinct = [...new Set(letters)];
  if (distinct.length !== 2) return null;
  const sequence = canonicalColorSequence(distinct).toLowerCase();
  return (TWO_COLOR_PAIRS as readonly string[]).includes(sequence) ? (sequence as TwoColorPair) : null;
}

/** The card's colour PAIR: exactly two WUBRG words in its identity, in
 *  printed order (TWO_COLOR_PAIRS), or null. The "multicolor" (and
 *  "colorless") token is ignored; the cost is never read — an explicit mono
 *  or three-colour identity stays what it is whatever the cost says. */
export function twoColorPairOf(colors: readonly ColorIdentity[] | null | undefined): TwoColorPair | null {
  const letters: string[] = [];
  for (const color of colors ?? []) {
    const letter = WORD_LETTER[color];
    if (letter) letters.push(letter);
  }
  return pairOfLetters(letters);
}

/** A pair's identity words, first colour first (["white", "blue"]) — what
 *  the creator, the import and a confirmed edit store. */
export function pairColorIdentity(pair: TwoColorPair): [ColorIdentity, ColorIdentity] {
  return [LETTER_WORD[pair[0].toUpperCase()], LETTER_WORD[pair[1].toUpperCase()]];
}

/** Each coloured pip's colours, as WUBRG letters: {W} → [W], {W/U} and
 *  {W/U/P} → [W, U]; a twobrid {2/W} and a mono Phyrexian {W/P} are mono
 *  pips (they pay with one colour); generic, {X}, {C}, {S} and {C/P} are
 *  no coloured pip. */
function colouredPips(cost: string | null | undefined): string[][] {
  const pips: string[][] = [];
  for (const [, inner] of (cost ?? "").matchAll(/\{([^{}]+)\}/g)) {
    const letters = [
      ...new Set(
        inner
          .toUpperCase()
          .split("/")
          .map((part) => part.trim())
          .filter((part) => part in LETTER_WORD),
      ),
    ];
    if (letters.length > 0) pips.push(letters);
  }
  return pips;
}

/** The pair a cost's coloured pips span, or null when they span anything
 *  but exactly two colours — the "Two colours" row's pre-fill, never a
 *  render input. */
export function twoColorFromCost(cost: string | null | undefined): TwoColorPair | null {
  return pairOfLetters(colouredPips(cost).flat());
}

/**
 * Whether the two-colour frame is FOR this card — the creator shows its
 * switch (and a stored card's hint) only then (4.6 review 2026-09-29):
 *   • the card can wear it on its frame at all (twoColorFits: the template
 *     has pair masters, and a LAND only on a land frame — owner round 17,
 *     2026-09-30: never offered for a two-colour land drawn on m15);
 *   • and the identity holds a pair (twoColorPairOf; the "multicolor" token
 *     ignored);
 *   • or it is plain "multicolor" (no colour word) and the cost spans exactly
 *     two colours — the pair switching it on pre-fills;
 *   • or it is plain "multicolor" with no coloured pip (a land, a
 *     colour-indicator card): only the "Two colours" row can name its pair.
 * Never for an identity with one or three-plus colour words (an explicit
 * identity is never overridden by the cost), and never for a plain
 * "multicolor" card whose cost spans one or three-plus colours (turning it
 * on would offer a pair its cost contradicts).
 */
export function offersTwoColor(
  colors: readonly ColorIdentity[] | null | undefined,
  cost: string | null | undefined,
  frame: { template: FrameTemplate | string | null | undefined; cardType: string | null | undefined },
): boolean {
  if (!twoColorFitsTemplate(frame.template, frame.cardType)) return false;
  if (twoColorPairOf(colors) !== null) return true;
  const identity = colors ?? [];
  if (!identity.includes("multicolor") || identity.some((color) => WORD_LETTER[color] !== undefined)) return false;
  return twoColorFromCost(cost) !== null || colouredPips(cost).length === 0;
}

/**
 * The two-colour DRESS print uses for a card (design 2026-09-29, §1.2):
 *   • "hybrid" — every coloured pip is a two-colour hybrid ({G/W}{G/W},
 *     TLA #212), or a NONLAND card has no coloured pip at all (the
 *     colour-indicator cards, MH2 #186);
 *   • "split" — anything else: a two-colour cost (FDN #122), a mixed cost of
 *     hybrid and mono pips (STX #175, MKM #238), twobrid / mono-Phyrexian
 *     pips (mono pips), every land (the land frame's own split, MKM) and
 *     every token (no cost; the token design's own split, 4.48).
 */
export function twoColorDressOf(
  cost: string | null | undefined,
  cardType: string | null | undefined,
): TwoColorDress {
  // A land prints its land frame's split; a token has no cost at all and
  // prints the token design's own split (4.48), never the hybrid dress.
  if (cardType === "land" || cardType === "token") return "split";
  const pips = colouredPips(cost);
  if (pips.length === 0) return "hybrid";
  return pips.every((letters) => letters.length === 2) ? "hybrid" : "split";
}

/** The facts the anatomy of one card face depends on. */
export type AnatomyFacts = {
  colors: readonly ColorIdentity[] | null | undefined;
  cost?: string | null;
  cardType?: string | null;
  supertype?: string | null;
};

/** The two-colour look a card draws (TODO 4.6b). */
export type TwoColorLook = {
  pair: TwoColorPair;
  dress: TwoColorDress;
  /** The pair master painted instead of the gold "m" (TWO_COLOR_MASTER_KEYS). */
  masterKey: string;
};

/**
 * The two-colour look a card draws, or null for the gold frame (today's
 * look): the switch is on (FrameStyle.twoColor === true), the identity is a
 * stored pair, and the card can wear the profile's pair masters
 * (twoColorFits — a LAND only a land frame's). The dress is print's for the
 * cost (twoColorDressOf); a dress the template has no masters for falls back
 * to its gold-split masters (a hybrid artifact on m15artifact, which has no
 * hybrid plate yet), else to gold.
 */
export function resolveTwoColor(
  profile: AnatomyProfile,
  style: FrameAnatomyStyle | null | undefined,
  facts: AnatomyFacts,
): TwoColorLook | null {
  const dresses = profile.twoColorMasters;
  if (!dresses || !twoColorFits(profile, facts.cardType) || !anatomyOn(style, "twoColor")) return null;
  const pair = twoColorPairOf(facts.colors);
  if (!pair) return null;
  const wanted = twoColorDressOf(facts.cost, facts.cardType);
  const dress = dresses.includes(wanted) ? wanted : dresses.includes("split") ? "split" : null;
  if (!dress) return null;
  return { pair, dress, masterKey: dress === "hybrid" ? `${pair}-h` : pair };
}

/** The stat plate (`pt/{color}.png`) a card paints: its colour key, except
 *  the hybrid dress's grey plate ("c", m15PTC). A gold-split pair keeps the
 *  gold "m" plate its colour key already is. */
export function plateKeyFor(colorKey: string, look: TwoColorLook | null): string {
  return look?.dress === "hybrid" ? "c" : colorKey;
}

// ---------------------------------------------------------------------------
// The crown and the overlays
// ---------------------------------------------------------------------------

/** Card types that never print the standard crown: a planeswalker (0 of
 *  1,271 legendary walker printings on the 2015 frame), a token (the token
 *  crowns are 4.48 / 4.49), a battle, an emblem. */
const CROWNLESS_CARD_TYPES: ReadonlySet<string> = new Set(["planeswalker", "token", "battle", "emblem"]);

/** A card the crown prints on: the whole word Legendary in the supertype
 *  ("Lengendary" is not), and a card type that prints one. */
export function qualifiesForCrown(facts: Pick<AnatomyFacts, "cardType" | "supertype">): boolean {
  return supertypeHasWord(facts.supertype, "Legendary") && !CROWNLESS_CARD_TYPES.has(facts.cardType ?? "");
}

/** An overlay a render draws: `path` is the image (a frames-bucket or
 *  public/frames path), stretched over `rect`. */
export type ResolvedFrameOverlay = {
  anatomy: FrameOverlaySlot["anatomy"];
  rect: Rect;
  key: string;
  path: string;
};

/**
 * The overlays one card face draws over its frame master, in order — the ONE
 * rule the preview (FrameOverlayLayer), the bake, both finish masks and the
 * bake's preload (frameAssetPathsFor) share. A slot draws when its switch is
 * on and the card qualifies. Its key is the pinline of the master actually
 * drawn: the pair (both dresses share one crown band per pair) when the
 * two-colour look is drawn, else the card's colour key (`colorKey`,
 * pickFrameColorKey) — "m" for a pair drawn gold — remapped by the slot's
 * keyMap. A key the slot doesn't publish draws nothing: never a stand-in.
 */
export function resolveFrameOverlays(
  profile: AnatomyProfile,
  style: FrameAnatomyStyle | null | undefined,
  facts: AnatomyFacts & { colorKey: string },
): ResolvedFrameOverlay[] {
  const slots = profile.overlays;
  if (!slots || slots.length === 0) return [];
  const out: ResolvedFrameOverlay[] = [];
  for (const slot of slots) {
    if (!anatomyOn(style, slot.anatomy)) continue;
    if (slot.anatomy === "crown" && !qualifiesForCrown(facts)) continue;
    const look = resolveTwoColor(profile, style, facts);
    const base = look ? look.pair : facts.colorKey;
    const key = slot.keyMap?.[base] ?? base;
    if (!slot.keys.includes(key)) continue;
    out.push({ anatomy: slot.anatomy, rect: slot.rect, key, path: slot.assetPathTemplate.replace("{key}", key) });
  }
  return out;
}

/** The crown's switch is on and the card prints one (the ONE test the
 *  overlay band and a crowned master share). */
function crownOn(style: FrameAnatomyStyle | null | undefined, facts: Pick<AnatomyFacts, "cardType" | "supertype">): boolean {
  return anatomyOn(style, "crown") && qualifiesForCrown(facts);
}

/**
 * The master a card paints on a profile whose crown is baked into its
 * masters (FrameProfile.crownMasters, TODO 4.6f): `masterKey`'s crowned
 * twin (`w` → `w-legendary`, a pair → `wu-legendary`) when the crown's
 * switch is on and the card qualifies, else `masterKey` as given — the ONE
 * rule frameMasterKey applies for both renderers, the finish masks and the
 * bake's preload. A profile that draws its crown as an overlay band (or
 * none) paints `masterKey` unchanged.
 */
export function crownedMasterKey(
  profile: AnatomyProfile,
  style: FrameAnatomyStyle | null | undefined,
  facts: Pick<AnatomyFacts, "cardType" | "supertype">,
  masterKey: string,
): string {
  return profile.crownMasters === true && crownOn(style, facts) ? legendaryMasterKey(masterKey) : masterKey;
}

/**
 * The crown key one card face draws on `profile`, or null when it draws no
 * crown: the overlay band's key (resolveFrameOverlays — the pinline of the
 * master drawn, remapped by the slot), or, on a profile with crown masters,
 * the master's own key — the pair where the two-colour look is drawn, else
 * the colour key (`c` on either borderless dress: the artifact dress's `c`
 * twin wears CC's artifact crown, keyed by the master, not the crown
 * letter). The creator, the admin compare page and the tests read it
 * (lib/cards/crown.ts crownKeyFor).
 */
export function crownKeyOf(
  profile: AnatomyProfile,
  style: FrameAnatomyStyle | null | undefined,
  facts: AnatomyFacts & { colorKey: string },
): string | null {
  const overlay = resolveFrameOverlays(profile, style, facts).find((o) => o.anatomy === "crown");
  if (overlay) return overlay.key;
  if (profile.crownMasters !== true || !crownOn(style, facts)) return null;
  const look = resolveTwoColor(profile, style, facts);
  return look ? look.pair : facts.colorKey;
}

// ---------------------------------------------------------------------------
// An edit's switch flip (updateCardAction's `frame_anatomy`)
// ---------------------------------------------------------------------------

/** What an edit sends for the switches (lib/validation/card.ts
 *  frameAnatomyPatchSchema). */
export type FrameAnatomyPatch = {
  crown?: boolean;
  twoColor?: boolean;
  /** The colour pair a stored multicolour card is given when its owner
   *  switches the two-colour frame on — pre-filled from the cost in the
   *  editor, confirmed by the owner. */
  pair?: readonly [ColorIdentity, ColorIdentity];
};

export type AppliedFrameAnatomyPatch =
  | {
      ok: true;
      /** The frame style to store: the stored one with the switches merged
       *  in and normalizeAnatomy applied — every other key as stored. */
      frameStyle: Record<string, unknown>;
      /** The identity to store, or null to leave it alone. */
      colorIdentity: ColorIdentity[] | null;
    }
  | { ok: false; error: string };

/**
 * Merge an edit's switch flip over the STORED card (edits never send
 * frame_style: the template and finish are locked, and re-sending them would
 * rewrite a legacy template). A pair is stored only as a refinement of a
 * multicolour identity that names no other colour — "never re-colour a
 * stored card" (owner decision 2026-09-29): ["multicolor"] becomes
 * ["white", "blue"]; a card that already has a pair keeps it; a mono,
 * colourless or three-colour card is refused. A pair on a card whose frame
 * can't draw the two-colour look for it (the switch normalised away: a
 * frame with no pair masters, or a LAND on a nonland frame — a crafted
 * payload for Shadowwood Hollow on m15) is ignored.
 */
export function applyFrameAnatomyPatch(
  stored: {
    frameStyle: Record<string, unknown>;
    colorIdentity: readonly ColorIdentity[];
    /** The card's type as it will be saved (a land keeps the two-colour
     *  switch only on a land frame — twoColorFits). */
    cardType: string | null | undefined;
  },
  patch: FrameAnatomyPatch,
): AppliedFrameAnatomyPatch {
  const template = typeof stored.frameStyle.template === "string" ? stored.frameStyle.template : undefined;
  const merged: Record<string, unknown> = { ...stored.frameStyle };
  for (const key of FRAME_ANATOMY_KEYS) {
    if (patch[key] !== undefined) merged[key] = patch[key];
  }
  const frameStyle = normalizeAnatomy(merged as FrameAnatomyStyle, template, stored.cardType) as Record<
    string,
    unknown
  >;
  if (!patch.pair || frameStyle.twoColor !== true) return { ok: true, frameStyle, colorIdentity: null };

  const pair = twoColorPairOf(patch.pair);
  const storedPair = twoColorPairOf(stored.colorIdentity);
  if (!pair) return { ok: false, error: "Pick two different colours." };
  if (storedPair === pair) return { ok: true, frameStyle, colorIdentity: null };
  const multicolour =
    stored.colorIdentity.length > 1 || stored.colorIdentity[0] === "multicolor";
  const otherColour = stored.colorIdentity.some(
    (color) => WORD_LETTER[color] !== undefined && !pair.includes(WORD_LETTER[color]!.toLowerCase()),
  );
  if (storedPair || !multicolour || otherColour) {
    return { ok: false, error: "This card's colours are set — only a multicolour card takes a colour pair." };
  }
  return { ok: true, frameStyle, colorIdentity: pairColorIdentity(pair) };
}

// ---------------------------------------------------------------------------
// Imports (lib/scryfall/import-mapper.ts → the creator, the AI deck remix)
// ---------------------------------------------------------------------------

/** The printing facts an import patch carries for the anatomy
 *  (ScryfallImportPatch). */
export type ImportedAnatomyFacts = {
  color_identity?: readonly ColorIdentity[];
  color_pair?: TwoColorPair;
  /** `true` — the printing prints the standard crown; `false` — a
   *  Legendary card printed without it (M15–RIX, List reprints) or a
   *  Legendary showcase; absent — nothing to follow (a nonlegendary
   *  printing, a showcase one included). */
  printed_crown?: boolean;
  /** `true` for a two-colour printing, else absent — never `false`. */
  printed_two_color?: true;
};

/**
 * An imported card's anatomy on the frame it landed on (`landedTemplate`) —
 * "imports follow the printing" (owner rule 2026-09-29), PRINTING-ONLY
 * (owner round 17, 2026-09-30): a switch is named only where the printing
 * says something about it.
 *   • The crown: the printing's own value for a Legendary card — on with
 *     the `legendary` frame effect, `false` for an M15–RIX legendary or a
 *     List reprint (owner 2026-09-29: "OFF for M15–RIX legendaries") and
 *     for a Legendary showcase (Q6 → b, "match scan"); a nonlegendary
 *     printing names none, a showcase one included (owner 2026-09-30).
 *   • The two-colour frame: `true` for a two-colour printing, with its PAIR
 *     as the colour where the landed frame draws pairs; any other printing
 *     names none and keeps its own identity ("multicolor" for a two-colour
 *     card on a frame that prints gold, RTR #145).
 * A switch named nowhere gets the new-card default at the save
 * (newCardFrameStyle; the creator's form holds NEW_CARD_ANATOMY), so a card
 * later made Legendary, or given a pair, starts with the piece on like any
 * new card. The save drops a switch the frame can't draw.
 */
export function importedAnatomy(
  patch: ImportedAnatomyFacts,
  landedTemplate: FrameTemplate | string | null | undefined,
): { style: FrameAnatomyStyle; colorIdentity: ColorIdentity[] | undefined } {
  const style: FrameAnatomyStyle = {};
  if (patch.printed_crown !== undefined) style.crown = patch.printed_crown;
  const twoColourPrinting = patch.printed_two_color === true;
  if (twoColourPrinting) style.twoColor = true;
  const drawsPairs = frameAnatomyOf(landedTemplate).twoColor.length > 0;
  const colorIdentity =
    drawsPairs && twoColourPrinting && patch.color_pair
      ? pairColorIdentity(patch.color_pair)
      : patch.color_identity
        ? [...patch.color_identity]
        : undefined;
  return { style, colorIdentity };
}

/**
 * The switches a NEW card's creator form holds after an import: the
 * printing's (importedAnatomy's `style`), and NEW_CARD_ANATOMY for a switch
 * the printing names none for — whatever an earlier import or toggle left
 * there. Saved (newCardFrameStyle) it is exactly what the AI deck remix of
 * the same printing stores, which sends the printing's switches alone and
 * gets the default stamped (tests/unit/cards/anatomy-import-default.test.ts).
 */
export function importedFormAnatomy(style: FrameAnatomyStyle): Required<FrameAnatomyStyle> {
  return {
    crown: style.crown ?? NEW_CARD_ANATOMY.crown,
    twoColor: style.twoColor ?? NEW_CARD_ANATOMY.twoColor,
  };
}
