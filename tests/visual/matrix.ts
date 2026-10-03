import { createHash } from "node:crypto";
import type { CardRowForBake } from "@/lib/cards/bake-core";
import { artReachesCardEdge, getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_COLOR_KEYS, frameComboKey } from "@/lib/cards/frame-reference-registry";
import { BASIC_LAND_NAME_BY_KEY } from "@/lib/cards/watermark";
import { CARD_KIND_VALUES, KIND_DEFS, framesForKind, type CardKind } from "@/lib/creator/card-kinds";
import { FRAME_TEMPLATE_VALUES, type DfcIconFamily, type FrameTemplate } from "@/types/card";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { isDfcBackBody } from "@/lib/cards/dfc";

// ---------------------------------------------------------------------------
// The visual-regression matrix (TODO 7.1 / 3.11): a FIXED list of cards baked
// through the real renderer by tests/visual/bake.visual.ts and compared, as
// hashes, with tests/visual/baseline.json (scripts/visual-regression.mjs).
//
//   * EVERY frame template (FRAME_TEMPLATE_VALUES — published or not: a stored
//     card can sit on any of them) × 8 colours (the seven frame keys, gold as
//     a three-colour card, plus a two-colour card for the split frames) × two
//     content shapes of the template's first kind ("short" and "long");
//   * every OTHER kind a template hosts (the creator's framesForKind offer —
//     at most seven on a showcase: no walker, battle or layout kind) once, in
//     that kind's colour;
//   * the finishes (foil, etched) on a spread of frames; the HD preset (the
//     stored bake's size) for the long card on every template; square
//     corners (print) on a few; an "edge" card (100/100, a four-mode
//     Command, reversed-hybrid and unknown symbols — TODO 3.11) on one frame
//     of each family; a card with NO art on the frames whose art layers
//     differ from their empty-art box (the see-through masters, whose
//     under-frame art is drawn only under art, and layout v35's art slots —
//     the empty box is drawn in the slot);
//   * the kind anatomy a card TYPE prints on a body (TODO 4.5.0): a saga
//     creature ("@creature"), a Vehicle and a Spacecraft ("@vehicle",
//     "@spacecraft") — their P/T as it draws today;
//   * the per-card anatomy switched ON (TODO 4.6a "@crown…", 4.6b
//     "@pair…", 4.6f's borderless twins): the long (Legendary) card with
//     FrameStyle.crown on every template that draws the crown, in each crown
//     key, plus HD, foil and etched on m15 (HD, foil and square on
//     m15borderless); the two-colour pair (FrameStyle.twoColor) on every
//     template that draws pairs, in each dress, and with both switches on
//     (the split crown). The same cards without the switches are the plain
//     cases — every stored card;
//   * the collector line switched ON (TODO 4.9b "@collector…"): on every
//     template with the slot (COLLECTOR_TEMPLATES) the long card in the
//     2023 style ("M 0107" over "DMU • EN", the © slot's mark on line 2)
//     and the short card in the 2015 style ("107/281   C"); on m15 the
//     no-plate card (an instant: the mark on line 1), the ★ by the flag and
//     by a foil finish, a Spanish line ("DMU • SP"), empty fields (the bare
//     letter), a long artist (cut with one "…"), the HD bake and the
//     square print. The cards WITHOUT the switch are the plain cases.
//
// A new template, kind or colour joins the matrix by itself; its new cases
// fail the gate until the baseline is regenerated (no layout bump needed for
// NEW cases — only a changed hash needs one). Card ids are stable strings
// ("m15/r/creature-short@hd"): renaming a case is a baseline change. Each
// case also carries an INPUT fingerprint (its row, preset and corners, plus
// VISUAL_HARNESS): editing what a case draws redefines it — the baseline is
// regenerated, no layout bump — while the same input drawing different
// pixels is a renderer change.
//
// The content is synthetic and fixed here. Art is a generated gradient
// (bake.visual.tsx), never a real picture, and nothing here names an
// outside URL: the bake is hermetic apart from the frames bucket objects,
// which are fetched by manifest sha and never committed.
// ---------------------------------------------------------------------------

export type VisualColour = "w" | "u" | "b" | "r" | "g" | "c" | "wu" | "wub";
export type VisualShape = "short" | "long" | "edge";
export type VisualPreset = "default" | "hd";
/** Which face of the row a case bakes (TODO 5.1a): the front (every case
 *  before Phase 5), or the BACK of a double-faced card with a back body —
 *  lib/cards/faces.ts backPreviewData, as 5.3's bake will draw it. */
export type VisualFace = "front" | "back";

/**
 * The harness's own version: raise it when tests/visual/bake.visual.ts draws
 * differently for the same rows (its generated art, the render contract it
 * passes) — every case is then REDEFINED (regenerate the baseline, no layout
 * bump). Never raise it to get a renderer change past the gate.
 */
export const VISUAL_HARNESS = 1;

export type VisualCase = {
  /** Stable id — the baseline key. */
  id: string;
  /** 8-hex fingerprint of what the case draws (row, preset, corners,
   *  VISUAL_HARNESS) — a matrix edit, not a pixel change, when it moves. */
  input: string;
  /** Square corners are print (the PDF, the Square download): rendered live,
   *  never stored — a change there needs no layout bump (the gate). */
  printOnly: boolean;
  template: FrameTemplate;
  kind: CardKind;
  colour: VisualColour;
  shape: VisualShape;
  preset: VisualPreset;
  corners: "round" | "square";
  finish: "regular" | "foil" | "etched";
  /** The face baked (VisualFace); part of the input fingerprint. */
  face: VisualFace;
  /** The stored row this case bakes (lib/cards/bake-core.ts rowToPreviewData).
   *  `art_url` is the "ART" / "ART2" placeholder the harness swaps for its
   *  generated picture. */
  row: CardRowForBake;
};

/** Every colour variant, in id order. */
export const VISUAL_COLOURS: readonly VisualColour[] = ["w", "u", "b", "r", "g", "c", "wu", "wub"];

const IDENTITY: Record<VisualColour, string[]> = {
  w: ["white"],
  u: ["blue"],
  b: ["black"],
  r: ["red"],
  g: ["green"],
  c: ["colorless"],
  wu: ["white", "blue"],
  wub: ["white", "blue", "black"],
};

