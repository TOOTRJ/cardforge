import { createHash } from "node:crypto";
import type { CardRowForBake } from "@/lib/cards/bake-core";
import { artReachesCardEdge, getFrameProfile } from "@/lib/cards/template-layout";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { FRAME_COLOR_KEYS, frameComboKey } from "@/lib/cards/frame-reference-registry";
import { BASIC_LAND_NAME_BY_KEY } from "@/lib/cards/watermark";
import { CARD_KIND_VALUES, KIND_DEFS, framesForKind, subtypeDressOf, type CardKind } from "@/lib/creator/card-kinds";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity, type DfcIconFamily, type FrameTemplate } from "@/types/card";
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
//   * the saga's printed rail (TODO 4.21c "@stack3", "@prodshape", "@six",
//     "@stack5", "@stack5-tight", "@stack6", "@combined", "@longintro",
//     "@grownintro", "@dense", "@pastfloor", "@introonly", "@legacy8"): every
//     row rule of lib/cards/saga-rail.ts on a real bake — badge stacks at the
//     roomy and at a tighter pitch, a saga with no reminder, six rows, the
//     combined marker, a reminder that steps down inside its box and one
//     that outgrows it, the ladder's lower steps and a rail past its floor;
//   * the kind anatomy a card TYPE prints on a body (TODO 4.5.0): a saga
//     creature ("@creature"), a Vehicle and a Spacecraft ("@vehicle",
//     "@spacecraft") — their P/T as it draws today;
//   * the per-card anatomy switched ON (TODO 4.6a "@crown…", 4.6b
//     "@pair…", 4.6f's borderless twins): the long (Legendary) card with
//     FrameStyle.crown on every template that draws the crown, in each crown
//     key, plus HD, foil and etched on m15 (HD, foil and square on
//     m15borderless); the two-colour pair (FrameStyle.twoColor) on every
//     template that draws pairs, in each dress, and with both switches on
//     (the split crown) where it draws a crown too — the borderless land's
//     pairs (TODO 4.56) draw none: its W|U card, the HD bake, a pair with
//     black, the foil and the squared print. The same cards without the
//     switches are the plain cases — every stored card;
//   * the collector line switched ON (TODO 4.9b "@collector…"): on every
//     template with the slot (COLLECTOR_TEMPLATES) the long card in the
//     2023 style ("M 0107" over "DMU • EN", the © slot's mark on line 2)
//     and the short card in the 2015 style ("107/281   C"); on m15 the
//     no-plate card (an instant: the mark on line 1), the ★ by the flag and
//     by a foil finish, a Spanish line ("DMU • SP"), empty fields (the bare
//     letter), a long artist (cut with one "…"), the HD bake and the
//     square print. The cards WITHOUT the switch are the plain cases;
//   * the holofoil stamp switched ON (TODO 4.9c "@stamp…"): on every
//     template with the notch (STAMP_TEMPLATES) a rare on "auto" (the oval
//     and the notch), and on m15 a colourless (the see-through grey) and a
//     gold rare, "Always" on a common, a full-box rare whose last line
//     enters the arch (the keep-out steps it down), the HD bake, foil and
//     etched (the notch in the sheen, the oval outside it), the squared
//     print, a token with the key (nothing drawn), and — the 4.9c
//     follow-up — the pair's notch on a rare drawn as its pair master on
//     every template with pairs and the notch ("@stamp-pair-split"), the
//     hybrid dress, a crowned pair, the HD size and a foil pair. The cards
//     WITHOUT the switch are the plain cases.
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
  // A Prepare card (TODO 4.27): SOS #109's red.
  prepare: "r",
  split: "wu",
  aftermath: "b",
  flip: "r",
  // A transform card's front (TODO 5.1a): a blue Delver.
  transform: "u",
  // A modal card's front (TODO 5.1b): a blue instant // land (MH3 #241's
  // shape).
  mdfc: "u",
};

const LONG_RULES =
  "Flying, vigilance, lifelink\nWhenever this creature attacks, choose one —\n• Draw a card, then discard a card.\n• Create a 1/1 white Spirit creature token with flying.\n{2}{W/U}, {T}: Scry 2. (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)";
const LONG_FLAVOR = "\"The sky remembers every wing that crossed it.\"\n—Captain Sisay";

type Fields = Partial<CardRowForBake>;

/** The content of one kind in one shape — a stored row's text columns. */
/** The station frame's cards (TODO 4.27a): the Station reminder as printed,
 *  for a Spacecraft (which becomes a creature at a tier) or a Planet. */
const stationReminder = (word: "Spacecraft" | "Planet", creatureAt: number | null) =>
  `Station (Tap another creature you control: Put charge counters equal to its power on this ${word}. Station only as a sorcery.${creatureAt ? ` It's an artifact creature at ${creatureAt}+.` : ""})`;

