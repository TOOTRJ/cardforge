// Pure frame selection for AI-generated cards. Shared by createCardGenerationJob
// (lib/ai/generation-jobs.ts), the AI options dialog (frameChoicesForType)
// and unit tests — no React, no Supabase.
//
// The AI options dialog lets the user pick a specific frame, ask for a
// random one, or leave it alone. Selection respects the same verification
// gate as the picker (lib/cards/frame-availability.ts): only PUBLISHED
// (template, color) combos are ever chosen, using the color key the
// generated card will actually render with.

import { ERA_TYPE_FRAME, type CardType, type ColorIdentity, type FrameTemplate } from "@/types/card";
import {
  artifactCreatureFrameFor,
  borrowedFrameFits,
  enchantmentFrameFits,
  enchantmentFrameFor,
  followsEnchantmentDress,
  isEnchantmentDress,
  subtypeFrameFits,
  subtypeFrameFor,
  subtypesSay,
  framesForKind,
  extendedArtDressFor,
  isSingleBasicLand,
  kindFromCard,
  templateIsBasicOnly,
  tokenFrameFits,
  tokenFrameFor,
  typeWordFrameFits,
  typeWordFrameFor,
  walkerRowCount,
  walkerRowsFrameFits,
  walkerRowsFrameFor,
  type FrameChoice,
  type TokenFrameFace,
} from "@/lib/creator/card-kinds";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import { printsPowerToughness, supertypeHasWord } from "@/lib/cards/card-display";
import { resolveSagaChapters } from "@/lib/cards/face-content";
import { defaultTokenFrameIn, tokenFrameText } from "@/lib/creator/token-frame-auto";
import { isM20TokenTemplate } from "@/lib/cards/token-height";
import { frameHidesRulesBoxText } from "@/lib/creator/frame-resolve";
import { isStationFrame } from "@/lib/cards/station-frame";
import { parseStationText } from "@/lib/cards/station";
import type { BasicLandFace } from "@/lib/cards/watermark";

export type FrameRequest = FrameTemplate | "random" | undefined;

/** Frames that can dress this card type at all (any color published). */
export function frameChoicesForType(
  cardType: CardType,
  verifiedKeys: ReadonlySet<string>,
): FrameChoice[] {
  return framesForKind(kindFromCard(cardType, undefined), verifiedKeys);
}

/**
 * Resolve the frame an AI-generated card should save with.
 *
 *   - specific template → kept when it dresses the type AND its color for
 *     this card is published (and, for a basic-only frame, the card is one
 *     basic land; for a frame a creature borrows, the card says its word —
 *     an Artifact Creature on the artifact frame, an Enchantment Creature on
 *     Nyx); otherwise falls back like "random".
 *   - "random" → a uniformly random published frame whose available colors
 *     include the generated card's color key.
 *   - undefined → null (caller keeps the creator's era default).
 *
 * Returns null when nothing qualifies — the caller falls back to the
 * default kind frame, exactly like a manual type pick would.
 */