/** The frame colour key (frame_reviews.color_key) a variant is judged as:
 *  two and three colours both paint gold ("m") unless the profile splits. */
export function frameKeyOf(colour: VisualColour): (typeof FRAME_COLOR_KEYS)[number] {
  return colour === "wu" || colour === "wub" ? "m" : colour;
}

/** Mana symbols for a variant: `n` coloured pips (plus generic). */
function pips(colour: VisualColour, generic: number, n: number): string {
  const letters = colour === "c" ? ["C"] : colour.toUpperCase().split("");
  const coloured = Array.from({ length: Math.max(n, letters.length) }, (_, i) => `{${letters[i % letters.length]}}`);
  return `${generic > 0 ? `{${generic}}` : ""}${coloured.join("")}`;
}

/** The kind a colour-less "other kind" case is shown in. */
const KIND_COLOUR: Record<CardKind, VisualColour> = {
  creature: "g",
  instant: "u",
  sorcery: "b",
  artifact: "c",
  enchantment: "w",
  land: "g",
  planeswalker: "u",
  battle: "r",
  token: "w",
  // An emblem is colourless (CR 114); its frame hosts no other kind.
  emblem: "c",
  saga: "r",
  adventure: "g",
  split: "wu",
  aftermath: "b",
  flip: "r",
  // A transform card's front (TODO 5.1a): a blue Delver.
  transform: "u",
  // The modal kind (named by TODO 5.2) has no bodies until 5.1b: no
  // template hosts it, so no case is baked for it yet.
  mdfc: "u",
};

const LONG_RULES =
  "Flying, vigilance, lifelink\nWhenever this creature attacks, choose one —\n• Draw a card, then discard a card.\n• Create a 1/1 white Spirit creature token with flying.\n{2}{W/U}, {T}: Scry 2. (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)";
const LONG_FLAVOR = "\"The sky remembers every wing that crossed it.\"\n—Captain Sisay";

type Fields = Partial<CardRowForBake>;

/** The content of one kind in one shape — a stored row's text columns. */
function contentFor(kind: CardKind, shape: VisualShape, colour: VisualColour, template?: FrameTemplate): Fields {
  const long = shape === "long";
  const key = frameKeyOf(colour);
  switch (kind) {
    case "transform":
      return transformContent(shape, colour, template === "m15dfclandfront");
    case "land": {
      if (!long && key !== "m") {
        const name = BASIC_LAND_NAME_BY_KEY[key];
        return { title: name, card_type: "land", supertype: "Basic", subtypes: [name], cost: null, rules_text: null };
      }
      return {
        title: long ? "Sunken Citadel of the Drowned Archmage" : "Hallowed Fountain",
        card_type: "land",
        supertype: long ? "Legendary" : null,
        subtypes: long ? ["Urza's", "Tower"] : [],
        cost: null,
        rules_text: long
          ? "This land enters tapped.\n{T}: Add one mana of any color. Spend this mana only to cast instant or sorcery spells.\n{3}, {T}, Sacrifice this land: Draw two cards."
          : "({T}: Add {W} or {U}.)",
        flavor_text: long ? LONG_FLAVOR : null,
      };
    }
    case "token":
      return long
        ? {
            title: "Treasure",
            card_type: "token",
            supertype: "Artifact",
            subtypes: ["Treasure"],
            cost: null,
            rules_text: "{T}, Sacrifice this token: Add one mana of any color. Activate only as a sorcery.",
            flavor_text: "Gold gleams brightest in a thief's eye.",
          }
        : { title: "Beast", card_type: "token", supertype: "Creature", subtypes: ["Beast"], cost: null, power: "3", toughness: "3" };
    case "emblem":
      // TODO 4.52 / 6.23: the walker's name on the bar, "Emblem" (+ the
      // optional subtype on the long card), ONE rules line centred (short)
      // or several from the left (long); saved common, no cost or stats.
      return long
        ? {
            title: "Kaito, Cunning Infiltrator of the Hidden Blade",
            card_type: "emblem",
            supertype: null,
            subtypes: ["Kaito"],
            cost: null,
            rarity: "common",
            rules_text:
              "Whenever a player casts a spell, you create a 2/1 blue Ninja creature token.\nAt the beginning of your end step, if you attacked with three or more Ninjas this turn, draw a card, then scry 2.",
          }
        : {
            title: "Chandra",
            card_type: "emblem",
            supertype: null,
            subtypes: [],
            cost: null,
            rarity: "common",
            rules_text: "At the beginning of your upkeep, this emblem deals 1 damage to you.",
          };
    case "planeswalker":
      return {
        title: long ? "Jace, Architect of Thought and Memory" : "Chandra",
        card_type: "planeswalker",
        supertype: "Legendary",
        subtypes: [long ? "Jace" : "Chandra"],
        cost: pips(colour, 2, 2),
        loyalty: long ? "6" : "4",
        face_content: {
          v: 1,
          loyalty: {
            abilities: long
              ? [
                  { cost: "+1", text: "Draw a card." },
                  { cost: "-2", text: "Return target creature to its owner's hand." },
                  {
                    cost: "-8",
                    text: "You get an emblem with \"Whenever you cast a spell, copy it. You may choose new targets for the copy. Then draw a card for each card in your hand, and each opponent mills that many cards.\"",
                  },
                ]
              : [
                  { cost: "+1", text: "Add {R}{R}." },
                  { cost: "-3", text: "Chandra deals 4 damage to target creature." },
                ],
          },
        },
      };
    case "battle":
      return {
        title: long ? "Invasion of the Shattered Sky Citadel" : "Invasion of Ergamon",
        card_type: "battle",
        supertype: null,
        subtypes: ["Siege"],
        cost: pips(colour, 1, 1),
        defense: long ? "7" : "5",
        rules_text: long
          ? "(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exile it, then cast it transformed.)\nWhen this Siege enters, it deals 3 damage to each creature your opponents control."
          : "When this Siege enters, discard a card, then draw a card.",
      };
    case "saga":
      return {
        title: long ? "The Chronicle of the Endless Long Night" : "The Eldest Reborn",
        card_type: "enchantment",
        supertype: null,
        subtypes: ["Saga"],
        cost: pips(colour, 2, 1),
        face_content: {
          v: 1,
          saga: {
            intro: long ? "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)" : null,
            chapters: long
              ? [
                  { numerals: [1, 2], text: "Each opponent sacrifices a creature or planeswalker, then discards a card." },
                  { numerals: [3], text: "Put target creature or planeswalker card from a graveyard onto the battlefield under your control. It gains haste until end of turn." },
                ]
              : [
                  { numerals: [1], text: "Each opponent sacrifices a creature." },
                  { numerals: [2], text: "Each opponent discards a card." },
                  { numerals: [3], text: "Return a creature card from a graveyard." },
                ],
          },
        },
      };
    case "adventure":
    case "split":
    case "aftermath":
    case "flip": {
      const front = kind === "adventure" || kind === "flip" ? "creature" : kind === "split" ? "instant" : "sorcery";
      const back = kind === "adventure" ? "sorcery" : front;
      return {
        title: long ? "Bonecrusher Giant of the Northern Reaches" : kind === "split" ? "Fire" : "Bonecrusher Giant",
        card_type: front,
        supertype: null,
        subtypes: front === "creature" ? ["Giant"] : [],
        cost: pips(colour, 2, 1),
        rules_text: long ? "Whenever this becomes the target of a spell, it deals 2 damage to that spell's controller.\nTrample" : "Trample",
        power: front === "creature" ? "4" : null,
        toughness: front === "creature" ? "3" : null,
        back_face: {
          title: long ? "Stomp the Ground Beneath the Mountains" : kind === "split" ? "Ice" : "Stomp",
          cost: pips(colour, 1, 1),
          card_type: back,
          subtypes: kind === "adventure" ? ["Adventure"] : [],
          rules_text: long
            ? "Damage can't be prevented this turn. Stomp deals 2 damage to any target.\nAftermath (Cast this spell only from your graveyard. Then exile it.)"
            : "Stomp deals 2 damage to any target.",
          ...(kind === "flip" ? { power: "5", toughness: "4", card_type: "creature" as const, subtypes: ["Giant", "Warrior"] } : {}),
          ...(kind === "aftermath" || kind === "split" ? { art_url: "ART2" } : {}),
        },
      };
    }
    default: {
      // creature, instant, sorcery, artifact, enchantment
      const type = KIND_DEFS[kind].cardType;
      const creature = type === "creature";
      if (shape === "edge") {
        // TODO 3.11's edge content in one card: a 100/100 (3.18), a
        // four-mode Command (3.16), reversed-hybrid and unknown symbols (3.15).
        return {
          title: "Kolaghan's Command of the Hundred",
          card_type: type,
          supertype: null,
          subtypes: creature ? ["Dragon"] : [],
          cost: "{U/W}{2/W}{Z}{B/P}",
          rules_text:
            "Choose two —\n• Return target creature card from your graveyard to your hand.\n• Target player discards a card.\n• Destroy target artifact.\n• This deals 2 damage to any target.\n{W/U}, {Q}: Scry 1. {Z}",
          flavor_text: null,
          power: creature ? "100" : null,
          toughness: creature ? "100" : null,
        };
      }
      return {
        title: long ? "Sisay, Captain of the Endless Weatherlight Skies" : creature ? "Grizzly Bears" : "Shock",
        card_type: type,
        supertype: long ? "Legendary" : null,
        subtypes: creature ? (long ? ["Human", "Soldier", "Wizard", "Advisor"] : ["Bear"]) : [],
        cost: long ? `{X}${pips(colour, 3, 3)}` : pips(colour, 1, 1),
        rules_text: long ? LONG_RULES : creature ? "Vigilance" : "Deal 2 damage to any target.",
        flavor_text: long ? LONG_FLAVOR : null,
        power: creature ? (long ? "10" : "2") : null,
        toughness: creature ? (long ? "10" : "2") : null,
      };
    }
  }
}

