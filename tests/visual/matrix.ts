import { createHash } from "node:crypto";
import type { CardRowForBake } from "@/lib/cards/bake-core";
import { artReachesCardEdge, getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_COLOR_KEYS, frameComboKey } from "@/lib/cards/frame-reference-registry";
import { BASIC_LAND_NAME_BY_KEY } from "@/lib/cards/watermark";
import { CARD_KIND_VALUES, KIND_DEFS, framesForKind, type CardKind } from "@/lib/creator/card-kinds";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

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
//     the empty box is drawn in the slot).
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
  saga: "r",
  adventure: "g",
  split: "wu",
  aftermath: "b",
  flip: "r",
};

const LONG_RULES =
  "Flying, vigilance, lifelink\nWhenever this creature attacks, choose one —\n• Draw a card, then discard a card.\n• Create a 1/1 white Spirit creature token with flying.\n{2}{W/U}, {T}: Scry 2. (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)";
const LONG_FLAVOR = "\"The sky remembers every wing that crossed it.\"\n—Captain Sisay";

type Fields = Partial<CardRowForBake>;

/** The content of one kind in one shape — a stored row's text columns. */
function contentFor(kind: CardKind, shape: VisualShape, colour: VisualColour): Fields {
  const long = shape === "long";
  const key = frameKeyOf(colour);
  switch (kind) {
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

/** A stored row for one case. */
function rowFor(template: FrameTemplate, kind: CardKind, colour: VisualColour, shape: VisualShape, finish: VisualCase["finish"], id: string): CardRowForBake {
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
    frame_style: { template, finish },
    // A Keyrune preset on the long card (the drawn set symbol); the short
    // card prints the default mark.
    set_icon_url: null,
    set_icon_code: long ? "dmu" : null,
    back_face: null,
    face_content: null,
    watermark: long && colour !== "wu" && colour !== "wub" ? { kind: "mana", key: frameKeyOf(colour) } : null,
    ...contentFor(kind, shape, colour),
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
];
/** No ability text on a borderless walker (TODO 4.33, owner round 15): its
 *  see-through window shows the light first stripe, never the bare art. */
const NO_TEXT_CASES: readonly [FrameTemplate, VisualColour][] = [
  ["m15borderlesspw", "w"],
  ["m15borderlesspwtall", "wub"],
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

/** The input fingerprint of a case (VisualCase.input). */
export function caseInput(c: Pick<VisualCase, "row" | "preset" | "corners">): string {
  return createHash("sha256")
    .update(canonical({ harness: VISUAL_HARNESS, row: c.row, preset: c.preset, corners: c.corners }))
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
    } = {},
  ) => {
    const id = caseId(template, colour, kind, shape, extra.suffix);
    const finish = extra.finish ?? "regular";
    const preset = extra.preset ?? "default";
    const corners = extra.corners ?? "round";
    const row = {
      ...rowFor(template, kind, colour, shape, finish, id),
      ...(extra.noArt ? { art_url: null } : {}),
      ...(extra.noText ? { rules_text: null, flavor_text: null, face_content: null } : {}),
    };
    cases.push({
      id,
      input: caseInput({ row, preset, corners }),
      printOnly: corners === "square",
      template,
      kind,
      colour,
      shape,
      preset,
      corners,
      finish,
      row,
    });
  };
  const hosted = kindsByTemplate();
  for (const template of FRAME_TEMPLATE_VALUES) {
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
  for (const [template, colour] of SQUARE_CASES) {
    const primary = (hosted.get(template) ?? ["creature"])[0];
    add(template, primary, colour, "short", { corners: "square", suffix: "@square" });
  }
  cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return cases;
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