export function resolveGeneratedFrame(input: {
  cardType: CardType;
  requested: FrameRequest;
  colorIdentity: ColorIdentity[];
  verifiedKeys: ReadonlySet<string>;
  /** The generated card's identity. A basic-only frame (the full-art basic
   *  land) is a candidate only when this is one basic land; without it,
   *  those frames are left out. Its rules and flavour text pick a token's
   *  text box (TODO 4.49 (b)) and a full-art token's height (4.48; its P/T,
   *  when printed, keeps the rules clear of the plate); without them, the
   *  textless frame. */
  face?: BasicLandFace & { flavorText?: string | null; power?: string | null; toughness?: string | null };
  /** Injectable RNG for tests. Defaults to Math.random. */
  random?: () => number;
  /** Where a SPECIFIC request can't dress the card: "random" (the default —
   *  the single-card job and the fill) degrades to a random published frame
   *  the card fits; "none" (the AI deck's cards, owner 2026-10-14) returns
   *  null — no template, the default frame — so no other border era or
   *  showcase lands in a deck. */
  fallback?: "random" | "none";
}): FrameTemplate | null {
  const { cardType, colorIdentity, verifiedKeys, face } = input;
  if (!input.requested) return null;
  // A land asked onto the extended-art frame means its land dress, as the
  // picker and the import put it there (TODO 4.7, owner Round 63).
  const requested: FrameTemplate | "random" =
    input.requested === "random" ? "random" : extendedArtDressFor(kindFromCard(cardType, undefined), input.requested);

  const colorKey = pickFrameColorKey(colorIdentity);
  const choices = frameChoicesForType(cardType, verifiedKeys);
  const basicLand = face !== undefined && isSingleBasicLand(face);
  // A frame never dresses a card as a type it isn't: the artifact frame a
  // creature borrows (TODO 1.7) is for an Artifact Creature only, the Nyx
  // showcase (owner decision A3) for an Enchantment Creature — asked for by
  // name or picked at random.
  // …and a token's type words pick between the plain and the artifact
  // token frame (TODO 3b.15): a Treasure never lands on the plain one, a
  // Soldier never on the artifact one; a request for either means the one
  // the words pick. Its text picks the text box the same way (TODO 4.49
  // (b), owner decision 5): rules or flavour text → the text-box arch, none
  // → the textless one, whichever of the two was asked for. That one is a
  // preference, not a gate: while the box isn't published in the card's
  // colour, the textless arch (whose scrim keeps the text) is what was asked
  // for, as in the creator.
  // …and on the full-art token design (TODO 4.48) the text picks the
  // height the same way — no text → no box, the regular box, the tall box —
  // whichever height was asked for.
  const kind = kindFromCard(cardType, undefined);
  const type = { cardType, supertype: face?.supertype, subtypes: face?.subtypes };
  const tokenFace: TokenFrameFace = {
    supertype: face?.supertype,
    rulesText: face?.rulesText,
    flavorText: face?.flavorText,
    printsPowerToughness: printsPowerToughness({
      cardType: cardType,
      supertype: face?.supertype,
      subtypes: face?.subtypes,
      power: face?.power,
      toughness: face?.toughness,
    }),
  };
  const rows = walkerRowCount({ rulesText: face?.rulesText });
  const typed = choices.filter(
    (choice) =>
      choice.availableColorKeys.includes(colorKey as never) &&
      (basicLand || !templateIsBasicOnly(choice.template)) &&
      borrowedFrameFits(kind, choice.template, type) &&
      typeWordFrameFits(kind, choice.template, face?.supertype) &&
      // A subtype dress (TODO 4.5c) is for its subtype only: the Vehicle
      // frame never dresses a Sol Ring — and a NEW Vehicle wears it rather
      // than the plain artifact frame wherever it is published in the
      // card's colour (subtypeFrameFor).
      subtypeFrameFits(choice.template, face?.subtypes) &&
      // …and the STATION frame (TODO 4.27a, PR 3) only for a card whose text
      // has a tier: the frame prints the power / toughness on a tier and
      // nowhere else, so a generated Spacecraft with no "N+ | text" line
      // would land with its P/T undrawn. Left out of the pool, it falls
      // back as every dress does — to the base (the Artifact / Land frame,
      // where the P/T has its corner), asked for by name or at random.
      stationFrameFits(choice.template, face?.rulesText) &&
      // An enchantment dress (TODO 4.7: the Nyx frame) is for a card whose
      // type words say Enchantment — and a NEW Enchantment Creature or
      // Enchantment Artifact wears it rather than its plain frame wherever
      // it is published in the card's colour (enchantmentFrameFor).
      enchantmentFrameFits(choice.template, type) &&
      // The borderless planeswalker's tall box is for four rows or more,
      // the regular one for fewer (4.33): a gate, like the type words.
      walkerRowsFrameFits(kind, choice.template, rows),
  );
  const boxed = typed.filter((choice) => tokenFrameFits(kind, choice.template, tokenFace));
  const has = (template: FrameTemplate) => typed.some((choice) => choice.template === template);
  // The base of a subtype dress the card wears (m15artifact for a Vehicle)
  // gives way to the dress where both are published.
  // …and so does the base of an enchantment dress (m15 for an enchantment,
  // plain or creature — owner decision 1, Round 56). An enchantment that
  // prints on a body of its own (a Class, a Case…) follows nothing: the Nyx
  // frame is its maker's pick, never a random one.
  const dressed = (boxed.length > 0 ? boxed : typed).filter((choice) => {
    const dress = subtypeFrameFor(choice.template, face?.subtypes);
    if (dress !== choice.template && has(dress)) return false;
    const nyx = enchantmentFrameFor(kind, choice.template, type);
    if (nyx !== choice.template && has(nyx)) return false;
    return !isEnchantmentDress(choice.template) || followsEnchantmentDress(type);
  });
  // …and a card with text never draws a frame that prints none (TODO 1.24,
  // frameHidesRulesBoxText — the full-art token's textless height) while
  // any other frame it fits is published: with no frame the text picks
  // (`boxed` empty), the arch's scrim keeps the text; the textless height
  // would hide it.
  const drawn = dressed.filter((choice) => !frameHidesRulesBoxText(choice.template, tokenFace));
  const pool = drawn.length > 0 ? drawn : dressed;

  if (requested !== "random") {
    // The subtype's answer first — only a dress in the pool: a Spacecraft
    // asked for on the Vehicle frame lands on the Artifact frame while the
    // station frame is unpublished, as it did before that frame existed; a
    // request for the Vehicle frame on a card that is no Vehicle means its
    // base. THEN the enchantment dress of that answer — again only where it
    // is in the pool: an unpublished Nyx frame must never cost the card the
    // frame the subtype rule named (an Enchantment Artifact asked onto the
    // Vehicle frame lands on the artifact frame, as it did before the Nyx
    // frame).
    const bySubtype = subtypeFrameFor(requested, face?.subtypes, has);
    // …the Nyx dress before the artifact frame an Artifact Creature borrows
    // (owner 2026-10-14): an Enchantment Artifact Creature prints on Nyx.
    const byNyx = enchantmentFrameFor(kind, bySubtype, type);
    const byWords = byNyx !== bySubtype && has(byNyx) ? byNyx : artifactCreatureFrameFor(kind, bySubtype, type);
    const vehicle = has(byWords) ? byWords : bySubtype;
    const wanted = has(vehicle) && vehicle !== requested
      ? vehicle
      : walkerRowsFrameFor(kind, tokenFrameFor(kind, requested, tokenFace), rows);
    const asked = walkerRowsFrameFor(kind, typeWordFrameFor(kind, requested, face?.supertype), rows);
    // The height asked for stands in only on the arch, whose textless frame
    // keeps the text on its scrim: a full-art height the text doesn't fit
    // would hide it (the textless height) or leave an empty box — the pool
    // below picks a published frame the text fits.
    const match =
      typed.find((choice) => choice.template === wanted) ??
      (isM20TokenTemplate(asked) ? undefined : typed.find((choice) => choice.template === asked));
    // A frame that prints no text (a `textless` profile — the textless promo
    // pair since layout v58) is asked for by name only while the designed
    // card has no rules or flavour text to hide (TODO 1.24): with some, the
    // pool below — which keeps such a frame out while any other is
    // published — picks, as it does for a random request.
    if (match && !frameHidesRulesBoxText(match.template, tokenFace)) return match.template;
    // Requested frame can't dress this card (wrong type after generation, or
    // that color isn't published) — degrade to a random valid one, or to
    // none where the caller asked for that.
    if (input.fallback === "none") return null;
  }

  if (pool.length === 0) return null;
  const rng = input.random ?? Math.random;
  return pool[Math.floor(rng() * pool.length) % pool.length].template;
}