/** A transform card's two faces (TODO 5.1a): the back has its own BODY —
 *  the ▼-right back the default family derives (lib/cards/dfc.ts bodyFor)
 *  — and the front's colour, so the front's grey tab prints the back's P/T
 *  and the icon rider its glyph. Short: a Delver (1/1 // 3/2 Flying);
 *  long: a Legendary front (no crown: the DFC bodies draw none) with the
 *  long rules // a dense back; the land front: Westvale Abbey // Ormendahl
 *  (INR #287, the tab prints 9/7). */
function transformContent(shape: VisualShape, colour: VisualColour, land: boolean): Fields {
  const long = shape === "long";
  // The back's own body and colour, its art (the harness's second picture)
  // and artist.
  const backStyle = {
    frame_style: { template: "m15dfcback" as FrameTemplate },
    color_identity: IDENTITY[colour],
    art_url: "ART2",
    artist_credit: "Visual Regression",
  };
  if (land) {
    return {
      title: long ? "Westvale Abbey of the Profane Congregation" : "Westvale Abbey",
      card_type: "land",
      supertype: long ? "Legendary" : null,
      subtypes: [],
      cost: null,
      rules_text:
        "{T}: Add {C}.\n{5}, {T}, Pay 1 life: Create a 1/1 white and black Human Cleric creature token.\n{5}, {T}, Sacrifice five creatures: Transform Westvale Abbey, then untap it.",
      flavor_text: long ? LONG_FLAVOR : null,
      back_face: {
        title: "Ormendahl, Profane Prince",
        cost: "",
        card_type: "creature",
        supertype: "Legendary",
        subtypes: ["Demon"],
        rules_text: "Flying, lifelink, indestructible, haste",
        power: "9",
        toughness: "7",
        ...backStyle,
      },
    };
  }
  return {
    title: long ? "Sisay, Captain of the Endless Weatherlight Skies" : "Delver of Secrets",
    card_type: "creature",
    supertype: long ? "Legendary" : null,
    subtypes: long ? ["Human", "Soldier", "Wizard", "Advisor"] : ["Human", "Wizard"],
    cost: long ? `{X}${pips(colour, 3, 3)}` : pips(colour, 0, 1),
    rules_text: long
      ? LONG_RULES
      : "At the beginning of your upkeep, look at the top card of your library. You may reveal it. If an instant or sorcery card is revealed this way, transform Delver of Secrets.",
    flavor_text: long ? LONG_FLAVOR : null,
    power: long ? "10" : "1",
    toughness: long ? "10" : "1",
    back_face: {
      title: long ? "Sisay, Herald of the Weatherlight's Final Voyage" : "Insectile Aberration",
      cost: "",
      card_type: "creature",
      supertype: long ? "Legendary" : null,
      subtypes: long ? ["Human", "Soldier", "Avatar"] : ["Human", "Insect"],
      rules_text: long ? DENSE_RULES : "Flying",
      flavor_text: long ? LONG_FLAVOR : null,
      power: long ? "12" : "3",
      toughness: long ? "12" : "2",
      ...backStyle,
    },
  };
}