function contentFor(kind: CardKind, shape: VisualShape, colour: VisualColour, template?: FrameTemplate): Fields {
  const long = shape === "long";
  const key = frameKeyOf(colour);
  // A subtype dress's cards ARE its subtype (TODO 4.27a): every case on the
  // station frame is a Spacecraft (two tiers, the P/T on the last) or a
  // Planet (one tier, never a P/T) — EOE #25 / #253 short, a fuller box long.
  const dress = template !== undefined ? subtypeDressOf(template) : null;
  if (dress === "Spacecraft") {
    return {
      title: long ? "Sisay, Captain of the Endless Weatherlight Skies" : "Lumen-Class Frigate",
      card_type: "artifact",
      supertype: long ? "Legendary" : null,
      subtypes: ["Spacecraft"],
      cost: long ? `{X}${pips(colour, 3, 3)}` : pips(colour, 1, 1),
      rules_text: long
        ? `When this Spacecraft enters, surveil 2.\n${stationReminder("Spacecraft", 8)}\n3+ | You may play an additional land on each of your turns.\n8+ | Flying\nWhenever this Spacecraft attacks, draw a card, then discard a card.`
        : `${stationReminder("Spacecraft", 12)}\n2+ | Other creatures you control get +1/+1.\n12+ | Flying, lifelink`,
      flavor_text: null,
      power: long ? "10" : "3",
      toughness: long ? "10" : "5",
    };
  }
  if (dress === "Planet") {
    return {
      title: long ? "Sunken Citadel of the Drowned Archmage" : "Evendo, Waking Haven",
      card_type: "land",
      supertype: long ? "Legendary" : null,
      subtypes: ["Planet"],
      cost: null,
      rules_text: long
        ? `This land enters tapped.\n{T}: Add one mana of any color.\n${stationReminder("Planet", null)}\n12+ | {1}{R}, {T}, Sacrifice a land: Create a 2/2 colorless Robot artifact creature token, then creatures you control get +1/+0 and gain haste until end of turn.`
        : `This land enters tapped.\n{T}: Add {G}.\n${stationReminder("Planet", null)}\n12+ | {G}, {T}: Add {G} for each creature you control.`,
      flavor_text: null,
    };
  }
  switch (kind) {
    case "transform":
      // (The borderless front's back is the borderless back, TODO 5.7.)
      return transformContent(shape, colour, template === "m15dfclandfront", template === "m15borderlessdfcfront" ? "m15borderlessdfcback" : "m15dfcback");
    case "mdfc":
      return modalContent(shape, colour, template === "m15mdfclandfront", template === "m15borderlessmdfcfront" ? "m15borderlessmdfcback" : "m15mdfcback");
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
        // The double-faced saga front (TODO 5.5 (b)) has a back of its own:
        // the ▼ back the default family derives (TLA #117's shape; NEO's
        // fans are the "@fan" cases), so its tab prints the back's P/T.
        ...(template === "sagadfcfront" ? { back_face: sagaBackFace(shape, colour, "m15dfcback") } : {}),
      };
    case "prepare":
      // The Prepare card (TODO 4.27): SOS #109 Blazing Firesinger // Seething
      // Song short; long, a Legendary creature (the crown cases draw its
      // crown) with a full left box and a three-line spell.
      return {
        title: long ? "Abigale, Poet Laureate of the Silverquill Halls" : "Blazing Firesinger",
        card_type: "creature",
        supertype: long ? "Legendary" : null,
        subtypes: long ? ["Bird", "Bard"] : ["Dwarf", "Bard"],
        cost: pips(colour, 2, 1),
        rules_text: long
          ? "Flying\nWhenever you cast a creature spell, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)"
          : "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
        power: "2",
        toughness: "3",
        back_face: {
          title: long ? "Heroic Stanza of the Seven Libraries" : "Seething Song",
          cost: pips(colour, 1, 1),
          card_type: long ? "sorcery" : "instant",
          subtypes: [],
          rules_text: long
            ? "Put a +1/+1 counter on target creature. It gains flying until end of turn. Draw a card."
            : "Add {R}{R}{R}{R}{R}.",
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
      // A subtype dress's cards ARE its subtype (TODO 4.5c: every case on
      // the Vehicle frame is a Vehicle, with the P/T its plate carries).
      const vehicle = template !== undefined && subtypeDressOf(template) === "Vehicle";
      const creature = type === "creature" || vehicle;
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
        title: long ? "Sisay, Captain of the Endless Weatherlight Skies" : vehicle ? "Skysail Runabout" : creature ? "Grizzly Bears" : "Shock",
        card_type: type,
        supertype: long ? "Legendary" : null,
        subtypes: vehicle ? ["Vehicle"] : creature ? (long ? ["Human", "Soldier", "Wizard", "Advisor"] : ["Bear"]) : [],
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
function transformContent(shape: VisualShape, colour: VisualColour, land: boolean, backBody: FrameTemplate = "m15dfcback"): Fields {
  const long = shape === "long";
  // The back's own body and colour, its art (the harness's second picture)
  // and artist.
  const backStyle = {
    frame_style: { template: backBody },
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

/** A modal double-faced card's content (TODO 5.1b): a spell front // land
 *  back (MH3 #241 Sink into Stupor // Soporific Springs's shape — the
 *  front's strip prints "Land · {T}: Add {U}.", the back's "Instant · {2}{U}")
 *  in the case's colour; the land front (a pathway, ZNR #260 Clearwater //
 *  Murkwater's shape: both strips a land's mana line). The long card: a
 *  creature // creature with a cost on the back (MSH #18's shape without
 *  the Marvel strip form) — the dark plate and the long strip texts. */
function modalContent(shape: VisualShape, colour: VisualColour, land: boolean, backBody: FrameTemplate = "m15mdfcback"): Fields {
  const long = shape === "long";
  const pip = pips(colour, 0, 1);
  const backStyle = {
    frame_style: { template: backBody },
    color_identity: IDENTITY[colour],
    art_url: "ART2",
    artist_credit: "Visual Regression",
  };
  if (land) {
    return {
      title: long ? "Clearwater Pathway of the Drowned Archmage" : "Clearwater Pathway",
      card_type: "land",
      supertype: long ? "Legendary" : null,
      subtypes: [],
      cost: null,
      rules_text: `{T}: Add ${pip}.`,
      flavor_text: long ? LONG_FLAVOR : null,
      back_face: {
        title: long ? "Murkwater Pathway of the Sunken Archive" : "Murkwater Pathway",
        cost: "",
        card_type: "land",
        subtypes: [],
        rules_text: `{T}: Add ${pip}.`,
        flavor_text: long ? LONG_FLAVOR : null,
        ...backStyle,
        frame_style: { template: "m15mdfclandback" as FrameTemplate },
      },
    };
  }
  if (long) {
    return {
      title: "Jennifer Walters, Counsel of the Avengers' Mansion",
      card_type: "creature",
      supertype: "Legendary",
      subtypes: ["Human", "Advisor", "Hero"],
      cost: `{X}${pips(colour, 3, 3)}`,
      rules_text: LONG_RULES,
      flavor_text: LONG_FLAVOR,
      power: "10",
      toughness: "10",
      back_face: {
        title: "The Sensational She-Hulk, Avenger of the Courtroom",
        cost: `{3}${pips(colour, 2, 2)}`,
        card_type: "creature",
        supertype: "Legendary",
        subtypes: ["Gamma", "Hero"],
        rules_text: DENSE_RULES,
        flavor_text: LONG_FLAVOR,
        power: "12",
        toughness: "12",
        ...backStyle,
      },
    };
  }
  return {
    title: "Sink into Stupor",
    card_type: "instant",
    supertype: null,
    subtypes: [],
    cost: `{1}${pips(colour, 0, 2)}`,
    rules_text: "Return target spell or nonland permanent to its owner's hand.",
    flavor_text: null,
    power: null,
    toughness: null,
    back_face: {
      title: "Soporific Springs",
      cost: "",
      card_type: "land",
      subtypes: [],
      rules_text: `As Soporific Springs enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add ${pip}.`,
      ...backStyle,
      frame_style: { template: "m15mdfclandback" as FrameTemplate },
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
// …and the station frame (TODO 4.27a): the sheen over its see-through box
// and its drawn pieces.
// …and its two Spacecraft dresses (TODO 4.27a step 2): the sheen over the
// extended-art one's see-through box and the borderless one's floating bars.
const FINISH_TEMPLATES: readonly FrameTemplate[] = ["m15", "m15pw", "saga", "m15token", "agclassic", "lotr", "retro", "m15borderless", "m15nyx", "m15station", "extendedartstation", "m15borderlessstation"];
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
  // TODO 4.5c: the Vehicle frame's crown — the artifact silver on a
  // colourless Vehicle (DMU #230), its colour on a coloured one (KHM #169),
  // gold on three colours.
  ["m15vehicle", ["c", "g", "wub"]],
  // TODO 4.7: the Nyx dress's crown — the m15 crown with the starfield
  // strip inside it (m15nyxcrown), in every colour that picks a different
  // band: w u b r g, c (the silver: the frame maps c → a), wu and wub (gold).
  ["m15nyx", ["w", "u", "b", "r", "g", "c", "wu", "wub"]],
  // The Nyx Constellation frame's crown (owner 2026-10-13; THB #258–268):
  // the Nyx crown band with its arms faded into the MSE masters' rim
  // (nyxcrown), in every colour that picks a different band — w u b r g, c
  // (the silver: the frame maps c → a) and wu (gold: no pair masters here).
  ["nyx", ["w", "u", "b", "r", "g", "c", "wu"]],
  // TODO 4.11 (wave 1): the Zendikar Rising hedron showcase's crown — Card
  // Conjurer's ZNR crown band (fullartcrown), in every colour that picks a
  // different band: w u b r g, c (the see-through frame's grey), wu (the
  // pair's split crown over the gold master: no pair masters here, #313
  // Phylath) and wub (gold, #312 Omnath).
  ["fullart", ["w", "u", "b", "r", "g", "c", "wu", "wub"]],
  // TODO 4.27a: the station frame's crown — the parents' (artifact silver /
  // land grey on a colourless card, the colour's, gold).
  ["m15station", ["c", "g", "wub"]],
  ["m15stationland", ["c", "g"]],
  // TODO 4.27a step 2: its dresses' crowns — the extended-art band (the grey
  // C on a colourless card, as extendedart; the colour's; gold), the
  // borderless artifact dress's crowned twins.
  ["extendedartstation", ["c", "w", "wub"]],
  ["m15borderlessstation", ["c", "g", "wub"]],
  // TODO 4.25: the Universes Beyond crown band — a colour, the artifact
  // silver (a colourless card on the spell frame too), a pair, gold and
  // the land grey.
  ["m15ub", ["w", "c", "wu", "wub"]],
  // TODO 4.11: the Lord of the Rings scroll's crown — colours, gold and the
  // land's brown (a colourless creature keys `l`; the artifact's light blue
  // is "@crown-artifact" below).
  ["lotrscroll", ["w", "u", "b", "r", "g", "c", "wub"]],
  // …and the ring's (TODO 4.11, layout v65): the scalloped title bar over
  // the pack's frame field, colours, gold and the land's brown.
  ["lotr", ["w", "u", "b", "r", "g", "c", "wub"]],
  // …and the MUL Tarkir dragon wings' (TODO 4.11, layout v67): the spikes in
  // each colour, the artifact's on a colourless card, gold, and a pair's
  // split crown over the split wings (MUL #60 Taigam, W/U).
  ["tarkirdragon", ["w", "u", "b", "r", "g", "c", "wu", "wub"]],
  // The Bloomburrow woodland's leaf crown (TODO 4.11, layout v69).
  ["bloomburrow", ["g", "u", "wu"]],
  // …and the Bloomburrow anime's flourish (TODO 4.11 / 4.35, layout v70):
  // one master, so one colour and a pair.
  ["bloomanime", ["g", "wu"]],
  ["m15ubartifact", ["c", "u"]],
  ["m15ubland", ["g", "c"]],
  ["m15land", ["g", "c", "wub"]],
  // TODO 4.6f (wave 2a): the borderless FLOATING crown, baked into the
  // crowned twins (`<key>-legendary`, FrameProfile.crownMasters) — every
  // colour, the see-through colourless frame and gold; the artifact dress's
  // colourless twin wears CC's artifact crown.
  ["m15borderless", ["w", "u", "b", "r", "g", "c", "wu", "wub"]],
  ["m15borderlessartifact", ["c", "u", "wub"]],
  // TODO 4.6f (wave 2b): the extended-art frame's floating crown, an
  // overlay band (extendedcrown/<key>) on Card Conjurer's extended masters —
  // every colour, the grey colourless crown, gold (a pair with its
  // two-colour switch off wears gold; the split crown is "@pair-crown").
  ["extendedart", ["w", "u", "b", "r", "g", "c", "wu", "wub"]],
  // Its land dress (TODO 4.7, owner Round 63): the same band over the land
  // frames — a colour's (NEO #503 Otawara), the grey C crown over the grey
  // land frame, gold.
  ["extendedartland", ["u", "c", "wub"]],
  // TODO 4.6f (wave 2c): the STANDARD band over the snow frames — the
  // crowned snow prints' keys (u: J22 #12, g: PH19 #5, the gold pair wears
  // gold with its two-colour switch off: KHM #224) and the keys no print
  // has (c: the artifact silver over the snow artifact frame, wub); the
  // snow land's green and its colourless land grey (DMR #244).
  ["m15snow", ["u", "g", "c", "wu", "wub"]],
  ["m15snowland", ["g", "c"]],
  // TODO 4.35 follow-up (owner Round 63): the legendary textless promos'
  // STANDARD band over the promo masters — a colour, the colourless spell's
  // artifact silver (c → a), a pair (its split crown over the gold rim:
  // pairCrownOnGold) and gold; the land's colour and its land grey (c → l).
  ["m15textless", ["u", "c", "wu", "wub"]],
  ["m15textlessland", ["g", "c"]],
  // TODO 4.27: the Prepare frame's crown — M15's band over its M15 title
  // bar: a colour (SOS #170's gold is a pair, 4.6f), the artifact silver on
  // a colourless card (c → a), gold.
  ["prepare", ["r", "c", "wub"]],
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
  // The see-through battle/c (layout v43, TODO 4.21b): the same — the
  // empty-art box under its translucent pill, type bar and text box.
  ["battle", "c"],
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
  // The landscape layouts (TODO 4.21b, layout v43) — new cases:
  //   • split: a long name at the fit's floor on BOTH halves beside a heavy
  //     cost, dense rules down the ladder in both text boxes;
  //   • battle: a long name beside a heavy cost, a three-digit defense
  //     shrunk into the painted shield, dense rules wrapping round it;
  //   • battle/c: the see-through frame with rules text to the box's bottom
  //     (the art under the frame, one picture);
  //   • a battle with NO defense: the shield is the master's, still there,
  //     and the rules still keep out of it.
  [
    "split",
    "split",
    "r",
    "long",
    "@dense",
    {
      title: "Incongruous Reconsideration of Everything",
      cost: "{4}{R}{R}{R}",
      rules_text: DENSE_RULES,
      back_face: {
        title: "Interminable Deliberation of the Undecided",
        cost: "{X}{2}{R}{R}{R}",
        card_type: "sorcery",
        subtypes: [],
        rules_text: DENSE_RULES,
        art_url: "ART2",
      },
    },
  ],
  [
    "battle",
    "battle",
    "u",
    "long",
    "@dense",
    {
      title: "Invasion of the Innumerable Drowned Archipelagos",
      cost: "{4}{U}{U}{U}",
      defense: "100",
      rules_text:
        "(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exile it, then cast it transformed.)\n" +
        DENSE_RULES,
    },
  ],
  [
    "battle",
    "battle",
    "c",
    "long",
    "@dense",
    {
      rules_text:
        "(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exile it, then cast it transformed.)\n" +
        DENSE_RULES,
    },
  ],
  [
    "battle",
    "battle",
    "g",
    "short",
    "@nodefense",
    {
      defense: null,
      rules_text:
        "When this Siege enters, search your library and/or graveyard for a creature card with mana value 3 or less and put it onto the battlefield. If you search your library this way, shuffle. Then each player draws a card.",
    },
  ],
];
/** The saga's printed rail (TODO 4.21c), every row rule of
 *  lib/cards/saga-rail.ts pinned on a real bake — new cases beside the
 *  plain ones (short: no reminder, three single chapters; long: a reminder
 *  and a two-badge stack):
 *   • "@stack3": a reminder, a three-badge stack and a single (LTC #58's
 *     shape) — at 750 and at HD;
 *   • "@prodshape": NO reminder, I / II,III,IV / V / VI — the shape of a
 *     stored production saga, at the stored bake's size;
 *   • "@six": six single chapters with no reminder (the rows start at the
 *     rail's own top), at 750 and at HD;
 *   • "@stack5": a single chapter over a five-badge stack (WHO #99's
 *     shape) — the rows have no room for the roomy pitch, so the stack
 *     steps tighter (150 px); "@stack5-tight": one more line in chapter I —
 *     the stack at its tightest (138 px) and the text one step down;
 *   • "@stack6": six numerals stacked in ONE row under a reminder (LTR
 *     #174's shape) — the stack sets the row's height;
 *   • "@combined": repeated numerals whose stacks can never fit — every
 *     multi-badge row draws ONE badge with the combined label;
 *   • "@longintro": a read-ahead reminder, longer than its box holds at
 *     62 px — it steps down inside the box and never pushes the rows;
 *   • "@grownintro": a 300-character reminder, more than its box holds at
 *     the ladder's floor — set at the floor in the chapters' column, as
 *     tall as its text, the rows (a two-badge stack and a single) under it;
 *   • "@dense": four chapters (one a two-badge stack) under a reminder —
 *     the text at the ladder's lower steps, the stack tight;
 *   • "@pastfloor": six long chapters under a reminder, more than the rail
 *     holds at the ladder's floor — the floor's rows scaled alike into the
 *     rail, each row's text set from its top (the tail is what clips);
 *   • "@introonly": a saga typed with no chapter markers (legacy rules
 *     text): all reminder, the whole rail;
 *   • "@legacy8": legacy markers past VI ("I–VII", "VIII"): the labels
 *     fitted to the badge. */
const SAGA_REMINDER = "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)";
const SAGA_RAIL_CASES: readonly [VisualColour, VisualShape, string, Partial<CardRowForBake>, VisualPreset?][] = [
  [
    "u",
    "long",
    "@stack3",
    {
      face_content: {
        v: 1,
        saga: {
          intro: SAGA_REMINDER.replace("III", "IV"),
          chapters: [
            { numerals: [1, 2, 3], text: "Draw a card, then discard a card. If you discarded a land card this way, create a 2/2 blue Drake creature token with flying." },
            { numerals: [4], text: "Return up to two target creatures to their owners' hands." },
          ],
        },
      },
    },
  ],
  [
    "u",
    "long",
    "@stack3-hd",
    {
      face_content: {
        v: 1,
        saga: {
          intro: SAGA_REMINDER.replace("III", "IV"),
          chapters: [
            { numerals: [1, 2, 3], text: "Draw a card, then discard a card. If you discarded a land card this way, create a 2/2 blue Drake creature token with flying." },
            { numerals: [4], text: "Return up to two target creatures to their owners' hands." },
          ],
        },
      },
    },
    "hd",
  ],
  [
    "u",
    "short",
    "@prodshape",
    {
      face_content: {
        v: 1,
        saga: {
          intro: null,
          chapters: [
            { numerals: [1], text: "Scry 2." },
            { numerals: [2, 3, 4], text: "Tap target creature an opponent controls. It doesn't untap during its controller's next untap step." },
            { numerals: [5], text: "Draw two cards." },
            { numerals: [6], text: "Take an extra turn after this one." },
          ],
        },
      },
    },
    "hd",
  ],
  [
    "g",
    "short",
    "@six",
    {
      face_content: {
        v: 1,
        saga: {
          intro: null,
          chapters: [
            { numerals: [1], text: "Create a 1/1 green Saproling creature token." },
            { numerals: [2], text: "Put a +1/+1 counter on each creature you control." },
            { numerals: [3], text: "Add {G}{G}." },
            { numerals: [4], text: "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle." },
            { numerals: [5], text: "You gain 3 life." },
            { numerals: [6], text: "Creatures you control get +2/+2 and gain trample until end of turn." },
          ],
        },
      },
    },
  ],
  [
    "g",
    "short",
    "@six-hd",
    {
      face_content: {
        v: 1,
        saga: {
          intro: null,
          chapters: [
            { numerals: [1], text: "Create a 1/1 green Saproling creature token." },
            { numerals: [2], text: "Put a +1/+1 counter on each creature you control." },
            { numerals: [3], text: "Add {G}{G}." },
            { numerals: [4], text: "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle." },
            { numerals: [5], text: "You gain 3 life." },
            { numerals: [6], text: "Creatures you control get +2/+2 and gain trample until end of turn." },
          ],
        },
      },
    },
    "hd",
  ],
  [
    "g",
    "long",
    "@stack5",
    {
      face_content: {
        v: 1,
        saga: {
          intro: SAGA_REMINDER.replace("III", "VI"),
          chapters: [
            { numerals: [1], text: "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle." },
            { numerals: [2, 3, 4, 5, 6], text: "Create a token that's a copy of target nonlegendary token you control." },
          ],
        },
      },
    },
  ],
  [
    "g",
    "long",
    "@stack5-tight",
    {
      face_content: {
        v: 1,
        saga: {
          intro: SAGA_REMINDER.replace("III", "VI"),
          chapters: [
            { numerals: [1], text: "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. You gain 2 life." },
            { numerals: [2, 3, 4, 5, 6], text: "Create a token that's a copy of target nonlegendary token you control." },
          ],
        },
      },
    },
  ],
  [
    "r",
    "short",
    "@stack6",
    {
      face_content: {
        v: 1,
        saga: {
          intro: SAGA_REMINDER.replace("III", "VI"),
          chapters: [{ numerals: [1, 2, 3, 4, 5, 6], text: "Note a creature type that hasn't been noted for this Saga. When you next cast a creature spell of that type this turn, that creature enters with an additional +1/+1 counter on it." }],
        },
      },
    },
  ],
  [
    "w",
    "short",
    "@combined",
    {
      face_content: {
        v: 1,
        saga: {
          intro: null,
          chapters: [
            { numerals: [1, 2, 3, 4, 5, 6], text: "Create a 1/1 white Soldier creature token." },
            { numerals: [1, 3, 5], text: "You gain 1 life." },
            { numerals: [2, 4, 6], text: "Scry 1." },
            { numerals: [6], text: "Soldiers you control get +1/+1 until end of turn." },
          ],
        },
      },
    },
  ],
  [
    "b",
    "long",
    "@longintro",
    {
      face_content: {
        v: 1,
        saga: {
          intro:
            "Read ahead (Choose a chapter and start with that many lore counters. Add one after your draw step. Skipped chapters don't trigger. Sacrifice after III.)",
          chapters: [
            { numerals: [1], text: "You may sacrifice a creature. If you do, each opponent discards a card." },
            { numerals: [2], text: "Return target creature card from your graveyard to your hand." },
            { numerals: [3], text: "Target opponent may sacrifice a nonland, nontoken permanent. If they don't, they lose 2 life and you draw a card." },
          ],
        },
      },
    },
  ],
  [
    "r",
    "long",
    "@grownintro",
    {
      face_content: {
        v: 1,
        saga: {
          intro:
            "(As this Saga enters and after your draw step, add a lore counter. Whenever you cast your second spell each turn, put another lore counter on this Saga. If it would leave the battlefield, exile it with three time counters on it instead. Skipped chapters don't trigger. Sacrifice after III.)",
          chapters: [
            { numerals: [1, 2], text: "This Saga deals 2 damage to any target." },
            { numerals: [3], text: "Creatures you control get +2/+0 and gain haste until end of turn." },
          ],
        },
      },
    },
  ],
  [
    "wub",
    "long",
    "@dense",
    {
      face_content: {
        v: 1,
        saga: {
          intro: SAGA_REMINDER.replace("III", "V"),
          chapters: [
            { numerals: [1], text: "Each player sacrifices a creature. Then each player who controls no creatures draws a card." },
            { numerals: [2], text: "Exile target card from a graveyard. If it was a creature card, create a 2/2 black Zombie creature token." },
            { numerals: [3, 4], text: "Counter target spell unless its controller pays {3}." },
            { numerals: [5], text: "Return up to one target artifact, creature or enchantment card from your graveyard to the battlefield tapped." },
          ],
        },
      },
    },
  ],
  [
    "wub",
    "long",
    "@pastfloor",
    {
      face_content: {
        v: 1,
        saga: {
          intro: SAGA_REMINDER.replace("III", "VI"),
          chapters: [
            { numerals: [1], text: "Each player sacrifices a creature. Then each player who controls no creatures draws a card and loses 1 life." },
            { numerals: [2], text: "Exile target card from a graveyard. If it was a creature card, create a 2/2 black Zombie creature token." },
            { numerals: [3], text: "Counter target spell unless its controller pays {3}. If that spell is countered this way, exile it instead of putting it into its owner's graveyard." },
            { numerals: [4], text: "Return up to one target artifact, creature or enchantment card from your graveyard to the battlefield tapped." },
            { numerals: [5], text: "Each opponent discards two cards, then you draw a card for each card discarded this way." },
            { numerals: [6], text: "Destroy all creatures. For each creature destroyed this way, its controller creates a 1/1 white Spirit creature token with flying." },
          ],
        },
      },
    },
  ],
  [
    "c",
    "short",
    "@introonly",
    {
      face_content: null,
      rules_text: "This Saga's first chapter has no marker yet.\nAs it enters, draw a card. Then add a lore counter, as a saga does after each draw step.",
    },
  ],
  [
    "b",
    "short",
    "@legacy8",
    {
      face_content: null,
      rules_text: `${SAGA_REMINDER}\nI, II, III, IV, V, VI, VII — Scry 1.\nVIII — Each opponent loses 8 life.`,
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
 *     its supertype (TODO 1.3 / 1.21; since layout v50 the words print in
 *     their printed order, "Enchantment Creature", TODO 1.20) and a
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
  // TODO 4.27a: the station frame's box in the shapes its two base cards
  // (two tiers, the plate on the last) don't hold — one tier; three, as
  // structured rows with the plate on the MIDDLE one (face_content, read
  // before the text); no tier at all (a top band alone, no plate); the
  // plate's digits at their widest and oddest. (The parents' crown, stamp
  // and collector line have their own cases on these templates, below.)
  ["m15station", "artifact", "u", "@tiers-one", { rules_text: `${stationReminder("Spacecraft", 8)}\n8+ | Flying`, power: "4", toughness: "4" }],
  [
    "m15station",
    "artifact",
    "r",
    "@tiers-three",
    {
      rules_text: `${stationReminder("Spacecraft", 8)}\n2+ | Haste\n8+ | Flying, first strike\n14+ | Other creatures you control get +2/+0.`,
      face_content: {
        station: {
          intro: stationReminder("Spacecraft", 8),
          tiers: [
            { threshold: 2, text: "Haste" },
            { threshold: 8, text: "Flying, first strike", pt: true },
            { threshold: 14, text: "Other creatures you control get +2/+0." },
          ],
        },
      },
      power: "5",
      toughness: "4",
    },
  ],
  ["m15station", "artifact", "c", "@tiers-none", { rules_text: "Flying\nWhenever this Spacecraft attacks, draw a card.", power: "3", toughness: "3" }],
  ["m15station", "artifact", "g", "@tiers-wide", { power: "20", toughness: "20" }],
  ["m15station", "artifact", "b", "@tiers-star", { power: "*", toughness: "7" }],
  // TODO 4.27a step 2: the dresses' box in the same shapes — one tier, the
  // three-tier rows with the plate on the middle one, none.
  ["extendedartstation", "artifact", "u", "@tiers-one", { rules_text: `Station\n8+ | Flying`, power: "4", toughness: "4" }],
  [
    "m15borderlessstation",
    "artifact",
    "r",
    "@tiers-three",
    {
      rules_text: `${stationReminder("Spacecraft", 8)}\n2+ | Haste\n8+ | Flying, first strike\n14+ | Other creatures you control get +2/+0.`,
      face_content: {
        station: {
          intro: stationReminder("Spacecraft", 8),
          tiers: [
            { threshold: 2, text: "Haste" },
            { threshold: 8, text: "Flying, first strike", pt: true },
            { threshold: 14, text: "Other creatures you control get +2/+0." },
          ],
        },
      },
      power: "5",
      toughness: "4",
    },
  ],
  ["extendedartstation", "artifact", "c", "@tiers-none", { rules_text: "Flying\nWhenever this Spacecraft attacks, draw a card.", power: "3", toughness: "3" }],
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
  // TODO 4.5c: the Vehicle plate's white digits at their widest and
  // oddest — two digits a side (the stat fit) and a star.
  ["m15vehicle", "artifact", "c", "@wide", { power: "12", toughness: "12" }],
  ["m15vehicle", "artifact", "r", "@star", { power: "*", toughness: "5" }],
  // TODO 4.7: the Nyx dress as the cards that wear it — an Enchantment
  // Creature with its plate at its widest, a legendary Enchantment Artifact
  // (the colour's starfield, never an artifact frame: LCC #146) and a
  // colourless one on the silver starfield.
  ["m15nyx", "creature", "w", "@nyx-wide", { supertype: "Enchantment", subtypes: ["Griffin"], power: "12", toughness: "12" }],
  ["m15nyx", "enchantment", "u", "@nyx-artifact", { supertype: "Legendary Artifact", subtypes: [] }],
  ["m15nyx", "artifact", "c", "@nyx-silver", { supertype: "Enchantment", subtypes: ["Equipment"] }],
  // TODO 4.25: the Universes Beyond plate at its widest.
  ["m15ub", "creature", "g", "@wide", { power: "12", toughness: "12" }],
  // TODO 4.11: the Lord of the Rings scroll's plate at its widest, and the
  // colourless artifact creature on the light-blue artifact master and plate
  // (LTR #700 Shire Scarecrow).
  ["lotrscroll", "creature", "r", "@wide", { power: "12", toughness: "12" }],
  ["lotrscroll", "creature", "c", "@artifact", { supertype: "Artifact", subtypes: ["Scarecrow"], power: "0", toughness: "3" }],
  // TODO 4.11: the ring's plate at its widest, and a colourless artifact
  // creature on the artifact master and plate (no print has one).
  ["lotr", "creature", "r", "@wide", { power: "12", toughness: "12" }],
  ["lotr", "creature", "c", "@artifact", { supertype: "Artifact", subtypes: ["Golem"], power: "4", toughness: "4" }],
  // TODO 4.11 wave 2: the MKM dossier's tag at its widest, and a colourless
  // artifact creature on the pack's slate artifact master (MKM #376
  // Magnetic Snuffler).
  ["dossier", "creature", "r", "@wide", { power: "12", toughness: "12" }],
  ["dossier", "creature", "c", "@artifact", { supertype: "Artifact", subtypes: ["Construct"], power: "4", toughness: "4" }],
  // TODO 4.11 wave 2: the OTJ Breaking News' P/T box at its widest, and a
  // Vehicle on the pack's slate artifact master and its box (OTP #64
  // Unlicensed Hearse).
  ["breakingnews", "creature", "r", "@wide", { power: "12", toughness: "12" }],
  ["breakingnews", "artifact", "c", "@vehicle", { subtypes: ["Vehicle"], power: "*", toughness: "*" }],
  // TODO 4.11: the MUL Tarkir dragon wings' plate at its widest.
  ["tarkirdragon", "creature", "r", "@wide", { power: "12", toughness: "12" }],
  // TODO 4.11 wave 2: the D&D Sourcebook's plate at its widest, and a
  // colourless artifact creature on the one page (AFR #348 Iron Golem).
  ["dndsourcebook", "creature", "r", "@wide", { power: "12", toughness: "12" }],
  ["dndsourcebook", "creature", "c", "@artifact", { supertype: "Artifact", subtypes: ["Golem"], power: "5", toughness: "3" }],
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
  // The type line in its printed order and a land creature's P/T (TODO 1.20,
  // layout v50) — new cases: a land with "Creature" in its supertype (Dryad
  // Arbor's shape: "Land Creature — Forest Dryad" and a 1/1 on the land
  // frame's plate), an enchantment with "Land" on the saga body (Urza's
  // Saga's: "Enchantment Land"), and an enchantment with "Legendary
  // Artifact" (Bident of Thassa's: "Legendary Enchantment Artifact").
  [
    "m15land",
    "land",
    "g",
    "@creature",
    {
      title: "Grove Walker",
      card_type: "land",
      supertype: "Creature",
      subtypes: ["Forest", "Dryad"],
      cost: null,
      rules_text: "(This land is also a creature. It has \"{T}: Add {G}.\")",
      flavor_text: null,
      power: "1",
      toughness: "1",
    },
  ],
  [
    "saga",
    "saga",
    "u",
    "@land",
    { title: "The Sunken Archive", supertype: "Land", subtypes: ["Urza's", "Saga"], cost: null },
  ],
  [
    "m15",
    "enchantment",
    "u",
    "@artifact",
    { title: "Trident of the Tides", supertype: "Legendary Artifact", subtypes: [], rules_text: "Creatures you control have flash." },
  ],
];
const SQUARE_CASES: readonly [FrameTemplate, VisualColour][] = [
  ["m15", "w"],
  ["tarkirdragon", "u"],
  ["fullartland", "g"],
  ["m15borderless", "b"],
  ["battle", "r"],
  // The other landscape frame (TODO 4.21b): its Card Conjurer master's
  // black border runs to the corner too.
  ["split", "r"],
  // The Lord of the Rings ring (TODO 4.11): the frame field kept in the
  // top corners, the border black in the bottom ones.
  ["lotr", "g"],
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
  for (const [colour, shape, suffix, row, preset] of SAGA_RAIL_CASES) add("saga", "saga", colour, shape, { suffix, row, ...(preset ? { preset } : {}) });
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
  // The ring's band repaints the card's top, its corners kept square like
  // the masters' (TODO 4.11): squared, it keeps the frame field there.
  add("lotr", "creature", "w", "long", { crown: true, corners: "square", suffix: "@crown-square" });
  // The extended-art band at the stored bake's size (4.6f, wave 2b).
  add("extendedart", "creature", "u", "long", { crown: true, preset: "hd", suffix: "@crown-hd" });
  // The textless promo's band at the stored bake's size.
  add("m15textless", "creature", "r", "long", { crown: true, preset: "hd", suffix: "@crown-hd" });
  // The snow band at the stored bake's size (4.6f, wave 2c).
  add("m15snow", "creature", "u", "long", { crown: true, preset: "hd", suffix: "@crown-hd" });
  // The constellation band at the stored bake's size and on foil (the
  // faded arms inside the finish mask).
  add("nyx", "creature", "g", "long", { crown: true, preset: "hd", suffix: "@crown-hd" });
  add("nyx", "creature", "u", "long", { crown: true, finish: "foil", suffix: "@crown-foil" });
  // The ZNR hedron crown at the stored bake's size (TODO 4.11).
  add("fullart", "creature", "r", "long", { crown: true, preset: "hd", suffix: "@crown-hd" });
  // TODO 4.48's last pieces: the full-art token's floating crown round its
  // name pill (m20tokencrown/<key>), opt-in per card — NEW cases, no stored
  // token names the switch. A Legendary token on each height, the artifact
  // templates' colourless (the silver A crown) and a coloured artifact, at
  // the stored bake's size and on foil; the pairs are the generic
  // "@pair" / "@pair-crown" cases below (PAIR_TEMPLATES).
  const legendaryToken = (template: FrameTemplate, extra: Record<string, unknown> = {}, text = false): Partial<CardRowForBake> => ({
    title: "Scion of the Deep",
    supertype: template.includes("artifact") ? "Legendary Artifact Creature" : "Legendary Creature",
    subtypes: ["Octopus"],
    power: "8",
    toughness: "8",
    rules_text: text ? "Flying\nWhenever this token attacks, draw a card." : null,
    flavor_text: null,
    frame_style: { template, finish: "regular", crown: true, ...extra },
  });
  add("m20token", "token", "u", "short", { suffix: "@crown", row: legendaryToken("m20token") });
  add("m20token", "token", "u", "short", { suffix: "@crown-hd", preset: "hd", row: legendaryToken("m20token") });
  add("m20token", "token", "r", "short", { suffix: "@crown-foil", finish: "foil", row: legendaryToken("m20token", { finish: "foil" }) });
  add("m20tokentext", "token", "w", "short", { suffix: "@crown", row: legendaryToken("m20tokentext", {}, true) });
  add("m20tokentall", "token", "b", "short", { suffix: "@crown", row: legendaryToken("m20tokentall", {}, true) });
  add("m20tokenartifact", "token", "c", "short", { suffix: "@crown", row: legendaryToken("m20tokenartifact") });
  add("m20tokenartifacttext", "token", "u", "short", { suffix: "@crown", row: legendaryToken("m20tokenartifacttext", {}, true) });
  add("m20tokentext", "token", "wu", "short", { suffix: "@pair-crown", row: legendaryToken("m20tokentext", { twoColor: true }, true) });
  add("m20tokentext", "token", "wu", "short", { suffix: "@pair-crown-hd", preset: "hd", row: legendaryToken("m20tokentext", { twoColor: true }, true) });
  // TODO 4.51: the full-art token's Nyx dress — new templates, no stored
  // card. A Legendary Enchantment token's crown over the starry pill on each
  // of the six, at the stored bake's size and on foil (the generic cases
  // above bake every key on each), and the printed Nyx tokens' looks: W
  // textless (TDSK #4 Glimmer), W regular box with no P/T (TSOC #3
  // Contract), C artifact textless (TEOC #13 Golem).
  const nyxToken = (template: FrameTemplate, supertype: string, extra: Partial<CardRowForBake> = {}): Partial<CardRowForBake> => ({
    title: "Glimmer",
    supertype,
    subtypes: ["Glimmer"],
    power: "1",
    toughness: "1",
    rules_text: null,
    flavor_text: null,
    frame_style: { template, finish: "regular" },
    ...extra,
  });
  for (const template of ["m20tokennyx", "m20tokennyxtext", "m20tokennyxtall", "m20tokenartifactnyx", "m20tokenartifactnyxtext", "m20tokenartifactnyxtall"] as const) {
    const artifact = template.includes("artifact");
    const row = legendaryToken(template, {}, !template.endsWith("nyx"));
    add(template, "token", artifact ? "c" : "b", "short", {
      suffix: "@crown",
      row: { ...row, supertype: artifact ? "Legendary Enchantment Artifact Creature" : "Legendary Enchantment Creature" },
    });
  }
  add("m20tokennyx", "token", "w", "short", {
    suffix: "@crown-hd",
    preset: "hd",
    row: { ...legendaryToken("m20tokennyx"), supertype: "Legendary Enchantment Creature" },
  });
  add("m20tokennyx", "token", "u", "short", {
    suffix: "@crown-foil",
    finish: "foil",
    row: { ...legendaryToken("m20tokennyx", { finish: "foil" }), supertype: "Legendary Enchantment Creature" },
  });
  add("m20tokennyx", "token", "w", "short", { suffix: "@token-nyx", row: nyxToken("m20tokennyx", "Enchantment Creature") });
  add("m20tokennyx", "token", "w", "short", { suffix: "@token-nyx-hd", preset: "hd", row: nyxToken("m20tokennyx", "Enchantment Creature") });
  add("m20tokennyxtext", "token", "w", "short", {
    suffix: "@token-nyx-aura",
    row: nyxToken("m20tokennyxtext", "Enchantment", {
      title: "Contract",
      subtypes: ["Aura"],
      power: null,
      toughness: null,
      rules_text: "Enchant creature\nWhenever enchanted creature attacks, it gets +2/+0 until end of turn if it's attacking one of your opponents. Otherwise, its controller loses 2 life.",
    }),
  });
  add("m20tokenartifactnyx", "token", "c", "short", {
    suffix: "@token-nyx-artifact",
    row: nyxToken("m20tokenartifactnyx", "Enchantment Artifact Creature", { title: "Golem", subtypes: ["Golem"], power: "3", toughness: "3" }),
  });
  // TODO 4.6b: the two-colour frame, opt-in per card (frame_style.twoColor —
  // no stored card has the switch, so these are NEW cases, no bump): the
  // gold-split pair on every template that draws one, the hybrid dress on
  // m15, a finish of each dress and the stored bake's HD size.
  const pairStyle = (template: FrameTemplate, finish: VisualCase["finish"] = "regular", crown = false) => ({
    frame_style: crown ? { template, finish, crown: true, twoColor: true } : { template, finish, twoColor: true },
  });
  for (const template of PAIR_TEMPLATES) {
    // A double-faced body's pair cases need a back face: the 5.1d block below.
    if (getFrameProfile(template).dfc) continue;
    const primary = (hosted.get(template) ?? ["creature"])[0];
    add(template, primary, "wu", "short", { suffix: "@pair", row: pairStyle(template) });
    // A two-colour legend with both switches on: the split crown over its
    // pair master (4.6a + 4.6b, one release) — where the template draws a
    // crown at all (the borderless land draws its pairs and none: 4.56).
    // (The token's long row is a Treasure: an Artifact, made Legendary here —
    // the full-art token's crown, 4.48.)
    const legend = template.startsWith("m20token") ? { supertype: "Legendary Artifact" } : {};
    if (frameAnatomyOf(template).crown) add(template, primary, "wu", "long", { suffix: "@pair-crown", row: { ...pairStyle(template, "regular", true), ...legend } });
  }
  add("m15", "creature", "wu", "short", { suffix: "@pair-hybrid", row: { ...pairStyle("m15"), cost: "{W/U}{W/U}" } });
  // TODO 4.26: each part in its own colour (frame_style.partColor, opt-in
  // per card — no stored card has the switch, so these are NEW cases, no
  // bump): the second part's colour on back_face.color_identity, its cost
  // where the dress needs one. A stored card with a second colour and no
  // switch draws today's look (tests/unit/render/part-colour-bake.test.tsx).
  const partCase = (
    template: FrameTemplate,
    kind: CardKind,
    colour: VisualColour,
    shape: VisualShape,
    suffix: string,
    back: { colors: ColorIdentity[]; cost?: string },
    opts: { finish?: VisualCase["finish"]; preset?: VisualPreset; style?: Record<string, unknown>; row?: Partial<CardRowForBake> } = {},
  ) => {
    const finish = opts.finish ?? "regular";
    const base = rowFor(template, kind, colour, shape, finish, caseId(template, colour, kind, shape, suffix));
    add(template, kind, colour, shape, {
      suffix,
      finish,
      ...(opts.preset ? { preset: opts.preset } : {}),
      row: {
        frame_style: { ...(base.frame_style as Record<string, unknown>), partColor: true, ...(opts.style ?? {}) } as CardRowForBake["frame_style"],
        back_face: {
          ...(base.back_face as Record<string, unknown>),
          color_identity: back.colors,
          ...(back.cost ? { cost: back.cost } : {}),
        } as CardRowForBake["back_face"],
        ...(opts.row ?? {}),
      },
    });
  };
  // The Prepare page in its spell's colour: a mono page of another colour
  // (YFRA #29's blue page), a hybrid spell's grey page (FRA #3: a G/W spell
  // on a white creature), a gold spell's gold page on a mono creature, a
  // three-colour spell's plain gold page, and both finishes.
  partCase("prepare", "prepare", "r", "short", "@part-u", { colors: ["blue"], cost: "{1}{U}" });
  partCase("prepare", "prepare", "w", "short", "@part-gw-h", { colors: ["green", "white"], cost: "{G/W}" });
  partCase("prepare", "prepare", "g", "long", "@part-wb", { colors: ["white", "black"], cost: "{1}{W}{B}" });
  partCase("prepare", "prepare", "u", "short", "@part-m", { colors: ["multicolor"], cost: "{W}{U}{B}" });
  partCase("prepare", "prepare", "r", "short", "@part-u-foil", { colors: ["blue"], cost: "{1}{U}" }, { finish: "foil" });
  partCase("prepare", "prepare", "r", "long", "@part-u-etched", { colors: ["blue"], cost: "{1}{U}" }, { finish: "etched" });
  partCase("prepare", "prepare", "b", "long", "@part-gw-h-hd", { colors: ["green", "white"], cost: "{G/W}" }, { preset: "hd" });
  // The two-colour Prepare creature (its pair masters) with its spell's own
  // page: Abigale's grey hybrid page on the gold W/B creature (SOS #170 —
  // here W/U), a red page on a gold creature (YFRA #27); the pair crown is
  // "@pair-crown" (PAIR_TEMPLATES).
  partCase("prepare", "prepare", "wu", "long", "@pair-part-hybrid", { colors: ["white", "blue"], cost: "{1}{W/U}" }, { style: { twoColor: true } });
  partCase("prepare", "prepare", "wu", "short", "@pair-part-r", { colors: ["red"], cost: "{X}{R}" }, { style: { twoColor: true } });
  partCase("prepare", "prepare", "wu", "short", "@pair-hybrid-part", { colors: ["white", "blue"], cost: "{W/U}" }, { style: { twoColor: true }, row: { cost: "{1}{W/U}{W/U}" } });
  // Split's right half and aftermath's lower part in their own colour (Fire
  // // Ice; Cut // Ribbons): the seam, at the default bake and HD, and both
  // finishes' masks on it; a gold second half.
  partCase("split", "split", "r", "short", "@part-u", { colors: ["blue"], cost: "{1}{U}" });
  partCase("split", "split", "r", "long", "@part-u-hd", { colors: ["blue"], cost: "{1}{U}" }, { preset: "hd" });
  partCase("split", "split", "w", "short", "@part-m", { colors: ["blue", "black"], cost: "{2}{U}{B}" });
  // Owner decision M2: the card's colour stays the WHOLE card's (Stand //
  // Deliver, DMR #207: white and blue), its first half's on
  // frame_style.firstPartColor.
  partCase("split", "split", "wu", "short", "@part-u", { colors: ["blue"], cost: "{2}{U}" }, { style: { firstPartColor: ["white"] } });
  partCase("split", "split", "r", "short", "@part-u-foil", { colors: ["blue"], cost: "{1}{U}" }, { finish: "foil" });
  partCase("split", "split", "r", "long", "@part-u-etched", { colors: ["blue"], cost: "{1}{U}" }, { finish: "etched" });
  partCase("aftermath", "aftermath", "r", "short", "@part-b", { colors: ["black"], cost: "{X}{B}{B}" });
  partCase("aftermath", "aftermath", "r", "long", "@part-b-hd", { colors: ["black"], cost: "{X}{B}{B}" }, { preset: "hd" });
  partCase("aftermath", "aftermath", "g", "short", "@part-u-foil", { colors: ["blue"], cost: "{4}{U}{U}" }, { finish: "foil" });
  partCase("aftermath", "aftermath", "w", "long", "@part-b-etched", { colors: ["black"], cost: "{2}{B}" }, { finish: "etched" });
  // The adventure's storybook page in its spell's colour (owner decision
  // 2026-10-22: pre-cut pieces, `adventure/page/<key>`): WOE #221's red page
  // beside a black frame, WOE #229's white page beside red, a green page at
  // HD, a gold three-colour spell, a two-colour spell's gold page, and both
  // finishes over a page.
  partCase("adventure", "adventure", "b", "short", "@part-r", { colors: ["red"], cost: "{R}" });
  partCase("adventure", "adventure", "r", "long", "@part-w", { colors: ["white"], cost: "{4}{W}" });
  partCase("adventure", "adventure", "w", "long", "@part-g-hd", { colors: ["green"], cost: "{1}{G}" }, { preset: "hd" });
  partCase("adventure", "adventure", "u", "short", "@part-m", { colors: ["multicolor"], cost: "{W}{U}{B}" });
  partCase("adventure", "adventure", "g", "short", "@part-ub", { colors: ["blue", "black"], cost: "{U}{B}" });
  partCase("adventure", "adventure", "b", "short", "@part-r-foil", { colors: ["red"], cost: "{R}" }, { finish: "foil" });
  partCase("adventure", "adventure", "w", "long", "@part-u-etched", { colors: ["blue"], cost: "{2}{U}" }, { finish: "etched" });
  // The borderless hybrid dress (grey bars, the split pinline) and its
  // crowned twin (4.6f).
  add("m15borderless", "creature", "wu", "short", { suffix: "@pair-hybrid", row: { ...pairStyle("m15borderless"), cost: "{W/U}{W/U}" } });
  add("m15borderless", "creature", "wu", "long", {
    suffix: "@pair-hybrid-crown",
    row: { ...pairStyle("m15borderless", "regular", true), cost: "{X}{W/U}{W/U}{W/U}" },
  });
  // The Nyx dress's hybrid dress (TODO 4.7; added by the independent check
  // of #542 — its ten `<pair>-h` masters were published and baked by no
  // case): the two starfields across the frame ramp under the grey bars, and
  // the split Nyx crown band over it.
  add("m15nyx", "creature", "wu", "short", { suffix: "@pair-hybrid", row: { ...pairStyle("m15nyx"), cost: "{W/U}{W/U}" } });
  add("m15nyx", "creature", "wu", "long", {
    suffix: "@pair-hybrid-crown",
    row: { ...pairStyle("m15nyx", "regular", true), cost: "{X}{W/U}{W/U}{W/U}" },
  });
  // The extended-art frame's hybrid dress (TODO 4.7 follow-up, owner Round
  // 63): the two frames split over the grey bars, with the split floating
  // crown; and a land pair at the stored bake's size.
  add("extendedart", "creature", "wu", "short", { suffix: "@pair-hybrid", row: { ...pairStyle("extendedart"), cost: "{W/U}{W/U}" } });
  add("extendedart", "creature", "wu", "long", {
    suffix: "@pair-hybrid-crown",
    row: { ...pairStyle("extendedart", "regular", true), cost: "{X}{W/U}{W/U}{W/U}" },
  });
  add("extendedartland", "land", "wu", "long", { suffix: "@pair-hd", preset: "hd", row: pairStyle("extendedartland") });
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
  // The snow pair at the stored bake's size, with the split crown (4.6f,
  // wave 2c: KHM #224's look), and the snow dual land.
  add("m15snow", "creature", "wu", "long", { suffix: "@pair-crown-hd", preset: "hd", row: pairStyle("m15snow", "regular", true) });
  add("m15snowland", "land", "wu", "short", { suffix: "@pair-hd", preset: "hd", row: pairStyle("m15snowland") });
  // TODO 4.56: the borderless land's pair (the grey land bars, the pinline
  // AND the box split) — the generic "@pair" above is its W|U card; here the
  // long card at the stored bake's size, a pair with black on the left (its
  // ring and box are the darkest of the ten), the foil (the sheen's mask
  // reads the pair master; no etched: the art reaches the edge) and the
  // squared print. The same land with the switch off is the plain
  // "m15borderlessland/wu/…" case: the gold `m` master, as every stored one.
  add("m15borderlessland", "land", "wu", "long", { suffix: "@pair-hd", preset: "hd", row: pairStyle("m15borderlessland") });
  add("m15borderlessland", "land", "wu", "short", {
    suffix: "@pair-br",
    row: { ...pairStyle("m15borderlessland"), color_identity: ["black", "red"] },
  });
  add("m15borderlessland", "land", "wu", "short", { suffix: "@pair-foil", finish: "foil", row: pairStyle("m15borderlessland", "foil") });
  add("m15borderlessland", "land", "wu", "short", { suffix: "@pair-square", corners: "square", row: pairStyle("m15borderlessland") });
  // TODO 4.6h: two colours on the old frames — NEW cases (the switch is a
  // card's own; the same card without it is the plain "<template>/wu/…"
  // case, the gold master every stored card paints). The generic "@pair"
  // above is each template's W|U card (on `modern` the wide, soft pinline);
  // here a pair with the NARROW pinline (G|W: bg, gw and rw print it), the
  // darkest pair, an all-hybrid cost (no hybrid dress there: the same
  // split), the stored bake's size, the foil and the squared print; and the
  // two land frames' long card at HD, a dark pair and the squared print.
  add("modern", "creature", "wu", "short", { suffix: "@pair-gw", row: { ...pairStyle("modern"), color_identity: ["green", "white"], cost: "{1}{G}{W}" } });
  add("modern", "creature", "wu", "short", { suffix: "@pair-ub", row: { ...pairStyle("modern"), color_identity: ["blue", "black"], cost: "{1}{U}{B}" } });
  add("modern", "creature", "wu", "short", { suffix: "@pair-hybrid", row: { ...pairStyle("modern"), cost: "{W/U}{W/U}" } });
  add("modern", "creature", "wu", "long", { suffix: "@pair-hd", preset: "hd", row: pairStyle("modern") });
  add("modern", "creature", "wu", "short", { suffix: "@pair-foil", finish: "foil", row: pairStyle("modern", "foil") });
  add("modern", "creature", "wu", "short", { suffix: "@pair-square", corners: "square", row: pairStyle("modern") });
  for (const land of ["modernland", "retroland"] as const) {
    add(land, "land", "wu", "long", { suffix: "@pair-hd", preset: "hd", row: pairStyle(land) });
    add(land, "land", "wu", "short", { suffix: "@pair-br", row: { ...pairStyle(land), color_identity: ["black", "red"] } });
    add(land, "land", "wu", "short", { suffix: "@pair-square", corners: "square", row: pairStyle(land) });
  }
  // TODO 6.16d (layout v52): a long name before a DETACHED cost of Phyrexian
  // symbols — NEW cases (no case above sets one in a detached cost). The
  // name's room is measured against the row of ×1.2 discs: three and five
  // of them on the 2003 frame and on the walker, and five at the stored
  // bake's size. The name is long enough to shrink before either cost.
  for (const [template, kind] of [["modern", "creature"], ["m15pw", "planeswalker"]] as const) {
    for (const count of [3, 5]) {
      const row = { title: "Elesh Norn, Grand Cenobite of the Machine Orthodoxy", cost: "{W/P}".repeat(count) };
      add(template, kind, "w", "long", { suffix: `@phyrexian-cost-${count}`, row });
      if (count === 5) add(template, kind, "w", "long", { suffix: `@phyrexian-cost-${count}-hd`, preset: "hd", row });
    }
  }
  // TODO 3.21 (layout v53): the LARGE pips — a hybrid, a twobrid and a
  // Phyrexian symbol in one cost and in one rules text, at the stored
  // bake's size — NEW cases: on the M15 frame (88 px beside 73 in the cost,
  // 77 beside 60 in the text), the 2003 frame (85 beside 66; a detached
  // cost: the name gives way) and the 1997 frame (×1.2 kept in the cost).
  for (const template of ["m15", "modern", "retro"] as const) {
    add(template, "creature", "u", "short", {
      suffix: "@large-pips-hd",
      preset: "hd",
      row: { cost: "{1}{W/U}{2/W}{W/P}", rules_text: "{W/U}{2/W}, {T}: Draw a card.\n{G/U/P}{W/P}{1}: Scry 1.", flavor_text: null },
    });
  }
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
      add(template, "transform", "g", "long", { suffix: "@collector", back, row: { ...dfcBodyRow(template, "g", "long"), ...collectorRow(front, "2023", dfcBodyRow(template, "g", "long")) } });
      add(template, "transform", "u", "short", { suffix: "@collector-2015", back, row: { ...dfcBodyRow(template, "u"), ...collectorRow(front, "2015", dfcBodyRow(template, "u")) } });
      continue;
    }
    const primary = (hosted.get(template) ?? ["creature"])[0];
    add(template, primary, "g", "long", { suffix: "@collector", row: collectorRow(template, "2023") });
    add(template, primary, "u", "short", { suffix: "@collector-2015", row: collectorRow(template, "2015") });
  }
  // TODO 6.3: the nickname — no stored card has one (migration 0141), so
  // these are NEW cases, no bump: on every template that declares the plate
  // (the primary kind), and on m15 a colourless see-through card, the
  // two-colour pair's two-coloured rim, a long name that steps down and a
  // nickname too long for the bar, the HD bake and both finishes.
  for (const template of FRAME_TEMPLATE_VALUES.filter((t) => getFrameProfile(t).nickname)) {
    const primary = (hosted.get(template) ?? ["creature"])[0];
    add(template, primary, "g", "long", { suffix: "@nickname", row: { nickname: "Wakandan War Panther" } });
    add(template, primary, "c", "short", { suffix: "@nickname", row: { nickname: "Panther Idol" } });
  }
  add("m15", "creature", "wu", "short", { suffix: "@nickname-pair", row: { nickname: "Wakandan War Panther", frame_style: { template: "m15", finish: "regular", twoColor: true } } });
  add("m15", "creature", "r", "long", {
    suffix: "@nickname-long",
    row: {
      title: "Kenrith, the Returned King of the Seven Realms Beyond the Glittering Silver Sea",
      nickname: "General Picard, Earth Warlord of the United Federation of Planets",
    },
  });
  add("m15", "creature", "b", "long", { suffix: "@nickname-hd", preset: "hd", row: { nickname: "Post, Son of Rich" } });
  add("m15", "creature", "u", "short", { suffix: "@nickname-foil", finish: "foil", row: { nickname: "Unstable Harmonics", frame_style: { template: "m15", finish: "foil" } } });
  add("m15", "creature", "w", "short", { suffix: "@nickname-etched", finish: "etched", row: { nickname: "Unstable Harmonics", frame_style: { template: "m15", finish: "etched" } } });
  // TODO 6.2: CARDNAME / `~` — no stored card's text holds one unflagged
  // (migration 0142), so NEW cases: the tokens drawn as the name, as the
  // nickname where the title bar prints it, as typed on a flagged card, and
  // in a walker's structured rows.
  const SELF_RULES = "~ deals 3 damage to any target.\nWhen CARDNAME dies, draw a card.";
  add("m15", "creature", "r", "short", { suffix: "@selfname", row: { rules_text: SELF_RULES, flavor_text: null } });
  add("m15", "creature", "g", "short", { suffix: "@selfname-nickname", row: { rules_text: SELF_RULES, flavor_text: null, nickname: "The Verdant Sovereign" } });
  add("m15", "creature", "b", "short", {
    suffix: "@selfname-literal",
    row: { rules_text: SELF_RULES, flavor_text: null, frame_style: { template: "m15", finish: "regular", selfName: "literal" } },
  });
  add("m15pw", "planeswalker", "w", "short", {
    suffix: "@selfname",
    row: {
      rules_text: "+1: ~ deals 1 damage to any target.\n-3: Untap CARDNAME.",
      face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: "~ deals 1 damage to any target." }, { cost: "-3", text: "Untap CARDNAME." }] } },
      flavor_text: null,
    },
  });
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
  // TODO 4.11: a two-colour Expedition as the import stores it — gold in its
  // colour, its frame the plain land master `c` (FrameStyle.plainLandMaster).
  for (const template of ["expeditionland", "expeditionlandbfz"] as const) {
    add(template, "land", "wu", "short", {
      suffix: "@plain-land",
      row: { frame_style: { template, finish: "regular", plainLandMaster: true } as CardRowForBake["frame_style"] },
    });
    // …with a mana watermark: tinted as the `c` master it paints, not the
    // gold card's neutral ink (the preview's twin:
    // tests/unit/components/expedition-watermark-tint.test.tsx).
    add(template, "land", "wu", "long", {
      suffix: "@plain-land-watermark",
      row: {
        frame_style: { template, finish: "regular", plainLandMaster: true } as CardRowForBake["frame_style"],
        watermark: { kind: "mana", key: "u" },
      },
    });
  }
  // A long artist: cut with one "…" before the © slot's mark.
  add("m15", "creature", "g", "long", {
    suffix: "@collector-artist",
    row: collectorRow("m15", "2023", { artist_credit: "Someone With An Extraordinarily Long Illustrator Name Indeed" }),
  });
  // The stored bake's size, and the squared print.
  add("m15", "creature", "g", "long", { suffix: "@collector-hd", preset: "hd", row: collectorRow("m15", "2023") });
  add("m15", "creature", "u", "short", { suffix: "@collector-2015-square", corners: "square", row: collectorRow("m15", "2015") });
  // TODO 4.9c: the holofoil stamp, opt-in per card (frame_style.stamp — no
  // stored card has the key, so these are NEW cases, no bump): a rare on
  // "auto" on every template with the notch (the primary kind: a walker on
  // m15pw), and on m15 the stamp's other shapes.
  for (const template of STAMP_TEMPLATES) {
    const primary = (hosted.get(template) ?? ["creature"])[0];
    add(template, primary, "u", "short", { suffix: "@stamp", row: stampRow(template, "auto", { rarity: "rare" }) });
  }
  add("m15", "creature", "c", "short", { suffix: "@stamp-c", row: stampRow("m15", "auto", { rarity: "rare" }) });
  add("m15", "creature", "wub", "short", { suffix: "@stamp-m", row: stampRow("m15", "auto", { rarity: "rare" }) });
  // "Always" on a common; a full box whose last line enters the arch.
  add("m15", "creature", "w", "short", { suffix: "@stamp-always", row: stampRow("m15", "oval", { rarity: "common" }) });
  add("m15", "creature", "b", "long", { suffix: "@stamp-arch", row: stampRow("m15", "auto", { rarity: "rare", rules_text: STAMP_ARCH_RULES, flavor_text: null }) });
  // The stored bake's size, the finishes (the notch in the sheen, the oval
  // outside it) and the squared print.
  add("m15", "creature", "g", "long", { suffix: "@stamp-hd", preset: "hd", row: stampRow("m15", "auto", { rarity: "mythic" }) });
  add("m15", "creature", "r", "short", { suffix: "@stamp-foil", finish: "foil", row: stampRow("m15", "auto", { rarity: "rare", frame_style: { finish: "foil" } as CardRowForBake["frame_style"] }) });
  add("m15", "creature", "u", "long", { suffix: "@stamp-etched", finish: "etched", row: stampRow("m15", "auto", { rarity: "mythic", frame_style: { finish: "etched" } as CardRowForBake["frame_style"] }) });
  add("m15", "creature", "u", "short", { suffix: "@stamp-square", corners: "square", row: stampRow("m15", "auto", { rarity: "rare" }) });
  // The pair frames (the 4.9c follow-up, owner round 26, 2026-10-03): the
  // pair's notch — its rim the pair master's own bar, tinted per column
  // across the 40→60 %W ramp — on a rare on "auto" drawn as its pair master
  // on every template with pairs AND the notch (m15, m15artifact, m15land,
  // and 4.6f wave 2c's m15snow and m15snowland — the same pieces: their
  // bar under the notch is m15's pair bar — STAMP_PAIR_TEMPLATES; the
  // gold-split dress, "@stamp-pair-split"), the
  // hybrid dress (the same piece over its own master), a crowned pair rare
  // (the split crown and the pair notch on one card), the stored bake's HD
  // size and a foil pair (the notch in the sheen). Wave 1's "@stamp-pair"
  // pin (the switch on a pair master, nothing drawn) is retired: it pinned
  // the gap this follow-up closes.
  for (const template of STAMP_PAIR_TEMPLATES) {
    const primary = (hosted.get(template) ?? ["creature"])[0];
    add(template, primary, "wu", "short", { suffix: "@stamp-pair-split", row: stampRow(template, "auto", { rarity: "rare", frame_style: { twoColor: true } as CardRowForBake["frame_style"] }) });
  }
  add("m15", "creature", "wu", "short", { suffix: "@stamp-pair-hybrid", row: stampRow("m15", "auto", { rarity: "rare", cost: "{W/U}{W/U}", frame_style: { twoColor: true } as CardRowForBake["frame_style"] }) });
  add("m15", "creature", "wu", "long", { suffix: "@stamp-pair-crown", row: stampRow("m15", "auto", { rarity: "mythic", frame_style: { crown: true, twoColor: true } as CardRowForBake["frame_style"] }) });
  add("m15", "creature", "wu", "long", { suffix: "@stamp-pair-hd", preset: "hd", row: stampRow("m15", "auto", { rarity: "rare", frame_style: { twoColor: true } as CardRowForBake["frame_style"] }) });
  add("m15", "creature", "wu", "short", { suffix: "@stamp-pair-foil", finish: "foil", row: stampRow("m15", "auto", { rarity: "rare", frame_style: { finish: "foil", twoColor: true } as CardRowForBake["frame_style"] }) });
  // TODO 4.25: the Universes Beyond TRIANGLE (new templates, no stored
  // card: new cases, no bump) beyond the loops above — "Always" on a common
  // (print stamps every rarity there), the hybrid dress under the pair
  // notch, a crowned pair, a full box whose last line reaches the raised
  // pinline, the stored bake's size, a foil and the squared print.
  add("m15ub", "creature", "r", "short", { suffix: "@stamp-always", row: stampRow("m15ub", "triangle", { rarity: "common" }) });
  add("m15ub", "creature", "wu", "short", { suffix: "@stamp-pair-hybrid", row: stampRow("m15ub", "auto", { rarity: "rare", cost: "{W/U}{W/U}", frame_style: { twoColor: true } as CardRowForBake["frame_style"] }) });
  add("m15ub", "creature", "wu", "long", { suffix: "@stamp-pair-crown", row: stampRow("m15ub", "auto", { rarity: "mythic", frame_style: { crown: true, twoColor: true } as CardRowForBake["frame_style"] }) });
  add("m15ub", "creature", "b", "long", { suffix: "@stamp-arch", row: stampRow("m15ub", "auto", { rarity: "rare", rules_text: STAMP_ARCH_RULES, flavor_text: null }) });
  add("m15ub", "creature", "g", "long", { suffix: "@stamp-hd", preset: "hd", row: stampRow("m15ub", "auto", { rarity: "mythic" }) });
  add("m15ub", "creature", "c", "short", { suffix: "@stamp-c", row: stampRow("m15ub", "auto", { rarity: "rare" }) });
  add("m15ub", "creature", "w", "short", { suffix: "@stamp-foil", finish: "foil", row: stampRow("m15ub", "auto", { rarity: "rare", frame_style: { finish: "foil" } as CardRowForBake["frame_style"] }) });
  add("m15ubland", "land", "u", "short", { suffix: "@stamp-square", corners: "square", row: stampRow("m15ubland", "auto", { rarity: "rare" }) });
  // TODO 4.25 follow-up (owner Round 57): "auto" stamps EVERY rarity on the
  // triangle frames — a common's and an uncommon's MATTE grey triangle
  // (new cases), at the 750 bake and at the stored bake's size.
  add("m15ub", "creature", "u", "short", { suffix: "@stamp-auto-common", row: stampRow("m15ub", "auto", { rarity: "common" }) });
  add("m15ubartifact", "artifact", "c", "short", { suffix: "@stamp-auto-uncommon", row: stampRow("m15ubartifact", "auto", { rarity: "uncommon" }) });
  add("m15ub", "creature", "r", "long", { suffix: "@stamp-matte-hd", preset: "hd", row: stampRow("m15ub", "auto", { rarity: "common" }) });
  // TODO 4.11: the Lord of the Rings scroll's notch — the matte face on a
  // common, the colourless artifact's light-blue piece over its `a` master
  // (LTR #697 The One Ring) and the colourless land's brown one (#712 Shire
  // Terrace), the HD bake — and its crown on the two colourless dresses.
  add("lotrscroll", "creature", "g", "short", { suffix: "@stamp-auto-common", row: stampRow("lotrscroll", "auto", { rarity: "common" }) });
  add("lotrscroll", "artifact", "c", "long", { suffix: "@stamp-c", row: stampRow("lotrscroll", "auto", { rarity: "mythic" }) });
  add("lotrscroll", "land", "c", "long", { suffix: "@stamp-c", row: stampRow("lotrscroll", "auto", { rarity: "rare" }) });
  add("lotrscroll", "creature", "b", "long", { suffix: "@stamp-hd", preset: "hd", row: stampRow("lotrscroll", "auto", { rarity: "mythic" }) });
  add("lotrscroll", "artifact", "c", "long", { suffix: "@crown", row: { supertype: "Legendary", frame_style: { template: "lotrscroll", finish: "regular", crown: true } } });
  add("lotrscroll", "land", "c", "long", { suffix: "@crown", row: { supertype: "Legendary", frame_style: { template: "lotrscroll", finish: "regular", crown: true } } });
  // TODO 4.11: the Lord of the Rings ring's notch — the matte face on a
  // common, the colourless artifact's piece over its `a` master and the
  // colourless land's brown one, the HD bake — its crown on the two
  // colourless dresses, and a square corner (the frame field kept there).
  add("lotr", "creature", "g", "short", { suffix: "@stamp-auto-common", row: stampRow("lotr", "auto", { rarity: "common" }) });
  add("lotr", "artifact", "c", "long", { suffix: "@stamp-c", row: stampRow("lotr", "auto", { rarity: "mythic" }) });
  add("lotr", "land", "c", "long", { suffix: "@stamp-c", row: stampRow("lotr", "auto", { rarity: "rare" }) });
  add("lotr", "creature", "b", "long", { suffix: "@stamp-hd", preset: "hd", row: stampRow("lotr", "auto", { rarity: "mythic" }) });
  add("lotr", "artifact", "c", "long", { suffix: "@crown", row: { supertype: "Legendary", frame_style: { template: "lotr", finish: "regular", crown: true } } });
  add("lotr", "land", "c", "long", { suffix: "@crown", row: { supertype: "Legendary", frame_style: { template: "lotr", finish: "regular", crown: true } } });
  // TODO 4.11: the MUL Tarkir dragon wings' OVAL notch — "auto" on a rare
  // (every printing), none on a common, the two-colour card's (the split
  // wings: the gold key's piece, `-m`), the HD bake.
  add("tarkirdragon", "creature", "w", "long", { suffix: "@stamp", row: stampRow("tarkirdragon", "auto", { rarity: "rare" }) });
  add("tarkirdragon", "creature", "g", "short", { suffix: "@stamp-auto-common", row: stampRow("tarkirdragon", "auto", { rarity: "common" }) });
  add("tarkirdragon", "creature", "wu", "long", { suffix: "@stamp-m", row: stampRow("tarkirdragon", "auto", { rarity: "rare" }) });
  add("tarkirdragon", "creature", "b", "long", { suffix: "@stamp-hd", preset: "hd", row: stampRow("tarkirdragon", "auto", { rarity: "mythic" }) });
  // TODO 4.11 wave 2: the D&D Sourcebook's OVAL notch — none on a common
  // (AFR / CLB print it on a rare or mythic only), a three-colour legend's
  // (CLB #415 Bane: the one page, the gold key's piece), the HD bake.
  add("dndsourcebook", "creature", "g", "short", { suffix: "@stamp-auto-common", row: stampRow("dndsourcebook", "auto", { rarity: "common" }) });
  add("dndsourcebook", "creature", "wub", "long", { suffix: "@stamp-m", row: stampRow("dndsourcebook", "auto", { rarity: "rare" }) });
  add("dndsourcebook", "creature", "u", "long", { suffix: "@stamp-hd", preset: "hd", row: stampRow("dndsourcebook", "auto", { rarity: "mythic" }) });
  add("m15ub", "creature", "wu", "short", { suffix: "@pair-hybrid", row: { ...pairStyle("m15ub"), cost: "{W/U}{W/U}" } });
  // TODO 4.11 wave 2: the MKM dossier's OVAL notch — none on an uncommon
  // (MKM prints it on a rare or mythic only), a gold legend's (MKM #368
  // Niv-Mizzet: the gold key's piece), the HD bake.
  add("dossier", "creature", "g", "short", { suffix: "@stamp-auto-common", row: stampRow("dossier", "auto", { rarity: "uncommon" }) });
  add("dossier", "creature", "wub", "long", { suffix: "@stamp-m", row: stampRow("dossier", "auto", { rarity: "rare" }) });
  add("dossier", "creature", "b", "long", { suffix: "@stamp-hd", preset: "hd", row: stampRow("dossier", "auto", { rarity: "mythic" }) });
  // TODO 4.11 wave 2: the OTJ Breaking News' OVAL tab — none on an uncommon
  // (OTP prints it on a rare or mythic only), a gold card's (OTP #40 Cruel
  // Ultimatum: the gold key's piece), the land's (OTP #65 Dust Bowl: `l`),
  // the HD bake.
  add("breakingnews", "instant", "u", "short", { suffix: "@stamp-auto-common", row: stampRow("breakingnews", "auto", { rarity: "uncommon" }) });
  add("breakingnews", "sorcery", "wub", "long", { suffix: "@stamp-m", row: stampRow("breakingnews", "auto", { rarity: "rare" }) });
  add("breakingnews", "land", "c", "short", { suffix: "@stamp-c", row: stampRow("breakingnews", "auto", { rarity: "rare" }) });
  add("breakingnews", "sorcery", "b", "long", { suffix: "@stamp-hd", preset: "hd", row: stampRow("breakingnews", "auto", { rarity: "mythic" }) });
  // TODO 4.9d: the borderless frames (new keys on templates whose stored
  // cards carry none: new cases, no bump) beyond the loops above — the
  // see-through colourless frame and the artifact's silver, a crowned
  // mythic (the crowned twin under the same piece), the hybrid dress under
  // the pair's piece, a full box whose last line reaches the arch, the
  // stored bake's size, a foil, the squared print, "Always" on a common,
  // and the line and the stamp together, with and without a plate.
  add("m15borderless", "creature", "c", "short", { suffix: "@stamp-c", row: stampRow("m15borderless", "auto", { rarity: "rare" }) });
  add("m15borderlessartifact", "artifact", "c", "short", { suffix: "@stamp-c", row: stampRow("m15borderlessartifact", "auto", { rarity: "rare" }) });
  add("m15borderless", "creature", "r", "long", { suffix: "@stamp-crown", row: stampRow("m15borderless", "auto", { rarity: "mythic", frame_style: { crown: true } as CardRowForBake["frame_style"] }) });
  add("m15borderless", "creature", "wu", "short", { suffix: "@stamp-pair-hybrid", row: stampRow("m15borderless", "auto", { rarity: "rare", cost: "{W/U}{W/U}", frame_style: { twoColor: true } as CardRowForBake["frame_style"] }) });
  add("m15borderless", "creature", "b", "long", { suffix: "@stamp-arch", row: stampRow("m15borderless", "auto", { rarity: "rare", rules_text: STAMP_ARCH_RULES, flavor_text: null }) });
  add("m15borderless", "creature", "g", "long", { suffix: "@stamp-hd", preset: "hd", row: stampRow("m15borderless", "auto", { rarity: "mythic" }) });
  add("m15borderless", "creature", "r", "short", { suffix: "@stamp-foil", finish: "foil", row: stampRow("m15borderless", "auto", { rarity: "rare", frame_style: { finish: "foil" } as CardRowForBake["frame_style"] }) });
  add("m15borderless", "creature", "u", "short", { suffix: "@stamp-square", corners: "square", row: stampRow("m15borderless", "auto", { rarity: "rare" }) });
  add("m15borderless", "creature", "w", "short", { suffix: "@stamp-always", row: stampRow("m15borderless", "oval", { rarity: "common" }) });
  // A Universes Beyond printing's triangle on the borderless frame draws
  // NOTHING (owner Round 70: no triangle notch there yet) — the plain look,
  // pinned.
  add("m15borderless", "creature", "u", "short", { suffix: "@stamp-triangle", row: stampRow("m15borderless", "triangle", { rarity: "rare" }) });
  add("m15borderlessland", "land", "g", "long", { suffix: "@stamp-hd", preset: "hd", row: stampRow("m15borderlessland", "auto", { rarity: "rare" }) });
  add("m15borderlessstation", "artifact", "c", "long", { suffix: "@stamp-hd", preset: "hd", row: stampRow("m15borderlessstation", "auto", { rarity: "mythic" }) });
  add("m15borderless", "instant", "u", "short", { suffix: "@collector-noplate", row: collectorRow("m15borderless", "2023") });
  add("m15borderless", "creature", "g", "long", { suffix: "@collector-hd", preset: "hd", row: collectorRow("m15borderless", "2023") });
  add("m15borderless", "creature", "r", "long", {
    suffix: "@stamp-collector-hd",
    preset: "hd",
    row: collectorRow("m15borderless", "2023", { rarity: "rare", frame_style: { stamp: "auto" } as CardRowForBake["frame_style"] }),
  });
  add("m15borderless", "instant", "b", "short", {
    suffix: "@stamp-collector-2015",
    row: collectorRow("m15borderless", "2015", { rarity: "mythic", frame_style: { stamp: "auto" } as CardRowForBake["frame_style"] }),
  });
  // The borderless walkers (owner Round 70; new keys on templates whose
  // stored cards carry none: new cases, no bump) beyond the loops above —
  // long abilities on both frames at the stored bake's size, the
  // see-through colourless frame, a foil (the notch's own sheen over the
  // rows), "Always" on an uncommon, a last ability that runs into the arch (held up over it)
  // (WALKER_STAMP_ARCH_ROWS), the triangle (nothing drawn), and the line
  // and the stamp together at HD.
  add("m15borderlesspw", "planeswalker", "g", "long", { suffix: "@stamp-hd", preset: "hd", row: stampRow("m15borderlesspw", "auto", { rarity: "mythic" }) });
  add("m15borderlesspwtall", "planeswalker", "r", "long", { suffix: "@stamp-hd", preset: "hd", row: stampRow("m15borderlesspwtall", "auto", { rarity: "mythic" }) });
  add("m15borderlesspw", "planeswalker", "c", "short", { suffix: "@stamp-c", row: stampRow("m15borderlesspw", "auto", { rarity: "rare" }) });
  add("m15borderlesspw", "planeswalker", "w", "short", { suffix: "@stamp-foil", finish: "foil", row: stampRow("m15borderlesspw", "auto", { rarity: "mythic", frame_style: { finish: "foil" } as CardRowForBake["frame_style"] }) });
  // Etched (owner Round 72): the frame's hatch over the notch too.
  add("m15borderlesspw", "planeswalker", "g", "short", { suffix: "@stamp-etched", finish: "etched", row: stampRow("m15borderlesspw", "auto", { rarity: "mythic", frame_style: { finish: "etched" } as CardRowForBake["frame_style"] }) });
  add("m15borderlesspw", "planeswalker", "b", "short", { suffix: "@stamp-always", row: stampRow("m15borderlesspw", "oval", { rarity: "uncommon" }) });
  add("m15borderlesspw", "planeswalker", "u", "long", { suffix: "@stamp-arch", row: stampRow("m15borderlesspw", "auto", { rarity: "mythic", rules_text: WALKER_STAMP_ARCH_ROWS, face_content: null }) });
  add("m15borderlesspwtall", "planeswalker", "g", "long", { suffix: "@stamp-arch", row: stampRow("m15borderlesspwtall", "auto", { rarity: "mythic", rules_text: WALKER_STAMP_ARCH_ROWS_TALL, face_content: null }) });
  add("m15borderlesspw", "planeswalker", "u", "short", { suffix: "@stamp-triangle", row: stampRow("m15borderlesspw", "triangle", { rarity: "mythic" }) });
  add("m15borderlesspw", "planeswalker", "r", "long", {
    suffix: "@stamp-collector-hd",
    preset: "hd",
    row: collectorRow("m15borderlesspw", "2023", { rarity: "mythic", frame_style: { stamp: "auto" } as CardRowForBake["frame_style"] }),
  });
  // A token with the key: the switch on, nothing drawn — the plain look,
  // pinned.
  add("m15token", "token", "g", "short", { suffix: "@stamp-token", row: stampRow("m15token", "oval", { rarity: "rare" }) });
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
      add(body, "transform", colour, "long", { back: { frontTemplate: front }, row: dfcBodyRow(body, colour, "long") });
    }
    add(body, "transform", "g", "long", { preset: "hd", suffix: "@hd", back: { frontTemplate: front }, row: dfcBodyRow(body, "g", "long") });
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
  add("m15dfcfront", "transform", "r", "short", { finish: "foil", suffix: "@foil", row: dfcBodyRow("m15dfcback", "r", "short", "foil") });
  add("m15dfcback", "transform", "r", "short", { finish: "foil", suffix: "@foil", back: { frontTemplate: "m15dfcfront" }, row: dfcBodyRow("m15dfcback", "r", "short", "foil") });
  add("m15dfcfront", "transform", "b", "short", { corners: "square", suffix: "@square" });
  // TODO 5.7: the borderless double-faced bodies — NEW cases (new
  // templates, no stored card: no bump). The fronts come out of the
  // per-template loop (their rows carry the borderless back). Here: the
  // transform back × colour, short and long, and the stored bake's size;
  // the crowned twins (the floating crown with the well / housing), the
  // pinline-split pairs and their crowned twins on every face; the front's
  // empty tab; a foil and a square front.
  for (const colour of VISUAL_COLOURS) {
    add("m15borderlessdfcback", "transform", colour, "short", { back: { frontTemplate: "m15borderlessdfcfront" }, row: dfcBodyRow("m15borderlessdfcback", colour) });
    add("m15borderlessdfcback", "transform", colour, "long", { back: { frontTemplate: "m15borderlessdfcfront" }, row: dfcBodyRow("m15borderlessdfcback", colour, "long") });
  }
  add("m15borderlessdfcback", "transform", "g", "long", { preset: "hd", suffix: "@hd", back: { frontTemplate: "m15borderlessdfcfront" }, row: dfcBodyRow("m15borderlessdfcback", "g", "long") });
  add("m15borderlessdfcfront", "transform", "w", "short", { suffix: "@emptytab", row: { ...DFC_AURA_BACK, frame_style: { template: "m15borderlessdfcfront", finish: "regular" }, back_face: { ...(DFC_AURA_BACK.back_face as NonNullable<CardRowForBake["back_face"]>), frame_style: { template: "m15borderlessdfcback" } } } });
  add("m15borderlessdfcfront", "transform", "r", "short", { finish: "foil", suffix: "@foil", row: dfcBodyRow("m15borderlessdfcback", "r", "short", "foil") });
  add("m15borderlessdfcfront", "transform", "b", "short", { corners: "square", suffix: "@square" });
  add("m15borderlessmdfcfront", "mdfc", "r", "short", { finish: "foil", suffix: "@foil", row: dfcBodyRow("m15borderlessmdfcback", "r", "short", "foil") });
  add("m15borderlessmdfcfront", "mdfc", "u", "short", { corners: "square", suffix: "@square" });
  {
    const switched = (row: Partial<CardRowForBake>, on: { crown?: true; twoColor?: true }): Partial<CardRowForBake> => ({
      ...row,
      frame_style: { ...(row.frame_style as object), ...on } as CardRowForBake["frame_style"],
    });
    const PAIRS = [["m15borderlessdfcfront", "transform", "m15borderlessdfcback"], ["m15borderlessmdfcfront", "mdfc", "m15borderlessmdfcback"]] as const;
    for (const [front, kind, back] of PAIRS) {
      for (const colour of ["w", "u", "b", "r", "g", "c", "wu", "wub"] as const) {
        add(front, kind, colour, "long", { suffix: "@crown", row: switched(dfcBodyRow(back, colour, "long"), { crown: true }) });
        add(back, kind, colour, "long", { suffix: "@crown", back: { frontTemplate: front }, row: switched(dfcBodyRow(back, colour, "long"), { crown: true }) });
      }
      add(front, kind, "wu", "short", { suffix: "@pair", row: switched(dfcBodyRow(back, "wu"), { twoColor: true }) });
      add(front, kind, "wu", "long", { suffix: "@pair-crown", row: switched(dfcBodyRow(back, "wu", "long"), { crown: true, twoColor: true }) });
      add(back, kind, "wu", "short", { suffix: "@pair", back: { frontTemplate: front }, row: switched(dfcBodyRow(back, "wu"), { twoColor: true }) });
      add(back, kind, "wu", "long", { suffix: "@pair-crown", back: { frontTemplate: front }, row: switched(dfcBodyRow(back, "wu", "long"), { crown: true, twoColor: true }) });
      add(front, kind, "g", "long", { suffix: "@crown-hd", preset: "hd", row: switched(dfcBodyRow(back, "g", "long"), { crown: true }) });
      add(back, kind, "g", "long", { suffix: "@crown-hd", preset: "hd", back: { frontTemplate: front }, row: switched(dfcBodyRow(back, "g", "long"), { crown: true }) });
    }
  }
  // TODO 5.1b: the modal bodies — NEW cases (new templates, no stored
  // card: no bump). The front bodies come out of the per-template loop
  // above (the modal kind's rows carry a back with a body, so the strip
  // prints the back's type word and its cost / mana line). Here: every
  // BACK body × colour, short and long, baked as the back face — the strip
  // in dark ink on the light strip, a cost on the back (the short spell
  // back is STX #147's sorcery, the long one a creature with the dark
  // plate), the land back's mana line — the stored bake's size, a foil, a
  // square, and the strip's word cases: Equipment (KHM #15's shape), God
  // (its back's), Enchantment (the longest wave-1 type word) and Tibalt.
  for (const body of MDFC_BACK_BODIES) {
    const front: FrameTemplate = body === "m15mdfclandback" ? "m15mdfclandfront" : (MODAL_FRONT_OF[body] ?? "m15mdfcfront");
    for (const colour of VISUAL_COLOURS) {
      add(body, "mdfc", colour, "short", { back: { frontTemplate: front }, row: dfcBodyRow(body, colour) });
      add(body, "mdfc", colour, "long", { back: { frontTemplate: front }, row: dfcBodyRow(body, colour, "long") });
    }
    add(body, "mdfc", "u", "long", { preset: "hd", suffix: "@hd", back: { frontTemplate: front }, row: dfcBodyRow(body, "u", "long") });
  }
  add("m15mdfcfront", "mdfc", "w", "short", { suffix: "@stripequipment", row: MDFC_EQUIPMENT_BACK });
  add("m15mdfcback", "mdfc", "w", "short", { suffix: "@stripgod", back: { frontTemplate: "m15mdfcfront" }, row: MDFC_EQUIPMENT_BACK });
  add("m15mdfcfront", "mdfc", "g", "short", { suffix: "@stripenchantment", row: MDFC_ENCHANTMENT_BACK });
  add("m15mdfcfront", "mdfc", "b", "short", { suffix: "@striptibalt", row: MDFC_TIBALT_BACK });
  add("m15mdfcfront", "mdfc", "r", "short", { finish: "foil", suffix: "@foil", row: dfcBodyRow("m15mdfcback", "r", "short", "foil") });
  add("m15mdfcback", "mdfc", "r", "short", { finish: "foil", suffix: "@foil", back: { frontTemplate: "m15mdfcfront" }, row: dfcBodyRow("m15mdfcback", "r", "short", "foil") });
  add("m15mdfcfront", "mdfc", "u", "short", { corners: "square", suffix: "@square" });
  // TODO 5.1d: the crown and the two-colour frames on the double-faced
  // bodies — NEW cases (opt-in switches no stored card has: no bump). The
  // long row is a Legendary front with a Legendary back on every body, so a
  // crowned case bakes the crown cut round the well / housing — every
  // declared body in the colour keys that pick a different piece (w u b r g,
  // c = the artifact silver, wu = gold with the pair switch off, wub gold),
  // the land front's land-grey `l` crown (c) and a coloured land front; the
  // pairs on every spell face (short: the split dress; long: the pair's
  // split crown over it), the modal front's hybrid dress, and the stored
  // bake's size. The ▼ land back and the modal land pair draw neither.
  const dfcSwitches = (row: Partial<CardRowForBake>, on: { crown?: true; twoColor?: true }): Partial<CardRowForBake> => ({
    ...row,
    frame_style: { ...(row.frame_style as Record<string, unknown>), ...on } as CardRowForBake["frame_style"],
  });
  const DFC_CROWN_COLOURS: readonly VisualColour[] = ["w", "u", "b", "r", "g", "c", "wu", "wub"];
  for (const colour of DFC_CROWN_COLOURS) {
    add("m15dfcfront", "transform", colour, "long", { suffix: "@crown", row: dfcSwitches(dfcBodyRow("m15dfcback", colour, "long"), { crown: true }) });
    add("m15mdfcfront", "mdfc", colour, "long", { suffix: "@crown", row: dfcSwitches(dfcBodyRow("m15mdfcback", colour, "long"), { crown: true }) });
    for (const body of ["m15dfcback", "m15dfcbackleft"] as const) {
      add(body, "transform", colour, "long", { suffix: "@crown", back: { frontTemplate: "m15dfcfront" }, row: dfcSwitches(dfcBodyRow(body, colour, "long"), { crown: true }) });
    }
    add("m15mdfcback", "mdfc", colour, "long", { suffix: "@crown", back: { frontTemplate: "m15mdfcfront" }, row: dfcSwitches(dfcBodyRow("m15mdfcback", colour, "long"), { crown: true }) });
  }
  // The land front: Westvale Abbey's long row is a Legendary land — the
  // land grey crown on a colourless front (c → l), the colour's on a green one.
  for (const colour of ["c", "g"] as const) {
    add("m15dfclandfront", "transform", colour, "long", { suffix: "@crown", row: dfcSwitches(dfcBodyRow("m15dfclandback", colour, "long"), { crown: true }) });
  }
  // The pairs: the split dress on every spell face (short), the pair's
  // crown over it (long, both switches), the modal front's hybrid dress and
  // its crowned twin, the stored bake's size on a front and a back.
  const PAIR_FRONTS = [["m15dfcfront", "transform", "m15dfcback"], ["m15mdfcfront", "mdfc", "m15mdfcback"]] as const;
  for (const [front, kind, back] of PAIR_FRONTS) {
    add(front, kind, "wu", "short", { suffix: "@pair", row: dfcSwitches(dfcBodyRow(back, "wu"), { twoColor: true }) });
    add(front, kind, "wu", "long", { suffix: "@pair-crown", row: dfcSwitches(dfcBodyRow(back, "wu", "long"), { crown: true, twoColor: true }) });
    add(back, kind, "wu", "short", { suffix: "@pair", back: { frontTemplate: front }, row: dfcSwitches(dfcBodyRow(back, "wu"), { twoColor: true }) });
    add(back, kind, "wu", "long", { suffix: "@pair-crown", back: { frontTemplate: front }, row: dfcSwitches(dfcBodyRow(back, "wu", "long"), { crown: true, twoColor: true }) });
  }
  add("m15dfcbackleft", "transform", "wu", "short", { suffix: "@pair", back: { frontTemplate: "m15dfcfront" }, row: dfcSwitches(dfcFamilyRow("m15dfcbackleft", "wu", "sunmoon"), { twoColor: true }) });
  add("m15dfcbackleft", "transform", "wu", "long", { suffix: "@pair-crown", back: { frontTemplate: "m15dfcfront" }, row: dfcSwitches(dfcFamilyRow("m15dfcbackleft", "wu", "sunmoon", "long"), { crown: true, twoColor: true }) });
  add("m15mdfcfront", "mdfc", "wu", "short", { suffix: "@pair-hybrid", row: { ...dfcSwitches(dfcBodyRow("m15mdfcback", "wu"), { twoColor: true }), cost: "{W/U}{W/U}" } });
  add("m15mdfcfront", "mdfc", "wu", "long", { suffix: "@pair-hybrid-crown", row: { ...dfcSwitches(dfcBodyRow("m15mdfcback", "wu", "long"), { crown: true, twoColor: true }), cost: "{X}{W/U}{W/U}{W/U}" } });
  // The transform front draws no hybrid dress: an all-hybrid cost falls to its split.
  add("m15dfcfront", "transform", "wu", "short", { suffix: "@pair-hybrid", row: { ...dfcSwitches(dfcBodyRow("m15dfcback", "wu"), { twoColor: true }), cost: "{W/U}{W/U}" } });
  add("m15dfcfront", "transform", "wu", "long", { suffix: "@pair-crown-hd", preset: "hd", row: dfcSwitches(dfcBodyRow("m15dfcback", "wu", "long"), { crown: true, twoColor: true }) });
  add("m15dfcback", "transform", "wu", "long", { suffix: "@pair-crown-hd", preset: "hd", back: { frontTemplate: "m15dfcfront" }, row: dfcSwitches(dfcBodyRow("m15dfcback", "wu", "long"), { crown: true, twoColor: true }) });
  add("m15mdfcback", "mdfc", "wu", "long", { suffix: "@pair-crown-hd", preset: "hd", back: { frontTemplate: "m15mdfcfront" }, row: dfcSwitches(dfcBodyRow("m15mdfcback", "wu", "long"), { crown: true, twoColor: true }) });
  // The crown at the stored bake's size on a front and on the ▼ back, a
  // foil crown, a crowned front squared (the glyph rides ABOVE the crown on
  // every front and 2016–22 back case: the well is cleared, the order keeps
  // it on top).
  add("m15dfcfront", "transform", "g", "long", { suffix: "@crown-hd", preset: "hd", row: dfcSwitches(dfcBodyRow("m15dfcback", "g", "long"), { crown: true }) });
  add("m15dfcback", "transform", "g", "long", { suffix: "@crown-hd", preset: "hd", back: { frontTemplate: "m15dfcfront" }, row: dfcSwitches(dfcBodyRow("m15dfcback", "g", "long"), { crown: true }) });
  add("m15mdfcfront", "mdfc", "b", "long", { suffix: "@crown-hd", preset: "hd", row: dfcSwitches(dfcBodyRow("m15mdfcback", "b", "long"), { crown: true }) });
  add("m15dfcfront", "transform", "r", "long", { finish: "foil", suffix: "@crown-foil", row: dfcSwitches(dfcBodyRow("m15dfcback", "r", "long", "foil"), { crown: true }) });
  add("m15dfcfront", "transform", "w", "long", { corners: "square", suffix: "@crown-square", row: dfcSwitches(dfcBodyRow("m15dfcback", "w", "long"), { crown: true }) });
  // TODO 5.1c: the flipside strip rider in the OTHER face's colour — NEW
  // cases (an addition no stored card draws; the mono-colour modal cases
  // above stay byte-identical: the rider is drawn only when the other
  // face's key differs from the master's own). A W front // U back on both
  // faces, short, long and at the stored bake's size (the front's strip in
  // blue, the back's in white); a colourless artifact back (the artifact
  // tab, c → a); a W front with a W/U back (gold on the front) and that
  // split back under the W front (its strip white); the pathway (a green
  // land front // white land back); MH3 #252's shape (a hybrid-dressed W/U
  // front // W/U land back: the land grey on both faces).
  const stripRow = (body: FrameTemplate, front: VisualColour, back: VisualColour, shape: VisualShape = "short", backOver: Partial<NonNullable<CardRowForBake["back_face"]>> = {}, frontOver: Partial<CardRowForBake> = {}): Partial<CardRowForBake> => {
    const row = dfcBodyRow(body, back, shape);
    const backFace = row.back_face as Record<string, unknown> & { cost?: string | null };
    const land = body === "m15mdfclandback";
    return {
      ...row,
      color_identity: IDENTITY[front],
      ...(land ? { cost: null, rules_text: `{T}: Add ${pips(front, 0, 1)}.` } : { cost: `{1}${pips(front, 0, 2)}` }),
      ...frontOver,
      back_face: { ...backFace, color_identity: IDENTITY[back], ...(backFace.cost ? { cost: `{3}${pips(back, 0, 2)}` } : {}), ...backOver } as CardRowForBake["back_face"],
    };
  };
  add("m15mdfcfront", "mdfc", "w", "short", { suffix: "@strip-u", row: stripRow("m15mdfcback", "w", "u") });
  add("m15mdfcfront", "mdfc", "w", "long", { suffix: "@strip-u", row: stripRow("m15mdfcback", "w", "u", "long") });
  add("m15mdfcfront", "mdfc", "w", "long", { suffix: "@strip-u-hd", preset: "hd", row: stripRow("m15mdfcback", "w", "u", "long") });
  add("m15mdfcback", "mdfc", "u", "short", { suffix: "@strip-w", back: { frontTemplate: "m15mdfcfront" }, row: stripRow("m15mdfcback", "w", "u") });
  add("m15mdfcback", "mdfc", "u", "long", { suffix: "@strip-w", back: { frontTemplate: "m15mdfcfront" }, row: stripRow("m15mdfcback", "w", "u", "long") });
  add("m15mdfcback", "mdfc", "u", "long", { suffix: "@strip-w-hd", preset: "hd", back: { frontTemplate: "m15mdfcfront" }, row: stripRow("m15mdfcback", "w", "u", "long") });
  add("m15mdfcfront", "mdfc", "w", "short", { suffix: "@strip-a", row: stripRow("m15mdfcback", "w", "c", "short", { title: "Sword of the Realms", card_type: "artifact", subtypes: ["Equipment"], cost: "{3}", rules_text: "Equipped creature gets +2/+0." }) });
  add("m15mdfcfront", "mdfc", "w", "short", { suffix: "@strip-m", row: stripRow("m15mdfcback", "w", "wu") });
  add("m15mdfcback", "mdfc", "wu", "short", { suffix: "@strip-w", back: { frontTemplate: "m15mdfcfront" }, row: stripRow("m15mdfcback", "w", "wu") });
  add("m15mdfclandfront", "mdfc", "g", "short", { suffix: "@strip-w", row: stripRow("m15mdfclandback", "g", "w") });
  add("m15mdfclandback", "mdfc", "w", "short", { suffix: "@strip-g", back: { frontTemplate: "m15mdfclandfront" }, row: stripRow("m15mdfclandback", "g", "w") });
  // …and the borderless modal pair's rider (TODO 5.7): a W front // U back,
  // the front's strip in the light pack's blue tab, the back's in white.
  add("m15borderlessmdfcfront", "mdfc", "w", "short", { suffix: "@strip-u", row: stripRow("m15borderlessmdfcback", "w", "u") });
  add("m15borderlessmdfcback", "mdfc", "u", "short", { suffix: "@strip-w", back: { frontTemplate: "m15borderlessmdfcfront" }, row: stripRow("m15borderlessmdfcback", "w", "u") });
  add("m15mdfcfront", "mdfc", "wu", "short", { suffix: "@strip-l", row: stripRow("m15mdfclandback", "wu", "wu", "short", { rules_text: "{T}: Add {W} or {U}." }, { cost: "{W/U}{W/U}", rules_text: "Draw two cards, then discard a card.", frame_style: { template: "m15mdfcfront", finish: "regular", twoColor: true } as CardRowForBake["frame_style"] }) });
  add("m15mdfclandback", "mdfc", "wu", "short", { suffix: "@strip-c", back: { frontTemplate: "m15mdfcfront" }, row: stripRow("m15mdfclandback", "wu", "wu", "short", { rules_text: "{T}: Add {W} or {U}." }, { cost: "{W/U}{W/U}", rules_text: "Draw two cards, then discard a card.", frame_style: { template: "m15mdfcfront", finish: "regular", twoColor: true } as CardRowForBake["frame_style"] }) });
  // A land STORED on the extended-art spell frame before its land dress
  // existed (TODO 4.7, owner Round 63): the gallery offers the land
  // `extendedartland` now, so the generated `extendedart/g/land-short` left
  // the matrix — this keeps the stored card's look pinned (its hash is the
  // removed case's: the split moved no stored land).
  add("extendedart", "land", "g", "short", { suffix: "@legacyland" });
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
  // TODO 4.21e: the card's text alignment (frame_style.rulesAlign — an
  // ADDITION, opt-in per card; no stored card has the key, so these are NEW
  // cases and every case above stays byte-identical): every line of the
  // card's rules boxes centred — one frame per family the switch reaches,
  // both halves / faces where the frame has two boxes, short and long, and
  // the stored bake's size. The frame's own first kind, in a colour it has.
  const centredStyle = (template: FrameTemplate) => ({
    frame_style: { template, finish: "regular", rulesAlign: "center" } as CardRowForBake["frame_style"],
  });
  const CENTRED: readonly [FrameTemplate, VisualColour][] = [
    ["m15", "w"],
    ["m15land", "g"],
    ["split", "r"],
    ["aftermath", "b"],
    ["flip", "u"],
    ["adventure", "g"],
    ["battle", "r"],
    ["emblem", "c"],
    ["m15tokentext", "w"],
    ["m15dfcfront", "u"],
    ["retro", "r"],
  ];
  for (const [template, colour] of CENTRED) {
    const primary = (hosted.get(template) ?? ["creature"])[0];
    // (A battle's back is optional — TODO 5.5: its centred cases are the
    // one-faced battle's, as before.)
    const twoFaced = Boolean(getFrameProfile(template).dfc) && !getFrameProfile(template).dfc?.battle;
    const dfcRow = twoFaced ? dfcBodyRow("m15dfcback", colour, "short") : {};
    add(template, primary, colour, "short", { suffix: "@centred", row: { ...dfcRow, ...centredStyle(template) } });
    if (!twoFaced) add(template, primary, colour, "long", { suffix: "@centred", row: centredStyle(template) });
  }
  add("split", "split", "r", "short", { suffix: "@centred-hd", preset: "hd", row: centredStyle("split") });
  // TODO 5.5 (a): the battle's back — NEW cases (an addition: no stored
  // battle has a back with a body, and the plain battle cases above, one
  // face, stay byte-identical). The front with a back of its own prints the
  // back's P/T in the master's tab (BATTLE_REVERSE_PT), short and long, the
  // stored bake's size, a back with no P/T (the tab empty), a colourless
  // artifact creature back, the centred text beside the digits; the BACK on
  // the ▼ back in each shape — a creature, a legendary one with the crown
  // switched on (the ten MOM legendary backs), a gold back, an enchantment
  // back (no plate), the HD size. And a LEGACY back (no body: every battle
  // import before 5.5) whose front must bake as the plain battle does.
  for (const colour of ["w", "r", "c"] as const) {
    add("battle", "battle", colour, "short", { suffix: "@back", row: battleBackRow(colour, "short") });
  }
  add("battle", "battle", "u", "long", { suffix: "@back", row: battleBackRow("u", "long") });
  add("battle", "battle", "g", "long", { suffix: "@back-hd", preset: "hd", row: battleBackRow("g", "long") });
  add("battle", "battle", "w", "short", { suffix: "@back-nopt", row: battleBackRow("w", "short", BATTLE_ENCHANTMENT_BACK) });
  add("battle", "battle", "r", "short", { suffix: "@centred-back", row: { ...battleBackRow("r", "short"), ...centredStyle("battle") } });
  add("battle", "battle", "u", "short", { suffix: "@legacyback", row: { back_face: BATTLE_LEGACY_BACK } });
  const battleFront = { frontTemplate: "battle" as FrameTemplate };
  for (const colour of ["w", "r", "c", "wu"] as const) {
    add("m15dfcback", "battle", colour, "short", { suffix: "@battle", back: battleFront, row: battleBackRow(colour, "short") });
  }
  add("m15dfcback", "battle", "b", "long", { suffix: "@crown-battle", back: battleFront, row: dfcSwitches(battleBackRow("b", "long"), { crown: true }) });
  add("m15dfcback", "battle", "w", "short", { suffix: "@battle-nopt", back: battleFront, row: battleBackRow("w", "short", BATTLE_ENCHANTMENT_BACK) });
  add("m15dfcback", "battle", "g", "long", { suffix: "@battle-hd", preset: "hd", back: battleFront, row: battleBackRow("g", "long") });
  // TODO 5.5 (b): the double-faced saga front — NEW cases (an addition: a
  // new template, no stored card; the loop above gives it its colour × shape
  // cases with the ▼ back, TLA #117's shape). NEO's own shape: the fans
  // (frame_style.dfcIcon "fan" — the closed fan in the well, the back on the
  // 2016–22 back with the open fan), a full rail beside the tab, the tab
  // empty under a back with no P/T, a wide P/T, the HD size; and the BACK
  // of each (the 2016–22 and ▼ backs behind a saga front).
  for (const colour of ["w", "r", "b"] as const) {
    add("sagadfcfront", "saga", colour, "short", { suffix: "@fan", row: sagaFanRow(colour, "short") });
  }
  add("sagadfcfront", "saga", "g", "long", { suffix: "@fan", row: sagaFanRow("g", "long") });
  add("sagadfcfront", "saga", "u", "long", { suffix: "@fan-hd", preset: "hd", row: sagaFanRow("u", "long") });
  add("sagadfcfront", "saga", "w", "short", { suffix: "@fan-nopt", row: sagaFanRow("w", "short", SAGA_AURA_BACK) });
  add("sagadfcfront", "saga", "r", "short", { suffix: "@fan-wide-pt", row: sagaFanRow("r", "short", { power: "10", toughness: "10" }) });
  const sagaFront = { frontTemplate: "sagadfcfront" as FrameTemplate };
  for (const colour of ["w", "r"] as const) {
    add("m15dfcbackleft", "saga", colour, "short", { suffix: "@saga", back: sagaFront, row: sagaFanRow(colour, "short") });
    add("m15dfcback", "saga", colour, "short", { suffix: "@saga", back: sagaFront });
  }
  // TODO 5.5 (b), PR 2: the double-faced saga BACK (a transform card whose
  // back face is a Saga — MOM's praetors, LCI #189): baked as the back face
  // of a creature front, every coloured key short and long (the gold pair
  // and the three-colour wedges of LCI #189's dot), the HD size and a foil
  // back. (The colourless key — the saga's land frame under the bronze bars
  // — has no print; it is baked as every master is.)
  for (const colour of VISUAL_COLOURS) {
    add("sagadfcback", "transform", colour, "short", { back: { frontTemplate: "m15dfcfront" }, row: sagaBackRow(colour, "short") });
    add("sagadfcback", "transform", colour, "long", { back: { frontTemplate: "m15dfcfront" }, row: sagaBackRow(colour, "long") });
  }
  add("sagadfcback", "transform", "g", "long", { preset: "hd", suffix: "@hd", back: { frontTemplate: "m15dfcfront" }, row: sagaBackRow("g", "long") });
  add("sagadfcback", "transform", "r", "short", { finish: "foil", suffix: "@foil", back: { frontTemplate: "m15dfcfront" }, row: sagaBackRow("r", "short", "foil") });
  add("m15", "creature", "w", "long", { suffix: "@centred-hd", preset: "hd", row: centredStyle("m15") });
  // TODO 4.30: the white border (frame_style.border — an ADDITION, opt-in
  // per card; no stored card has the key, so these are NEW cases and every
  // case above stays byte-identical): on each of the four frames that draw
  // it — the light, the dark, the gold and the artifact master, the land, a two-colour
  // pair under it, the stored bake's size, both finishes (their masks hold
  // the border) and the squared print (white corners).
  const whiteStyle = (template: FrameTemplate, finish: VisualCase["finish"] = "regular", more: Record<string, unknown> = {}) => ({
    frame_style: { template, finish, border: "white", ...more } as CardRowForBake["frame_style"],
  });
  for (const template of ["retro", "modern"] as const) {
    for (const colour of ["w", "b", "wub", "c"] as const) add(template, "creature", colour, "short", { suffix: "@white", row: whiteStyle(template) });
    add(template, "creature", "r", "long", { suffix: "@white-hd", preset: "hd", row: whiteStyle(template) });
    add(template, "creature", "g", "short", { suffix: "@white-foil", finish: "foil", row: whiteStyle(template, "foil") });
    add(template, "creature", "u", "short", { suffix: "@white-etched", finish: "etched", row: whiteStyle(template, "etched") });
    add(template, "creature", "c", "short", { suffix: "@white-square", corners: "square", row: whiteStyle(template) });
  }
  for (const land of ["retroland", "modernland"] as const) {
    add(land, "land", "c", "short", { suffix: "@white", row: whiteStyle(land) });
    add(land, "land", "g", "long", { suffix: "@white-hd", preset: "hd", row: whiteStyle(land) });
    add(land, "land", "wu", "short", { suffix: "@white-pair", row: { ...whiteStyle(land, "regular", { twoColor: true }), color_identity: ["white", "blue"] } });
  }
  add("modern", "creature", "wu", "short", { suffix: "@white-pair", row: { ...whiteStyle("modern", "regular", { twoColor: true }), color_identity: ["white", "blue"], cost: "{1}{W}{U}" } });
  // TODO 5.5 (c): double-sided tokens — two tokens back to back (owner
  // Round 76). NEW cases (an addition: no stored token has a back with a
  // body, so every token case above stays byte-identical): the FRONT of a
  // pair, which draws exactly as the one-faced token (no icon, no cross-face
  // anything), and the BACK on its own token template in the front's design
  // and its own colour — GK1 #4's Soldier behind a red Goblin (the text-box
  // arch), F17 #11's Treasure behind a green Dinosaur (the artifact text-box
  // arch), Q07 #T12's Blood behind a red full-art Goblin, MOM #16's
  // Phyrexian behind the Incubator (the full-art artifact token, the plain
  // pair: the transform icons are 5.5 (d)), a gold back (GK1 #1's Horror),
  // and the stored bake's size.
  add("m15token", "token", "r", "short", { suffix: "@two-sided-front", row: tokenPairRow("m15token", "r", PAIR_SOLDIER) });
  add("m20tokenartifacttext", "token", "c", "short", { suffix: "@two-sided-front", row: tokenPairRow("m20tokenartifacttext", "c", PAIR_PHYREXIAN, INCUBATOR) });
  add("m15tokentext", "token", "w", "short", { suffix: "@two-sided", back: { frontTemplate: "m15token" }, row: tokenPairRow("m15token", "r", PAIR_SOLDIER) });
  add("m15tokenartifacttext", "token", "c", "short", { suffix: "@two-sided", back: { frontTemplate: "m15tokentext" }, row: tokenPairRow("m15tokentext", "g", PAIR_TREASURE) });
  add("m15tokentext", "token", "wu", "short", { suffix: "@two-sided", back: { frontTemplate: "m15token" }, row: tokenPairRow("m15token", "c", PAIR_HORROR) });
  add("m20tokenartifacttext", "token", "c", "short", { suffix: "@two-sided", back: { frontTemplate: "m20token" }, row: tokenPairRow("m20token", "r", PAIR_BLOOD) });
  add("m20tokenartifact", "token", "c", "short", { suffix: "@two-sided", back: { frontTemplate: "m20tokenartifacttext" }, row: tokenPairRow("m20tokenartifacttext", "c", PAIR_PHYREXIAN, INCUBATOR) });
  add("m20tokenartifact", "token", "c", "short", { suffix: "@two-sided-hd", preset: "hd", back: { frontTemplate: "m20tokenartifacttext" }, row: tokenPairRow("m20tokenartifacttext", "c", PAIR_PHYREXIAN, INCUBATOR) });
  cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return cases;
}

/** The templates whose PROFILES entry declares the holofoil stamp's notch
 *  (TODO 4.9c; tests/unit/render/visual-matrix.test.ts keeps it in step). */
// …and the station frame (TODO 4.27a): the parents' notch over the cut masters.
export const STAMP_TEMPLATES: readonly FrameTemplate[] = [
  "m15", "m15land", "m15snowland", "m15artifact", "m15vehicle", "m15nyx", "m15station", "m15stationland", "m15snow", "m15devoid", "m15pw",
  // TODO 4.27a step 2: the Spacecraft's extended-art dress (M15's bottom border).
  "extendedartstation",
  // TODO 4.25: the Universes Beyond frames' TRIANGLE stamp.
  "m15ub", "m15ubartifact", "m15ubland",
  // TODO 4.9d: the borderless frames' arch (our own lifted pinline).
  "m15borderless", "m15borderlessartifact", "m15borderlessland", "m15borderlessstation",
  // …and the borderless walkers' (owner Round 70: the window's arch, drawn
  // above the ability rows).
  "m15borderlesspw", "m15borderlesspwtall",
  // TODO 4.11: the Lord of the Rings scroll's triangle notch (the pack's own
  // piece per key).
  "lotrscroll",
  // TODO 4.11: the Zendikar Rising hedron showcase — the notch split off its
  // own masters.
  "fullart",
  // …and the ring's.
  "lotr",
  // …and the MUL Tarkir dragon wings' oval.
  "tarkirdragon",
  // …and the Tarkir draconic's MSE oval (TODO 4.11, layout v68).
  "tarkirdraconic",
  // …and the Bloomburrow woodland's (TODO 4.11, layout v69).
  "bloomburrow",
  // …and the Bloomburrow anime's (TODO 4.11 / 4.35, layout v70).
  "bloomanime",
  // …and the D&D Sourcebook's oval (TODO 4.11 wave 2: the pack's one piece).
  "dndsourcebook",
  // …and the MKM dossier's oval (TODO 4.11 wave 2: the pack's one piece).
  "dossier",
  // …and the OTJ Breaking News' oval (TODO 4.11 wave 2: the pack's one tab).
  "breakingnews",
];

/** The templates with BOTH the notch and pair masters — the pair notch's
 *  cases (the 4.9c follow-up; the same test keeps it in step: a template
 *  that gains pairs with the notch declared joins by itself). */
export const STAMP_PAIR_TEMPLATES: readonly FrameTemplate[] = [
  "m15", "m15artifact", "m15vehicle", "m15nyx", "m15land", "m15snow", "m15snowland",
  "m15ub", "m15ubartifact", "m15ubland",
  // TODO 4.9d: the borderless pairs (the split pinline; the land's own).
  "m15borderless", "m15borderlessartifact", "m15borderlessland",
  // TODO 4.11 wave 2: the MKM dossier — its pair masters under the pack's
  // one notch piece (a pair draws m's).
  "dossier",
  // TODO 4.11 wave 2: the OTJ Breaking News — its pair masters under the
  // pack's one notch tab.
  "breakingnews",
];

/** A rules text whose fitted last line enters the arch on m15 (found on the
 *  real layout, 2026-10-02: 50 px, the last line's ink 132–839 × …–1910 at
 *  HD, into the keep-out from 1905; with the arch the ladder steps to 48).
 *  tests/unit/render/holo-stamp-bake.test.tsx reads the same text. */
/** A walker whose LAST ability is long enough to run into the borderless
 *  walkers' arch at full size (TODO 4.9d): the last row is held up over it. */
export const WALKER_STAMP_ARCH_ROWS =
  "+1: Scry 2.\n−3: Return target creature card from your graveyard to your hand.\n−8: You get an emblem with \"Whenever you cast a spell, copy it. You may choose new targets for the copy, and creatures you control get +2/+2 and gain flying, vigilance and trample.\"";
/** …and on the tall frame (four rows). */
export const WALKER_STAMP_ARCH_ROWS_TALL =
  "Creatures you control have ward 1.\n+1: Scry 2.\n−3: Return target creature card from your graveyard to your hand.\n−8: You get an emblem with \"Whenever you cast a spell, copy it. You may choose new targets for the copy, and creatures you control get +2/+2 and gain flying, vigilance and trample.\"";

export const STAMP_ARCH_RULES =
  "Flying, vigilance, deathtouch, lifelink, haste\nWhenever Kesh attacks, each opponent loses 2 life and you gain 2 life. Then if an opponent has 10 or less life, exile the top card of their library and you may play it this turn.\nWhenever a creature you control dies, draw a card, then discard a card unless you control a Phyrexian.\n{2}{B}: Kesh gets +2/+2 until end of turn. Activate only once each turn. The ancient ward endures beyond the last ember of the forge and every";

/** KHM #15 Halvar, God of Battle // Sword of the Realms's shape (TODO
 *  5.1b): a white creature front whose strip says "Equipment · {1}{W}", a
 *  costed artifact back whose strip says "God · {2}{W}{W}". */
const MDFC_EQUIPMENT_BACK: Partial<CardRowForBake> = {
  title: "Halvar, God of Battle",
  card_type: "creature",
  supertype: "Legendary",
  subtypes: ["God"],
  cost: "{2}{W}{W}",
  rules_text: "Creatures you control that are enchanted or equipped have double strike.\nAt the beginning of each combat, you may attach target Aura or Equipment attached to a creature you control to target creature you control.",
  power: "4",
  toughness: "4",
  frame_style: { template: "m15mdfcfront", finish: "regular" },
  back_face: {
    title: "Sword of the Realms",
    cost: "{1}{W}",
    card_type: "artifact",
    supertype: "Legendary",
    subtypes: ["Equipment"],
    rules_text: "Equipped creature gets +2/+0 and has vigilance.\nWhenever equipped creature dies, return it to its owner's hand.\nEquip {1}{W}",
    art_url: "ART2",
    artist_credit: "Visual Regression",
    frame_style: { template: "m15mdfcback" },
    color_identity: ["white"],
  },
};

/** The longest wave-1 type word on the strip: an Enchantment back (an aura,
 *  MH3 #254 Glasswing Grace's shape turned round) on a green creature. */
const MDFC_ENCHANTMENT_BACK: Partial<CardRowForBake> = {
  title: "Strength of the Harvest",
  card_type: "creature",
  supertype: null,
  subtypes: ["Elf", "Druid"],
  cost: "{2}{G}",
  rules_text: "Whenever another creature you control enters, put a +1/+1 counter on it.",
  power: "2",
  toughness: "3",
  frame_style: { template: "m15mdfcfront", finish: "regular" },
  back_face: {
    title: "Haven of the Harvest",
    cost: "{2}{G}{G}",
    card_type: "enchantment",
    subtypes: [],
    rules_text: "At the beginning of your end step, create a 1/1 green Elf Warrior creature token.",
    art_url: "ART2",
    artist_credit: "Visual Regression",
    frame_style: { template: "m15mdfcback" },
    color_identity: ["green"],
  },
};

/** KHM #114 Valki, God of Lies's shape: the strip's word is the back's
 *  Tibalt subtype (a walker back is wave 2's body: the back here is drawn
 *  as a creature-less enchantment so only the word is under test). */
const MDFC_TIBALT_BACK: Partial<CardRowForBake> = {
  title: "Valki, God of Lies",
  card_type: "creature",
  supertype: "Legendary",
  subtypes: ["God"],
  cost: "{1}{B}",
  rules_text: "When Valki, God of Lies enters, each opponent reveals their hand.",
  power: "2",
  toughness: "1",
  frame_style: { template: "m15mdfcfront", finish: "regular" },
  back_face: {
    title: "Tibalt, Cosmic Impostor",
    cost: "{5}{B}{R}",
    card_type: "enchantment",
    supertype: "Legendary",
    subtypes: ["Tibalt"],
    rules_text: "Emblem — You may play cards exiled with Tibalt, and you may spend mana as though it were mana of any color to cast those spells.",
    art_url: "ART2",
    artist_credit: "Visual Regression",
    frame_style: { template: "m15mdfcback" },
    color_identity: ["black", "red"],
  },
};

/** The holofoil stamp's switch on a case (TODO 4.9c): `frame_style.stamp`
 *  and the rarity the auto rule reads, on top of a stored row — nothing
 *  else on the row changes. */
/** A battle row's BACK of its own (TODO 5.5): the ▼ back the battle derives
 *  (lib/cards/dfc.ts bodyFor — a battle wears no family) in `colour` (a
 *  two-colour back on a mono front, as MOM #23 Invasion of Theros), its art
 *  and artist. Short: MOM #21's Serra Faithkeeper (4/4, flying, vigilance);
 *  long: a legendary back (MOM #114 Marchesa's shape, a long name and the
 *  dense rules; 3/3 and a three-word subtype line — a short line beside the
 *  set symbol, and a kerned value like 3/6 on the dark plate, draw a few px
 *  apart in the two renderers on every ▼ back, transform's too: reported,
 *  not this case's to hold); colourless: MOM #1's Guildpact Paragon, an
 *  Artifact Creature. `over` replaces the back's content (an enchantment
 *  back). */
function battleBackRow(colour: VisualColour, shape: VisualShape, over: Partial<NonNullable<CardRowForBake["back_face"]>> = {}): Partial<CardRowForBake> {
  const long = shape === "long";
  const front = colour === "wu" ? "w" : colour;
  return {
    frame_style: { template: "battle", finish: "regular" } as CardRowForBake["frame_style"],
    color_identity: IDENTITY[front],
    back_face: {
      title: long ? "Marchesa, Resolute Monarch of the Shattered Sky" : colour === "c" ? "Guildpact Paragon" : "Serra Faithkeeper",
      cost: "",
      card_type: "creature",
      supertype: colour === "c" ? "Artifact" : long ? "Legendary" : null,
      subtypes: colour === "c" ? ["Construct"] : long ? ["Human", "Noble", "Advisor"] : ["Angel"],
      rules_text: long ? LONG_RULES : "Flying, vigilance",
      flavor_text: long ? null : "“I was there when Phyrexia doomed Serra’s realm with a single touch.”",
      power: long ? "3" : colour === "c" ? "5" : "4",
      toughness: long ? "3" : colour === "c" ? "5" : "4",
      frame_style: { template: "m15dfcback" as FrameTemplate },
      color_identity: IDENTITY[colour],
      art_url: "ART2",
      artist_credit: "Visual Regression",
      ...over,
    } as CardRowForBake["back_face"],
  };
}

/** A double-sided token's back (TODO 5.5 (c)): the token's content, its
 *  body — a token template in the front's design (lib/creator/token-back.ts
 *  derives the same) — and its own colour. */
type TokenPairBack = { body: FrameTemplate; colour: VisualColour; face: Partial<NonNullable<CardRowForBake["back_face"]>> };
const PAIR_SOLDIER: TokenPairBack = { body: "m15tokentext", colour: "w", face: { title: "Soldier", supertype: "Creature", subtypes: ["Soldier"], rules_text: "Lifelink", power: "1", toughness: "1" } };
const PAIR_TREASURE: TokenPairBack = { body: "m15tokenartifacttext", colour: "c", face: { title: "Treasure", supertype: "Artifact", subtypes: ["Treasure"], rules_text: "{T}, Sacrifice this artifact: Add one mana of any color." } };
const PAIR_HORROR: TokenPairBack = { body: "m15tokentext", colour: "wu", face: { title: "Horror", supertype: "Creature", subtypes: ["Horror"], rules_text: "Flying", power: "1", toughness: "1" } };
const PAIR_BLOOD: TokenPairBack = { body: "m20tokenartifacttext", colour: "c", face: { title: "Blood", supertype: "Artifact", subtypes: ["Blood"], rules_text: "{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card." } };
const PAIR_PHYREXIAN: TokenPairBack = { body: "m20tokenartifact", colour: "c", face: { title: "Phyrexian", supertype: "Artifact Creature", subtypes: ["Phyrexian"], rules_text: null, power: "0", toughness: "0" } };
/** MOM #16's front: the Incubator (its 0/0 and ▲ are 5.5 (d)'s). */
const INCUBATOR: Partial<CardRowForBake> = { title: "Incubator", supertype: "Artifact", subtypes: ["Incubator"], rules_text: "{2}: Transform this artifact.", flavor_text: null, power: null, toughness: null };

/** A token front on `frontTemplate` in `frontColour` with a token back of its
 *  own. The front is the case's own token content unless `front` says. */
function tokenPairRow(frontTemplate: FrameTemplate, frontColour: VisualColour, back: TokenPairBack, front: Partial<CardRowForBake> = {}): Partial<CardRowForBake> {
  return {
    frame_style: { template: frontTemplate, finish: "regular" } as CardRowForBake["frame_style"],
    color_identity: IDENTITY[frontColour],
    ...front,
    back_face: {
      title: "",
      cost: "",
      card_type: "token",
      supertype: null,
      subtypes: [],
      rules_text: null,
      flavor_text: null,
      power: null,
      toughness: null,
      ...back.face,
      frame_style: { template: back.body },
      color_identity: IDENTITY[back.colour],
      art_url: "ART2",
      artist_credit: "Visual Regression",
    } as CardRowForBake["back_face"],
  };
}

/** An enchantment back (MOM #20 Belenon War Anthem): no P/T — the front's
 *  tab prints empty, the back draws no plate. */
const BATTLE_ENCHANTMENT_BACK: Partial<NonNullable<CardRowForBake["back_face"]>> = {
  title: "Belenon War Anthem",
  card_type: "enchantment",
  supertype: null,
  subtypes: [],
  rules_text: "Creatures you control get +1/+1.",
  flavor_text: null,
  power: null,
  toughness: null,
};

/** A double-faced saga's back (TODO 5.5 (b)) on `body`: NEO #141's
 *  Reflection of Kiki-Jiki (an Enchantment Creature 2/2) short, a long
 *  legendary back (TLA #117's Fire Lord Sozin shape, 5/5) long. */
function sagaBackFace(shape: VisualShape, colour: VisualColour, body: FrameTemplate): CardRowForBake["back_face"] {
  const long = shape === "long";
  return {
    title: long ? "Fire Lord Sozin, Herald of the Comet's Long Shadow" : "Reflection of Kiki-Jiki",
    cost: "",
    card_type: "creature",
    supertype: long ? "Legendary" : "Enchantment",
    subtypes: long ? ["Human", "Noble"] : ["Goblin", "Shaman"],
    rules_text: long ? LONG_RULES : "{1}, {T}: Create a token that's a copy of another target nonlegendary creature you control, except it has haste. Sacrifice it at the beginning of the next end step.",
    flavor_text: null,
    power: long ? "5" : "2",
    toughness: long ? "5" : "2",
    frame_style: { template: body },
    color_identity: IDENTITY[colour],
    art_url: "ART2",
    artist_credit: "Visual Regression",
  } as unknown as CardRowForBake["back_face"];
}

/** A saga row on the double-faced saga front with NEO's fans: the closed
 *  fan in the well (frame_style.dfcIcon "fan"), the back on the 2016–22
 *  back the family derives. Long: Fable of the Mirror-Breaker's full rail
 *  (a reminder, three long chapters) beside the tab. `over` replaces the
 *  back's content. */
function sagaFanRow(colour: VisualColour, shape: VisualShape, over: Partial<NonNullable<CardRowForBake["back_face"]>> = {}): Partial<CardRowForBake> {
  const long = shape === "long";
  return {
    frame_style: { template: "sagadfcfront", finish: "regular", dfcIcon: "fan" } as CardRowForBake["frame_style"],
    ...(long
      ? {
          title: "Fable of the Mirror-Breaker",
          face_content: {
            v: 1,
            saga: {
              intro: "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)",
              chapters: [
                { numerals: [1], text: "Create a 2/2 red Goblin Shaman creature token with “Whenever this creature attacks, create a Treasure token.”" },
                { numerals: [2], text: "You may discard up to two cards. If you do, draw that many cards." },
                { numerals: [3], text: "Exile this Saga, then return it to the battlefield transformed under your control." },
              ],
            },
          },
        }
      : {}),
    back_face: { ...(sagaBackFace(shape, colour, "m15dfcbackleft") as object), ...over } as CardRowForBake["back_face"],
  } as Partial<CardRowForBake>;
}

/** A transform card whose BACK is a Saga (TODO 5.5 (b), PR 2: MOM #12 Elesh
 *  Norn // The Argent Etchings's shape) — the front a creature on the
 *  transform front, the back an enchantment Saga on the double-faced saga
 *  back, its chapters as PLAIN text (a back face has no structured rows:
 *  lib/cards/faces.ts backPreviewData). The long one: four chapters (LCI
 *  #189's), a long name. */
function sagaBackRow(colour: VisualColour, shape: VisualShape, finish: VisualCase["finish"] = "regular"): Partial<CardRowForBake> {
  const long = shape === "long";
  return {
    title: "Elesh Norn",
    cost: `{2}${pips(colour, 0, 2)}`,
    card_type: "creature",
    supertype: "Legendary",
    subtypes: ["Phyrexian", "Praetor"],
    rules_text: "Vigilance\nWhenever a source an opponent controls deals damage to you or a permanent you control, that source's controller loses 2 life unless they pay {1}.",
    power: "4",
    toughness: "7",
    frame_style: { template: "m15dfcfront", finish } as CardRowForBake["frame_style"],
    face_content: null,
    back_face: {
      title: long ? "The Argent Etchings of the Machine Unbound" : "The Argent Etchings",
      cost: "",
      card_type: "enchantment",
      supertype: null,
      subtypes: ["Saga"],
      rules_text: long
        ? "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after IV.)\nI — Create two 3/3 green Dinosaur creature tokens.\nII — Roar of the Fifth People gains “Creatures you control have ‘{T}: Add {R}, {G}, or {W}.’”\nIII — Search your library for a Dinosaur card, reveal it, put it into your hand, then shuffle.\nIV — Dinosaurs you control gain double strike and trample until end of turn."
        : "(As this Saga enters and after your draw step, add a lore counter.)\nI — Incubate 2 five times, then transform all Incubator tokens you control.\nII — Creatures you control get +1/+1 and gain double strike until end of turn.\nIII — Destroy all other permanents except for artifacts, lands, and Phyrexians. Exile The Argent Etchings, then return it to the battlefield (front face up).",
      flavor_text: null,
      power: null,
      toughness: null,
      art_url: "ART2",
      artist_credit: "Visual Regression",
      frame_style: { template: "sagadfcback" },
      color_identity: IDENTITY[colour],
    } as CardRowForBake["back_face"],
  } as Partial<CardRowForBake>;
}

/** A saga's back with no P/T (an Aura): the front's tab prints empty. */
const SAGA_AURA_BACK: Partial<NonNullable<CardRowForBake["back_face"]>> = {
  title: "Imperial Oath",
  card_type: "enchantment",
  supertype: null,
  subtypes: ["Aura"],
  rules_text: "Enchant creature\nEnchanted creature gets +2/+2.",
  power: null,
  toughness: null,
};

/** A battle's LEGACY back (no body, no colour — what every battle import
 *  stored before TODO 5.5): drawn on the battle frame by the flip, never
 *  baked; the front bakes as the one-faced battle. */
const BATTLE_LEGACY_BACK = {
  title: "Belenon War Anthem",
  cost: "",
  card_type: "enchantment",
  subtypes: [],
  rules_text: "Creatures you control get +1/+1.",
} as unknown as CardRowForBake["back_face"];

function stampRow(
  template: FrameTemplate,
  stamp: "auto" | "oval" | "triangle" | "none",
  over: Partial<CardRowForBake> = {},
): Partial<CardRowForBake> {
  const finish = (over.frame_style as { finish?: VisualCase["finish"] } | undefined)?.finish ?? "regular";
  return {
    ...over,
    frame_style: { template, finish, ...((over.frame_style as object | undefined) ?? {}), stamp },
  };
}

/** The transform BACK bodies (TODO 5.1a; FrameProfile.dfc role "back"). */
export const DFC_BACK_BODIES: readonly FrameTemplate[] = ["m15dfcback", "m15dfcbackleft", "m15dfclandback"];
/** The modal BACK bodies (TODO 5.1b). */
export const MDFC_BACK_BODIES: readonly FrameTemplate[] = ["m15mdfcback", "m15mdfclandback", "m15borderlessmdfcback"];
/** The borderless BACK bodies (TODO 5.7) and the front each pairs with. */
export const BORDERLESS_DFC_BACK_BODIES: readonly FrameTemplate[] = ["m15borderlessdfcback", "m15borderlessmdfcback"];
const TRANSFORM_FRONT_OF: Partial<Record<FrameTemplate, FrameTemplate>> = { m15borderlessdfcback: "m15borderlessdfcfront" };
const MODAL_FRONT_OF: Partial<Record<FrameTemplate, FrameTemplate>> = { m15borderlessmdfcback: "m15borderlessmdfcfront" };

/** The family whose default back is `body` (lib/cards/dfc.ts bodyFor). */
function dfcFamilyFor(body: FrameTemplate): DfcIconFamily {
  return body === "m15dfcbackleft" ? "sunmoon" : "arrows";
}

/** The row fields that put a transform row's back on `body` in `colour`:
 *  the family that derives it and the back's own body and colour (the
 *  content is transformContent's, in the case's SHAPE — the long back's
 *  dense rules, long name and 12/12 on a long case; the first matrix gave
 *  every back case the short back, so the long back cases were the short
 *  ones pixel for pixel). */
function dfcBodyRow(body: FrameTemplate, colour: VisualColour, shape: VisualShape = "short", finish: VisualCase["finish"] = "regular"): Partial<CardRowForBake> {
  return dfcFamilyRow(body, colour, dfcFamilyFor(body), shape, finish);
}

/** `finish` rides on the row's frame_style: this row REPLACES rowFor's
 *  (the first matrix's two "@foil" cases baked regular — their row override
 *  carried `finish: "regular"` over the case's foil). */
function dfcFamilyRow(body: FrameTemplate, colour: VisualColour, family: DfcIconFamily, shape: VisualShape = "short", finish: VisualCase["finish"] = "regular"): Partial<CardRowForBake> {
  // A modal back body (TODO 5.1b): the modal row's back on it, in the
  // case's colour — no family (the housing has none). The land back's
  // cases are the pathway's shape (both faces lands); the spell back's the
  // long creature // creature (a cost on the back) or the short instant
  // front with the back retyped onto the spell back.
  if ((MDFC_BACK_BODIES as readonly string[]).includes(body)) {
    const landBack = body === "m15mdfclandback";
    // (The back on THIS body: a borderless back's long case drew the bordered
    // m15mdfcback, modalContent's default, before the skeptic check of #578.)
    const content = modalContent(shape, colour, landBack, landBack ? undefined : body);
    const back = landBack
      ? content.back_face
      : shape === "long"
        ? content.back_face
        : {
            ...(content.back_face as NonNullable<CardRowForBake["back_face"]>),
            title: "Echoing Equation",
            cost: `{3}${pips(colour, 0, 2)}`,
            card_type: "sorcery" as const,
            subtypes: [],
            rules_text: "Choose target creature you control. Each other creature you control becomes a copy of it until end of turn, except those creatures aren't legendary if the chosen creature is legendary.",
            frame_style: { template: body },
          };
    return {
      frame_style: { template: landBack ? "m15mdfclandfront" : (MODAL_FRONT_OF[body] ?? "m15mdfcfront"), finish },
      back_face: back as CardRowForBake["back_face"],
    };
  }
  const land = body === "m15dfclandback";
  const long = shape === "long";
  const front: FrameTemplate = land ? "m15dfclandfront" : (TRANSFORM_FRONT_OF[body] ?? "m15dfcfront");
  // The land BACK's cases are FIN #31's shape — a land // land (Cooking
  // Campsite: a mana ability, no P/T), so the land front's tab is empty
  // there; the land front's own loop cases keep INR #287's creature back.
  // The long land back: a long legendary name and the long flavor on the
  // same abilities.
  const back = land
    ? {
        title: long ? "Cooking Campsite of the Wandering Chocobo Riders" : "Cooking Campsite",
        cost: "",
        card_type: "land" as const,
        ...(long ? { supertype: "Legendary" } : {}),
        subtypes: [],
        rules_text: "{T}: Add {W}.\n{3}, {T}, Sacrifice an artifact: Put a +1/+1 counter on each creature you control. Activate only as a sorcery.",
        flavor_text: long ? LONG_FLAVOR : "\"Seeing how you enjoy fishing, you should learn how to prepare your catch.\"\n—Ignis Scientia",
        art_url: "ART2",
        artist_credit: "Visual Regression",
        frame_style: { template: body },
        color_identity: IDENTITY[colour],
      }
    : {
        ...(transformContent(shape, colour, false).back_face as NonNullable<CardRowForBake["back_face"]>),
        frame_style: { template: body },
        color_identity: IDENTITY[colour],
      };
  // The default family (`arrows`) is never stored: a plain transform row
  // names no `dfcIcon` (lib/cards/faces.ts dfcIconOf reads it as arrows).
  return {
    frame_style: family === "arrows" ? { template: front, finish } : { template: front, finish, dfcIcon: family },
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
export const PAIR_TEMPLATES: readonly FrameTemplate[] = [
  "m15", "m15artifact", "m15land", "m15borderless", "m15borderlessartifact", "m15borderlessland", "m15snow", "m15snowland",
  // The Vehicle frame (TODO 4.5c): m15artifact's split over the bronze frame.
  "m15vehicle",
  // The Nyx dress (TODO 4.7): m15's split and hybrid over the starfield.
  "m15nyx",
  // The Universes Beyond frames (TODO 4.25): their M15 twins' dresses.
  "m15ub", "m15ubartifact", "m15ubland",
  // The extended-art frame and its land dress (TODO 4.7 follow-up, owner
  // Round 63): m15's two dresses over the extended pack, the land's split.
  "extendedart", "extendedartland",
  // The double-faced spell faces (5.1d): their cases carry a back face
  // (the DFC block below), never the generic pair loop's rows.
  "m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15mdfcfront", "m15mdfcback",
  // …and the borderless double-faced bodies (TODO 5.7), the same way.
  "m15borderlessdfcfront", "m15borderlessdfcback", "m15borderlessmdfcfront", "m15borderlessmdfcback",
  // The old frames (TODO 4.6h): the 2003 gold card, the 2003 and the 1997
  // two-colour lands.
  "modern", "modernland", "retroland",
  // The full-art tokens (TODO 4.48's central split): the six templates.
  "m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall",
  // The Prepare frame (TODO 4.26): m15's pairs with the page, both dresses.
  "prepare",
  // The MKM dossier (TODO 4.11 wave 2): the pack's two colour frames lerped
  // across print's ramp, and its crown's pairs.
  "dossier",
  // The OTJ Breaking News (TODO 4.11 wave 2): the same across print's
  // split, and its crown's pairs.
  "breakingnews",
];

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