/** What an AI DECK card asks resolveGeneratedFrame for (owner 2026-10-14):
 *  the M15 standard of its card type — m15land for a land, m15artifact for
 *  an artifact, m15pw for a walker, m15token for a token — which the
 *  resolver then dresses exactly as it dresses a single generated card (a
 *  Vehicle's or a Spacecraft's subtype frame, the Nyx dress, a token's text
 *  box and height, a walker's rows, an Artifact Creature's artifact frame,
 *  never a textless frame for a text) wherever that frame is published in
 *  the card's colour. Where it is not, the deck asks for NO template
 *  (`fallback: "none"` — owner 2026-10-14: no other border era or showcase
 *  mixed into a deck): the default frame, as every deck card saved before. */
export function deckCardFrameRequest(cardType: CardType): FrameRequest {
  return ERA_TYPE_FRAME.m15?.[cardType];
}

/**
 * The frame an AI DECK card saves with: resolveGeneratedFrame asked for the
 * card type's M15 standard (deckCardFrameRequest, `fallback: "none"`), and
 * three looks a NEW deck card follows where they are VERIFIED in its colour
 * (owner 2026-10-14, the #568 follow-up) — decks only; the single-card job
 * asks for the frame its maker named, or a random one:
 *
 *   - a SAGA (an enchantment whose subtypes say Saga and whose text has at
 *     least one chapter line, read as the renderers read it) → the `saga`
 *     frame. A text with no chapter would leave its rail empty: it keeps the
 *     standard's landing.
 *   - a SNOW card (a Snow word in its type line) → `m15snow`, or
 *     `m15snowland` for a land — only where the standard's landing is the
 *     plain frame the snow skin re-dresses (m15, m15land, and the artifact
 *     frame an Artifact Creature borrows, as the import lands a snow
 *     printing); a subtype or enchantment dress keeps its frame, and an
 *     artifact or a token, whose kind the snow frame doesn't dress, its own.
 *   - a TOKEN → the frame a new token starts on in the creator
 *     (defaultTokenFrameIn): the full-art design at the height its text asks
 *     for where that is verified in the card's colour, else the 2014–19 arch
 *     its words and text pick, as before.
 *
 * Where a look isn't verified, the standard's landing — as #568 saved it.
 */