/** A stored row for one case. */
function rowFor(
  template: FrameTemplate,
  kind: CardKind,
  colour: VisualColour,
  shape: VisualShape,
  finish: VisualCase["finish"],
  id: string,
  crown = false,
): CardRowForBake {
  const long = shape === "long";
  return {
    id,
    owner_id: "00000000-0000-4000-a000-00000000071a",
    title: "",
    cost: null,
    card_type: null,
    supertype: null,
    subtypes: [],
    rarity: long ? "mythic" : "common",
    color_identity: IDENTITY[colour],
    rules_text: null,
    flavor_text: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artist_credit: "Visual Regression",
    art_url: "ART",
    art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    // A switched-on crown (TODO 4.6a) only on its own cases: every other
    // case is a stored card, which names no switch.
    frame_style: crown ? { template, finish, crown: true } : { template, finish },
    // A Keyrune preset on the long card (the drawn set symbol); the short
    // card prints the default mark.
    set_icon_url: null,
    set_icon_code: long ? "dmu" : null,
    back_face: null,
    face_content: null,
    watermark: long && colour !== "wu" && colour !== "wub" ? { kind: "mana", key: frameKeyOf(colour) } : null,
    ...contentFor(kind, shape, colour, template),
  };
}

/** Every combo is "available" — the matrix covers unverified frames too. */
const EVERY_COMBO: ReadonlySet<string> = new Set(
  FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))),
);

/** The kinds each template hosts, in the creator's order (framesForKind). */
export function kindsByTemplate(): Map<FrameTemplate, CardKind[]> {
  const out = new Map<FrameTemplate, CardKind[]>();
  for (const kind of CARD_KIND_VALUES) {
    for (const choice of framesForKind(kind, EVERY_COMBO)) {
      const list = out.get(choice.template) ?? [];
      if (!list.includes(kind)) list.push(kind);
      out.set(choice.template, list);
    }
  }
  return out;
}

/** Frames the finish cases run on — every family the overlays mask
 *  differently (M15, walker rows, saga rail, token, Alpha, a showcase, the
 *  old border). Etched skips frames whose art reaches the card edge, as the
 *  creator does (lib/cards/art-framing.ts). */
const FINISH_TEMPLATES: readonly FrameTemplate[] = ["m15", "m15pw", "saga", "m15token", "agclassic", "lotr", "retro", "m15borderless"];
/** The edge card (3.11's content cases) on one frame of each family. */
const EDGE_TEMPLATES: readonly FrameTemplate[] = ["m15", "m15borderless", "agclassic", "retro", "lotr", "tarkirdragon"];
/** The legendary crown switched on (TODO 4.6a): the long card (Legendary) on
 *  every template that draws the crown, in every colour that picks a
 *  different band — m15: w u b r g, c (the see-through grey), wu and wub
 *  (gold: a pair with its two-colour switch off draws gold; the split
 *  crown is the "@pair-crown" cases); m15artifact: c (the silver), u;
 *  m15land: g, c (the land grey), wub (gold). */
const CROWN_CASES: readonly [FrameTemplate, readonly VisualColour[]][] = [
  ["m15", ["w", "u", "b", "r", "g", "c", "wu", "wub"]],
  ["m15artifact", ["c", "u"]],
  ["m15land", ["g", "c", "wub"]],
  // TODO 4.6f (wave 2a): the borderless FLOATING crown, baked into the
  // crowned twins (`<key>-legendary`, FrameProfile.crownMasters) — every
  // colour, the see-through colourless frame and gold; the artifact dress's
  // colourless twin wears CC's artifact crown.
  ["m15borderless", ["w", "u", "b", "r", "g", "c", "wu", "wub"]],
  ["m15borderlessartifact", ["c", "u", "wub"]],
  // TODO 4.6f (wave 2b): the extended-art frame's floating crown, an
  // overlay band (extendedcrown/<key>) on the MSE masters — every colour,
  // the grey colourless crown, gold (a pair wears gold: no pair masters).
  ["extendedart", ["w", "u", "b", "r", "g", "c", "wu", "wub"]],
];
/** Square corners (print): a black border, a ring, art to the edge, landscape. */
/** No art (`art_url` null): the empty-art box, and no under-frame layer on a
 *  see-through master — m15/c, devoid, the colourless tokens and walker
 *  (m15pw/c's window is its under-frame picture only under art), and the
 *  v35 art slots (CC M15, nyx, fullart). */
const NO_ART_CASES: readonly [FrameTemplate, VisualColour][] = [
  ["m15", "c"],
  ["m15", "w"],
  ["m15devoid", "b"],
  ["m15token", "c"],
  ["m15tokentext", "c"],
  ["m15pw", "c"],
  ["nyx", "w"],
  ["fullart", "g"],
  // The see-through flip/c (layout v38, TODO 4.21a): no under-frame layer
  // without art, the empty-art box in the window.
  ["flip", "c"],
];
/** The portrait layouts (TODO 4.21a, layout v38), pinned as they draw now
 *  — new cases, a regenerated baseline: a flip whose bottom half has NO P/T
 *  (its plate stays off — the top's is drawn), dense flip halves (both
 *  boxes down the ladder), an adventure with a LONG page (and a long right
 *  page), a long aftermath on both halves. */
const DENSE_RULES =
  "Flying, first strike, vigilance, trample, haste\nWhenever this creature attacks, each opponent sacrifices a creature. If they can't, they lose 3 life and you draw a card.\n{2}{R}, {T}: It deals 2 damage to any target. Activate only during your turn.";
const LAYOUT_CASES: readonly [FrameTemplate, CardKind, VisualColour, VisualShape, string, Partial<CardRowForBake>][] = [
  [
    "flip",
    "flip",
    "r",
    "short",
    "@nopt",
    {
      back_face: {
        title: "Tok-Tok's Essence",
        cost: "",
        card_type: "enchantment",
        subtypes: [],
        rules_text: "Red creatures you control get +1/+1 and have haste.",
      },
    },
  ],
  [
    "flip",
    "flip",
    "b",
    "long",
    "@dense",
    {
      rules_text: DENSE_RULES,
      back_face: {
        title: "Nighteyes the Desecrator of the Unending Night",
        cost: "",
        card_type: "creature",
        supertype: "Legendary",
        subtypes: ["Rat", "Wizard", "Horror"],
        power: "4",
        toughness: "2",
        rules_text: DENSE_RULES,
      },
    },
  ],
  [
    "adventure",
    "adventure",
    "g",
    "long",
    "@longpage",
    {
      rules_text: DENSE_RULES,
      back_face: {
        title: "Heart's Desire of the Wandering Court",
        cost: "{1}{G}{G}",
        card_type: "sorcery",
        subtypes: ["Adventure"],
        rules_text:
          "Create a 1/1 green Human creature token. Then you may search your library for a creature card, reveal it, put it into your hand, then shuffle. (Then exile this card. You may cast the creature later from exile.)",
      },
    },
  ],
  [
    "aftermath",
    "aftermath",
    "b",
    "long",
    "@dense",
    {
      rules_text: DENSE_RULES,
      back_face: {
        title: "Return of the Unending Night",
        cost: "{3}{B}",
        card_type: "sorcery",
        subtypes: [],
        rules_text:
          "Aftermath (Cast this spell only from your graveyard. Then exile it.)\nReturn target creature card from your graveyard to the battlefield. It gains haste until end of turn. Sacrifice it at the beginning of the next end step.",
        art_url: "ART2",
      },
    },
  ],
];
/** No ability text on a borderless walker (TODO 4.33, owner round 15): its
 *  see-through window shows the light first stripe, never the bare art. */
const NO_TEXT_CASES: readonly [FrameTemplate, VisualColour][] = [
  ["m15borderlesspw", "w"],
  ["m15borderlesspwtall", "wub"],
];
/** Kind anatomy a card TYPE prints on a body (TODO 4.5.0), pinned as it
 *  draws today — new cases (a regenerated baseline, no bump):
 *   • a saga creature: a FIN "Summon" ("Enchantment Creature — Saga
 *     Dragon") is stored as the saga kind's enchantment with "Creature" in
 *     its supertype (TODO 1.3 / 1.21; the words print in 1.20's order) and a
 *     P/T the saga body doesn't draw yet — 4.5c's correction changes this
 *     case under its bump, every other saga case keeps its hash;
 *   • a Vehicle on m15/c (the one visible production Vehicle's frame) and on
 *     m15artifact/c, and a Spacecraft on m15artifact/c: a P/T through the
 *     subtype on a non-creature. 4.5c's vehicle template is an addition, so
 *     these keep their hashes. */
const VEHICLE_ROW: Partial<CardRowForBake> = {
  title: "Skysail Runabout",
  card_type: "artifact",
  supertype: null,
  subtypes: ["Vehicle"],
  cost: "{2}",
  rules_text: "Flying\nCrew 1 (Tap any number of creatures you control with total power 1 or more: This Vehicle becomes an artifact creature until end of turn.)",
  power: "3",
  toughness: "3",
};
const KIND_ANATOMY_CASES: readonly [FrameTemplate, CardKind, VisualColour, string, Partial<CardRowForBake>][] = [
  [
    "saga",
    "saga",
    "w",
    "@creature",
    { title: "Summon: Leviathan", supertype: "Creature", subtypes: ["Saga", "Dragon"], power: "3", toughness: "3" },
  ],
  [
    "m15",
    "artifact",
    "c",
    "@vehicle",
    VEHICLE_ROW,
  ],
  [
    "m15artifact",
    "artifact",
    "c",
    "@vehicle",
    VEHICLE_ROW,
  ],
  [
    "m15artifact",
    "artifact",
    "c",
    "@spacecraft",
    {
      title: "Orbital Lance",
      card_type: "artifact",
      supertype: null,
      subtypes: ["Spacecraft"],
      cost: "{5}",
      rules_text:
        "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)\nFlying",
      power: "7",
      toughness: "7",
    },
  ],
];
const SQUARE_CASES: readonly [FrameTemplate, VisualColour][] = [
  ["m15", "w"],
  ["tarkirdragon", "u"],
  ["fullartland", "g"],
  ["m15borderless", "b"],
  ["battle", "r"],
];

function caseId(template: string, colour: string, kind: string, shape: string, suffix = ""): string {
  return `${template}/${colour}/${kind}-${shape}${suffix}`;
}

/** JSON with every object's keys sorted — a field's position in rowFor is
 *  not an input. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The input fingerprint of a case (VisualCase.input). The face joins it
 *  only when it is the back (TODO 5.1a), so every front case's fingerprint
 *  is what it was. */
export function caseInput(c: Pick<VisualCase, "row" | "preset" | "corners"> & { face?: VisualFace }): string {
  return createHash("sha256")
    .update(
      canonical({
        harness: VISUAL_HARNESS,
        row: c.row,
        preset: c.preset,
        corners: c.corners,
        ...(c.face === "back" ? { face: "back" } : {}),
      }),
    )
    .digest("hex")
    .slice(0, 8);
}