export function resolveDeckCardFrame(
  input: Omit<Parameters<typeof resolveGeneratedFrame>[0], "requested" | "fallback" | "random">,
): FrameTemplate | null {
  const { cardType, colorIdentity, verifiedKeys, face } = input;
  const colorKey = pickFrameColorKey(colorIdentity);
  const resolve = (requested: FrameRequest) =>
    resolveGeneratedFrame({ ...input, requested, fallback: "none" });

  if (
    cardType === "enchantment" &&
    subtypesSay(face?.subtypes, "Saga") &&
    resolveSagaChapters(null, face?.rulesText).chapters.length > 0 &&
    framesForKind("saga", verifiedKeys).some(
      (choice) => choice.template === "saga" && choice.availableColorKeys.includes(colorKey as never),
    )
  ) {
    return "saga";
  }

  if (cardType === "token") {
    const start = defaultTokenFrameIn(
      tokenFrameText({
        cardType,
        supertype: face?.supertype,
        subtypes: face?.subtypes,
        rulesText: face?.rulesText,
        flavorText: face?.flavorText,
        power: face?.power,
        toughness: face?.toughness,
      }),
      "m15token",
      colorKey,
      verifiedKeys,
    );
    return resolve(start ?? deckCardFrameRequest(cardType));
  }

  const landed = resolve(deckCardFrameRequest(cardType));
  if (supertypeHasWord(face?.supertype, "Snow")) {
    const snow: FrameTemplate | null =
      landed === "m15land"
        ? "m15snowland"
        : landed === "m15" || (landed === "m15artifact" && cardType === "creature")
          ? "m15snow"
          : null;
    if (snow && resolve(snow) === snow) return snow;
  }
  return landed;
}

/** True when a GENERATED card may land on `template` as far as the station
 *  frame goes: any other frame, or a station frame for a text with at least
 *  one tier (lib/cards/station.ts — the grammar both renderers draw). The
 *  creator has no such gate: a maker on the frame sees the tier editor and
 *  the "add a tier" note; a job saves with nobody looking. */
export function stationFrameFits(template: FrameTemplate, rulesText: string | null | undefined): boolean {
  return !isStationFrame(template) || parseStationText(rulesText).tiers.length > 0;
}

/** Color words a specific frame can render, for steering generation toward
 *  a color the frame actually has published art for. */
export function colorHintsForFrame(
  cardType: CardType,
  template: FrameTemplate,
  verifiedKeys: ReadonlySet<string>,
): ColorIdentity[] {
  const choice = frameChoicesForType(cardType, verifiedKeys).find(
    (c) => c.template === template,
  );
  if (!choice) return [];
  const byKey: Record<string, ColorIdentity> = {
    w: "white",
    u: "blue",
    b: "black",
    r: "red",
    g: "green",
    c: "colorless",
    m: "multicolor",
  };
  return choice.availableColorKeys
    .map((key) => byKey[key])
    .filter((word): word is ColorIdentity => Boolean(word));
}