/** The whole matrix, sorted by id. */
export function visualCases(): VisualCase[] {
  const cases: VisualCase[] = [];
  const add = (
    template: FrameTemplate,
    kind: CardKind,
    colour: VisualColour,
    shape: VisualShape,
    extra: {
      preset?: VisualPreset;
      corners?: "round" | "square";
      finish?: VisualCase["finish"];
      suffix?: string;
      noArt?: boolean;
      noText?: boolean;
      crown?: boolean;
      /** Fields over the stored row (a switch on frame_style, a cost). */
      row?: Partial<CardRowForBake>;
      /** The back face of a double-faced row (TODO 5.1a): the case's
       *  `template` is the BACK body the row's back_face names; the row is
       *  built for the front template given here. */
      back?: { frontTemplate: FrameTemplate };
    } = {},
  ) => {
    const id = caseId(template, colour, kind, shape, extra.suffix);
    const finish = extra.finish ?? "regular";
    const preset = extra.preset ?? "default";
    const corners = extra.corners ?? "round";
    const face: VisualFace = extra.back ? "back" : "front";
    const row = {
      ...rowFor(extra.back?.frontTemplate ?? template, kind, colour, shape, finish, id, extra.crown ?? false),
      ...(extra.noArt ? { art_url: null } : {}),
      ...(extra.noText ? { rules_text: null, flavor_text: null, face_content: null } : {}),
      ...extra.row,
    };
    cases.push({
      id,
      input: caseInput({ row, preset, corners, face }),
      printOnly: corners === "square",
      template,
      kind,
      colour,
      shape,
      preset,
      corners,
      finish,
      face,
      row,
    });
  };
  const hosted = kindsByTemplate();
  for (const template of FRAME_TEMPLATE_VALUES) {
    // A double-faced BACK body (TODO 5.1a) is never a card's own template:
    // its cases are the back face of a transform row (DFC_BACK_CASES).
    if (isDfcBackBody(template)) continue;
    const kinds = hosted.get(template) ?? ["creature"];
    const [primary, ...others] = kinds;
    for (const colour of VISUAL_COLOURS) {
      add(template, primary, colour, "short");
      add(template, primary, colour, "long");
    }
    for (const kind of others) add(template, kind, KIND_COLOUR[kind], "short");
    // The stored bake's own size.
    add(template, primary, "g", "long", { preset: "hd", suffix: "@hd" });
  }
  for (const template of FINISH_TEMPLATES) {
    const primary = (hosted.get(template) ?? ["creature"])[0];
    add(template, primary, "r", "short", { finish: "foil", suffix: "@foil" });
    if (!artReachesCardEdge(getFrameProfile(template))) add(template, primary, "u", "long", { finish: "etched", suffix: "@etched" });
  }
  for (const template of EDGE_TEMPLATES) add(template, "creature", "b", "edge");
  for (const [template, colour] of NO_ART_CASES) {
    const primary = (hosted.get(template) ?? ["creature"])[0];
    add(template, primary, colour, "short", { suffix: "@noart", noArt: true });
  }
  for (const [template, colour] of NO_TEXT_CASES) {
    const primary = (hosted.get(template) ?? ["creature"])[0];
    add(template, primary, colour, "short", { suffix: "@notext", noText: true });
  }
  for (const [template, kind, colour, suffix, row] of KIND_ANATOMY_CASES) add(template, kind, colour, "short", { suffix, row });
  for (const [template, kind, colour, shape, suffix, row] of LAYOUT_CASES) add(template, kind, colour, shape, { suffix, row });
  for (const [template, colour] of SQUARE_CASES) {
    const primary = (hosted.get(template) ?? ["creature"])[0];
    add(template, primary, colour, "short", { corners: "square", suffix: "@square" });
  }
  for (const [template, colours] of CROWN_CASES) {
    const primary = (hosted.get(template) ?? ["creature"])[0];
    for (const colour of colours) add(template, primary, colour, "long", { crown: true, suffix: "@crown" });
  }
  // The crown at the stored bake's size, in the finishes, and squared (print).
  add("m15", "creature", "g", "long", { crown: true, preset: "hd", suffix: "@crown-hd" });
  add("m15", "creature", "r", "long", { crown: true, finish: "foil", suffix: "@crown-foil" });
  add("m15", "creature", "u", "long", { crown: true, finish: "etched", suffix: "@crown-etched" });
  add("m15", "creature", "w", "long", { crown: true, corners: "square", suffix: "@crown-square" });
  // The borderless crowned twin at HD, on foil (no etched: art to the edge)
  // and squared (print keeps the crown's peak on the art, 4.6f).
  add("m15borderless", "creature", "b", "long", { crown: true, preset: "hd", suffix: "@crown-hd" });
  add("m15borderless", "creature", "b", "long", { crown: true, finish: "foil", suffix: "@crown-foil" });
  add("m15borderless", "creature", "b", "long", { crown: true, corners: "square", suffix: "@crown-square" });
  // The extended-art band at the stored bake's size (4.6f, wave 2b).
  add("extendedart", "creature", "u", "long", { crown: true, preset: "hd", suffix: "@crown-hd" });
  // TODO 4.6b: the two-colour frame, opt-in per card (frame_style.twoColor —
  // no stored card has the switch, so these are NEW cases, no bump): the
  // gold-split pair on every template that draws one, the hybrid dress on
  // m15, a finish of each dress and the stored bake's HD size.
  const pairStyle = (template: FrameTemplate, finish: VisualCase["finish"] = "regular", crown = false) => ({
    frame_style: crown ? { template, finish, crown: true, twoColor: true } : { template, finish, twoColor: true },
  });
  for (const template of PAIR_TEMPLATES) {
    const primary = (hosted.get(template) ?? ["creature"])[0];
    add(template, primary, "wu", "short", { suffix: "@pair", row: pairStyle(template) });
    // A two-colour legend with both switches on: the split crown over its
    // pair master (4.6a + 4.6b, one release).
    add(template, primary, "wu", "long", { suffix: "@pair-crown", row: pairStyle(template, "regular", true) });
  }
  add("m15", "creature", "wu", "short", { suffix: "@pair-hybrid", row: { ...pairStyle("m15"), cost: "{W/U}{W/U}" } });
  // The borderless hybrid dress (grey bars, the split pinline) and its
  // crowned twin (4.6f).
  add("m15borderless", "creature", "wu", "short", { suffix: "@pair-hybrid", row: { ...pairStyle("m15borderless"), cost: "{W/U}{W/U}" } });
  add("m15borderless", "creature", "wu", "long", {
    suffix: "@pair-hybrid-crown",
    row: { ...pairStyle("m15borderless", "regular", true), cost: "{X}{W/U}{W/U}{W/U}" },
  });
  add("m15", "creature", "wu", "short", { suffix: "@pair-foil", finish: "foil", row: pairStyle("m15", "foil") });
  add("m15", "creature", "wu", "long", {
    suffix: "@pair-etched",
    finish: "etched",
    row: { ...pairStyle("m15", "etched"), cost: "{X}{W/U}{W/U}{W/U}" },
  });
  add("m15", "creature", "wu", "long", { suffix: "@pair-hd", preset: "hd", row: pairStyle("m15") });
  // The split crown on the hybrid dress, and at the stored bake's size.
  add("m15", "creature", "wu", "long", {
    suffix: "@pair-hybrid-crown",
    row: { ...pairStyle("m15", "regular", true), cost: "{X}{W/U}{W/U}{W/U}" },
  });
  add("m15", "creature", "wu", "long", { suffix: "@pair-crown-hd", preset: "hd", row: pairStyle("m15", "regular", true) });
  // TODO 4.9b: the collector line, opt-in per card (frame_style.collector —
  // no stored card has the key, so these are NEW cases, no bump): both
  // styles on every slotted template (the primary kind: a token on the
  // token frames, a walker on m15pw, an emblem on emblem), and on m15 the
  // line's other shapes.
  for (const template of COLLECTOR_TEMPLATES) {
    // A transform BACK body (TODO 5.1a) prints the card's one line on its
    // back face: its collector cases bake the back of a transform row.
    if (isDfcBackBody(template)) {
      const front: FrameTemplate = template === "m15dfclandback" ? "m15dfclandfront" : "m15dfcfront";
      const back = { frontTemplate: front };
      add(template, "transform", "g", "long", { suffix: "@collector", back, row: { ...dfcBodyRow(template, "g"), ...collectorRow(front, "2023", dfcBodyRow(template, "g")) } });
      add(template, "transform", "u", "short", { suffix: "@collector-2015", back, row: { ...dfcBodyRow(template, "u"), ...collectorRow(front, "2015", dfcBodyRow(template, "u")) } });
      continue;
    }
    const primary = (hosted.get(template) ?? ["creature"])[0];
    add(template, primary, "g", "long", { suffix: "@collector", row: collectorRow(template, "2023") });
    add(template, primary, "u", "short", { suffix: "@collector-2015", row: collectorRow(template, "2015") });
  }
  // No stat plate (an instant): the mark on line 1.
  add("m15", "instant", "u", "short", { suffix: "@collector-noplate", row: collectorRow("m15", "2023") });
  // The ★: by the flag, and by a foil or etched finish (owner 2026-10-02).
  add("m15", "creature", "r", "short", { suffix: "@collector-star", row: collectorRow("m15", "2015", { frame_style: { star: true } as CardRowForBake["frame_style"] }) });
  add("m15", "creature", "r", "short", { suffix: "@collector-foil", finish: "foil", row: collectorRow("m15", "2015", { frame_style: { finish: "foil" } as CardRowForBake["frame_style"] }) });
  add("m15", "creature", "r", "short", { suffix: "@collector-etched", finish: "etched", row: collectorRow("m15", "2015", { frame_style: { finish: "etched" } as CardRowForBake["frame_style"] }) });
  // A printed language code: es prints SP.
  add("m15", "creature", "b", "short", { suffix: "@collector-lang", row: collectorRow("m15", "2015", { lang: "es" }) });
  // Empty fields: the bare letter and "EN" (new cards print what's filled).
  add("m15", "creature", "w", "short", { suffix: "@collector-empty", row: collectorRow("m15", "2023", { set_code: null, collector_number: null }) });
  // A long artist: cut with one "…" before the © slot's mark.
  add("m15", "creature", "g", "long", {
    suffix: "@collector-artist",
    row: collectorRow("m15", "2023", { artist_credit: "Someone With An Extraordinarily Long Illustrator Name Indeed" }),
  });
  // The stored bake's size, and the squared print.
  add("m15", "creature", "g", "long", { suffix: "@collector-hd", preset: "hd", row: collectorRow("m15", "2023") });
  add("m15", "creature", "u", "short", { suffix: "@collector-2015-square", corners: "square", row: collectorRow("m15", "2015") });
  // TODO 5.1a: the transform bodies — NEW cases (new templates, no stored
  // card: no bump). The front bodies come out of the per-template loop
  // above (the transform kind's rows carry a back with a body, so the grey
  // tab prints the back's P/T and the rider its glyph; the long card is a
  // crownless Legendary). Here: every BACK body × colour, short and long,
  // baked as the back face (VisualCase.face) — the indicator on each
  // coloured back, the dark plates, the 2016–22 back's moon in its well —
  // the other families' glyphs on both faces, a back with no P/T (the empty
  // tab on the front, no plate on the back), the land pair's back, the
  // stored bake's size, a foil back, and a LEGACY-shaped back_face on m15
  // (no body) whose front bake must not move.
  for (const body of DFC_BACK_BODIES) {
    const front: FrameTemplate = body === "m15dfclandback" ? "m15dfclandfront" : "m15dfcfront";
    for (const colour of VISUAL_COLOURS) {
      add(body, "transform", colour, "short", { back: { frontTemplate: front }, row: dfcBodyRow(body, colour) });
      add(body, "transform", colour, "long", { back: { frontTemplate: front }, row: dfcBodyRow(body, colour) });
    }
    add(body, "transform", "g", "long", { preset: "hd", suffix: "@hd", back: { frontTemplate: front }, row: dfcBodyRow(body, "g") });
  }
  // The other families' glyphs: the front's (sun, full moon, compass, closed
  // fan) and the 2016–22 back's (moon is the colour loop's; Emrakul, land,
  // open fan here) — the icon rider keyed by the family and the face's role.
  for (const family of ["sunmoon", "moon", "compass", "fan"] as const) {
    add("m15dfcfront", "transform", "g", "short", { suffix: `@${family}`, row: dfcFamilyRow("m15dfcbackleft", "g", family) });
    if (family !== "sunmoon") {
      add("m15dfcbackleft", "transform", "g", "short", { suffix: `@${family}`, back: { frontTemplate: "m15dfcfront" }, row: dfcFamilyRow("m15dfcbackleft", "g", family) });
    }
  }
  // A back that prints no P/T (an aura, VOW #12): the front's tab EMPTY
  // (owner decision Q7), the back with no plate — its indicator still drawn.
  add("m15dfcfront", "transform", "w", "short", { suffix: "@emptytab", row: DFC_AURA_BACK });
  add("m15dfcback", "transform", "w", "short", { suffix: "@nopt", back: { frontTemplate: "m15dfcfront" }, row: DFC_AURA_BACK });
  // A gold back with a two-colour identity (MOM #43: the dot split
  // diagonally) and a three-colour one (wedges) — the colour loop's wu and
  // wub rows carry them; a colourless (artifact stand-in) back draws none.
  // The front at the stored bake's size, on foil and squared (print).
  add("m15dfcfront", "transform", "r", "short", { finish: "foil", suffix: "@foil", row: dfcBodyRow("m15dfcback", "r") });
  add("m15dfcback", "transform", "r", "short", { finish: "foil", suffix: "@foil", back: { frontTemplate: "m15dfcfront" }, row: dfcBodyRow("m15dfcback", "r") });
  add("m15dfcfront", "transform", "b", "short", { corners: "square", suffix: "@square" });
  // A legacy-shaped back_face on m15 (the 8 imported DFCs' shape: content,
  // no body): the FRONT bake is today's, byte for byte (its hash must not
  // move against the base this PR was cut from: the corpus proof).
  add("m15", "creature", "u", "short", {
    suffix: "@legacyback",
    row: {
      back_face: {
        title: "Insectile Aberration",
        cost: "",
        card_type: "creature",
        subtypes: ["Human", "Insect"],
        rules_text: "Flying",
        power: "3",
        toughness: "2",
      },
    },
  });
  cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return cases;
}

/** The transform BACK bodies (TODO 5.1a; FrameProfile.dfc role "back"). */
export const DFC_BACK_BODIES: readonly FrameTemplate[] = ["m15dfcback", "m15dfcbackleft", "m15dfclandback"];

/** The family whose default back is `body` (lib/cards/dfc.ts bodyFor). */
function dfcFamilyFor(body: FrameTemplate): DfcIconFamily {
  return body === "m15dfcbackleft" ? "sunmoon" : "arrows";
}

/** The row fields that put a transform row's back on `body` in `colour`:
 *  the family that derives it and the back's own body and colour (the
 *  content is transformContent's). */
function dfcBodyRow(body: FrameTemplate, colour: VisualColour): Partial<CardRowForBake> {
  return dfcFamilyRow(body, colour, dfcFamilyFor(body));
}

function dfcFamilyRow(body: FrameTemplate, colour: VisualColour, family: DfcIconFamily): Partial<CardRowForBake> {
  const land = body === "m15dfclandback";
  const front: FrameTemplate = land ? "m15dfclandfront" : "m15dfcfront";
  // The land BACK's cases are FIN #31's shape — a land // land (Cooking
  // Campsite: a mana ability, no P/T), so the land front's tab is empty
  // there; the land front's own loop cases keep INR #287's creature back.
  const back = land
    ? {
        title: "Cooking Campsite",
        cost: "",
        card_type: "land" as const,
        subtypes: [],
        rules_text: "{T}: Add {W}.\n{3}, {T}, Sacrifice an artifact: Put a +1/+1 counter on each creature you control. Activate only as a sorcery.",
        flavor_text: "\"Seeing how you enjoy fishing, you should learn how to prepare your catch.\"\n—Ignis Scientia",
        art_url: "ART2",
        artist_credit: "Visual Regression",
        frame_style: { template: body },
        color_identity: IDENTITY[colour],
      }
    : {
        ...(transformContent("short", colour, false).back_face as NonNullable<CardRowForBake["back_face"]>),
        frame_style: { template: body },
        color_identity: IDENTITY[colour],
      };
  // The default family (`arrows`) is never stored: a plain transform row
  // names no `dfcIcon` (lib/cards/faces.ts dfcIconOf reads it as arrows).
  return {
    frame_style: family === "arrows" ? { template: front, finish: "regular" } : { template: front, finish: "regular", dfcIcon: family },
    back_face: back,
  };
}

/** VOW #12's shape: an aura back (no P/T) on a white front. */
const DFC_AURA_BACK: Partial<CardRowForBake> = {
  title: "Dorothea's Retribution",
  card_type: "enchantment",
  supertype: null,
  subtypes: ["Aura"],
  cost: "{3}{W}",
  rules_text: "Enchant creature\nEnchanted creature has \"Whenever this creature attacks, create a 4/4 white Spirit creature token with flying that's tapped and attacking. Sacrifice that token at end of combat.\"",
  power: null,
  toughness: null,
  frame_style: { template: "m15dfcfront", finish: "regular" },
  back_face: {
    title: "Sinner's Judgment",
    cost: "",
    card_type: "enchantment",
    subtypes: ["Aura"],
    rules_text: "Enchant player\nAt the beginning of your upkeep, put a judgment counter on Sinner's Judgment. Then if there are three or more judgment counters on it, enchanted player loses the game.",
    art_url: "ART2",
    artist_credit: "Visual Regression",
    frame_style: { template: "m15dfcback" },
    color_identity: ["white"],
  },
};

/** The templates whose PROFILES entry declares two-colour pair masters
 *  (TODO 4.6b; tests/unit/render/visual-matrix.test.ts keeps it in step). */
export const PAIR_TEMPLATES: readonly FrameTemplate[] = ["m15", "m15artifact", "m15land", "m15borderless", "m15borderlessartifact"];

/** The collector line's fields on its cases (TODO 4.9b): a real printing's
 *  (DMU #107's), on top of a stored row — `frame_style.collector` names the
 *  style, nothing else on the row changes. */
function collectorRow(
  template: FrameTemplate,
  style: "2015" | "2023",
  over: Partial<CardRowForBake> = {},
): Partial<CardRowForBake> {
  const finish = (over.frame_style as { finish?: VisualCase["finish"] } | undefined)?.finish ?? "regular";
  return {
    set_code: "DMU",
    collector_number: "107/281",
    lang: "en",
    ...over,
    frame_style: { template, finish, collector: style, ...((over.frame_style as object | undefined) ?? {}) },
  };
}

/** A case's rough bake cost, for balancing shards: the HD bake rasterises
 *  four times the pixels and its masters at full size (~10× on the
 *  measured runs), a finish adds its overlay's masks. */
function bakeCost(c: VisualCase): number {
  return (c.preset === "hd" ? 10 : 1) * (c.finish === "regular" ? 1 : 2);
}

/** Shard `index` of `count`: the cases dealt out by cost (largest first, each
 *  to the least-loaded shard — deterministic), returned in id order. CI's
 *  slowest shard sets its wall time, so the HD cases must not cluster. */
export function shardCases(cases: readonly VisualCase[], index: number, count: number): VisualCase[] {
  const load = new Array<number>(count).fill(0);
  const owner = new Map<string, number>();
  const byCost = [...cases].sort((a, b) => bakeCost(b) - bakeCost(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const c of byCost) {
    let best = 0;
    for (let i = 1; i < count; i += 1) if (load[i] < load[best]) best = i;
    load[best] += bakeCost(c);
    owner.set(c.id, best);
  }
  return cases.filter((c) => owner.get(c.id) === index);
}
