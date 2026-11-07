import type { ScryfallCard } from "@/lib/scryfall/client";
import { emblemTitleFromName, typeLineWords } from "@/lib/scryfall/import-mapper";
import { tokenSpecsFromRulesText, type TextTokenSpec, type TokenPart } from "@/lib/decks/deck-tokens";
import { KIT_FACE_COLORS, type KitFace, type KitFaceColor, type KitItemKind } from "@/lib/tools/token-kit/model";

// ---------------------------------------------------------------------------
// The Token Kit's list (lib/tools/token-kit/model.ts): what a deck's cards
// make, ONE item per distinct token — a Treasure made by three cards (or two
// printings of one Treasure) is one item with three makers — and how many of
// each a game needs, as a SUGGESTION the maker changes freely.
//
// Two sources, as the deck page's "Tokens & emblems" (lib/decks/deck-tokens.ts):
//   * a REAL card: Scryfall's `all_parts` (tokenPartsOf: tokens, emblems and
//     helper cards) → the token PRINTINGS themselves (their own words, text,
//     colours and stats — `all_parts` names only the name and type line),
//     each face of a double-faced token or helper its own item (Day and
//     Night print as two cards);
//   * a PipGlyph card: its own text in the standard templates
//     (tokenSpecsFromRulesText), the predefined artifact tokens with their
//     printed rules.
// The art is never Scryfall's: every kit picture is the maker's own (an
// upload or an AI picture). Pure and client-safe.
// ---------------------------------------------------------------------------

const LETTER_COLOR: Record<string, KitFaceColor> = { W: "white", U: "blue", B: "black", R: "red", G: "green", C: "colorless" };

function colorsOfLetters(letters: readonly (string | null | undefined)[] | null | undefined): KitFaceColor[] {
  const out: KitFaceColor[] = [];
  for (const letter of letters ?? []) {
    const color = LETTER_COLOR[(letter ?? "").toUpperCase()];
    if (color && !out.includes(color)) out.push(color);
  }
  return KIT_FACE_COLORS.filter((color) => out.includes(color));
}

function clip(text: string | null | undefined, max: number): string | null {
  const trimmed = text?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** The kind a printed face is, by its type line ("Token …", "Emblem …",
 *  "Card" / "Dungeon …"), or null for anything else. */
function faceKindOf(typeLine: string | null | undefined): KitItemKind | null {
  const line = (typeLine ?? "").trim();
  if (/^token\b/i.test(line)) return "token";
  if (/^emblem\b/i.test(line)) return "emblem";
  if (/^(?:card|dungeon)\b/i.test(line) && !/^card\s*—/i.test(line)) return "helper";
  return null;
}

type PrintedFace = {
  name: string;
  type_line?: string | null;
  oracle_text?: string | null;
  flavor_text?: string | null;
  power?: string | null;
  toughness?: string | null;
  colors?: string[] | null;
  color_indicator?: string[] | null;
};

function faceFromPrinted(face: PrintedFace, fallbackColors: string[] | null | undefined): KitFace | null {
  const kind = faceKindOf(face.type_line);
  if (!kind) return null;
  const { subtypes } = typeLineWords(face.type_line);
  // The words left of the dash, without "Token" / "Emblem" / "Card": a
  // token's type words ("Legendary Artifact Creature"), a helper's
  // "Dungeon".
  const left = (face.type_line ?? "").split("//")[0].split(/\s+[—-]\s+/)[0] ?? "";
  const words = left
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !/^(?:token|emblem|card)$/i.test(word))
    .join(" ");
  const printedColors = face.colors ?? fallbackColors;
  return {
    kind,
    title: (kind === "emblem" ? emblemTitleFromName(face.name) : face.name).slice(0, 120),
    typeWords: clip(words, 80),
    subtypes: kind === "emblem" ? [] : subtypes.slice(0, 8).map((s) => s.slice(0, 40)),
    colors: kind === "token" ? colorsOfLetters([...(printedColors ?? []), ...(face.color_indicator ?? [])]) : [],
    rulesText: clip(face.oracle_text, 1200),
    flavorText: clip(face.flavor_text, 400),
    power: kind === "token" ? clip(face.power, 8) : null,
    toughness: kind === "token" ? clip(face.toughness, 8) : null,
  };
}

/**
 * The kit faces of one token / emblem / helper PRINTING: each face of a
 * double-faced one its own (Day and Night; the Incubator and its Phyrexian
 * token; Undercity's dungeon and the Initiative), a face that is neither a
 * token, an emblem nor a helper card left out.
 */
export function kitFacesFromPrinting(card: ScryfallCard): KitFace[] {
  const faces = card.card_faces ?? [];
  const printed: PrintedFace[] = faces.length >= 2 ? faces.map((face) => ({ ...face, name: face.name ?? card.name })) : [card];
  const out: KitFace[] = [];
  for (const face of printed) {
    const kitFace = faceFromPrinted(face, card.colors);
    if (kitFace) out.push(kitFace);
  }
  return out;
}

// ---------------------------------------------------------------------------
// PipGlyph cards' tokens
// ---------------------------------------------------------------------------

/** The predefined tokens' printed rules (CR 111.10) and type words — what
 *  a "Create a Treasure token" draws. Shard is an enchantment. */
const PREDEFINED: Record<string, { typeWords: string; rules: string }> = {
  Treasure: { typeWords: "Artifact", rules: "{T}, Sacrifice this artifact: Add one mana of any color." },
  Food: { typeWords: "Artifact", rules: "{2}, {T}, Sacrifice this artifact: You gain 3 life." },
  Clue: { typeWords: "Artifact", rules: "{2}, Sacrifice this artifact: Draw a card." },
  Blood: { typeWords: "Artifact", rules: "{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card." },
  Map: {
    typeWords: "Artifact",
    rules: "{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.",
  },
  Gold: { typeWords: "Artifact", rules: "Sacrifice this artifact: Add one mana of any color." },
  Powerstone: { typeWords: "Artifact", rules: "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell." },
  Incubator: { typeWords: "Artifact", rules: "{2}: Transform this artifact." },
  Junk: {
    typeWords: "Artifact",
    rules: "{T}, Sacrifice this artifact: Exile the top card of your library. You may play that card this turn. Activate only as a sorcery.",
  },
  Shard: { typeWords: "Enchantment", rules: "{2}, Sacrifice this enchantment: Scry 1, then draw a card." },
  Lander: {
    typeWords: "Artifact",
    rules: "{2}, {T}, Sacrifice this artifact: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.",
  },
  Mutagen: {
    typeWords: "Artifact",
    rules: "{1}, {T}, Sacrifice this artifact: Put a +1/+1 counter on target creature. Activate only as a sorcery.",
  },
};

/** "vigilance and haste" → "Vigilance, haste" (a keyword line as printed). */
function keywordLine(abilities: string | null): string | null {
  if (!abilities?.trim()) return null;
  const parts = abilities
    .split(/, and |, | and /)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const line = parts.join(", ");
  return line[0].toUpperCase() + line.slice(1);
}

/** A kit face from a PipGlyph card's own words (tokenSpecsFromRulesText). */
export function kitFaceFromSpec(spec: TextTokenSpec): KitFace {
  if (spec.kind === "emblem") {
    const rules = spec.abilities ? `${spec.abilities.replace(/\.$/, "")}.` : null;
    return {
      kind: "emblem",
      title: emblemTitleFromName(spec.name).slice(0, 120),
      typeWords: null,
      subtypes: [],
      colors: [],
      rulesText: rules,
      flavorText: null,
      power: null,
      toughness: null,
    };
  }
  const predefined = spec.power === null ? PREDEFINED[spec.name] : undefined;
  return {
    kind: "token",
    title: spec.name.slice(0, 120),
    typeWords: predefined?.typeWords ?? spec.typeWords,
    subtypes: spec.subtypes.slice(0, 8),
    colors: KIT_FACE_COLORS.filter((color) => spec.colors.includes(color)),
    rulesText: predefined?.rules ?? keywordLine(spec.abilities),
    flavorText: null,
    power: spec.power,
    toughness: spec.toughness,
  };
}

// ---------------------------------------------------------------------------
// One list
// ---------------------------------------------------------------------------

const fold = (text: string | null | undefined) =>
  (text ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[−–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** Two 32-bit FNV-1a passes (different offsets) as 16 hex digits: a short,
 *  stable digest that runs the same in the browser and on the server. */
function digest(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** The ONE key two faces share when they are the same token: kind, name,
 *  type words, subtypes, colours, stats and rules (folded) — kept SHORT
 *  (a readable kind + name, then a digest of the whole identity), since it
 *  is the saved kit's item key and a dungeon's rules run to a page. */
export function kitFaceKey(face: KitFace): string {
  const identity = [
    face.kind,
    fold(face.title),
    fold(face.typeWords),
    face.subtypes.map(fold).join(" "),
    [...face.colors].sort().join(","),
    `${face.power ?? ""}/${face.toughness ?? ""}`,
    fold(face.rulesText),
  ].join("|");
  const name = fold(face.title).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${face.kind}:${name}:${digest(identity)}`;
}

/** One card of the deck that may make tokens. */
export type KitMaker = {
  name: string;
  quantity: number;
  /** In the command zone (or a companion): it is in play every game. */
  commander: boolean;
  /** Its words (every face): what the counts are read from. */
  texts: string[];
  /** A real card's related objects (tokenPartsOf); null for a PipGlyph
   *  card, whose tokens come from its words. */
  parts: TokenPart[] | null;
};

/** One item of the kit. */
export type KitItem = {
  key: string;
  face: KitFace;
  /** The deck's cards that make it, sorted. */
  makers: string[];
  /** The Scryfall printing it was read from (null: a PipGlyph card's words). */
  scryfallId: string | null;
  /** How many copies the kit suggests. */
  suggested: number;
  /** Why that many, in a few words each. */
  why: string[];
};

/** The most copies a suggestion names. */
export const KIT_SUGGESTED_MAX = 12;

/** The deck's token DOUBLERS — a card whose words double what is created
 *  ("twice that many", Doubling Season, Parallel Lives…). */
export function kitDoublers(makers: readonly KitMaker[]): string[] {
  const names = new Set<string>();
  for (const maker of makers) {
    if (maker.texts.some((text) => /\b(?:twice that many|three times that many|that many plus one)\b/i.test(text))) names.add(maker.name);
  }
  return [...names].sort();
}

type Contribution = { maker: string; count: number | null; repeats: boolean; quantity: number; commander: boolean };

/** How many of one token a maker's words make at a time (the spec whose
 *  name matches), else one at a time. */
function makerContribution(maker: KitMaker, face: KitFace, specs: readonly TextTokenSpec[]): Contribution {
  const title = fold(face.title);
  const spec = specs.find((s) => s.kind === face.kind && (fold(s.name) === title || fold(s.subtypes.join(" ")) === title));
  return { maker: maker.name, count: spec ? spec.count : 1, repeats: spec?.repeats ?? false, quantity: maker.quantity, commander: maker.commander };
}

/**
 * The copies a token's makers suggest: each maker's count (a variable count
 * — "X", "that many" — as three), at least three or twice that for one that
 * makes it again and again, twice that again for a card the deck plays more
 * than one of (or a commander, always in play); summed, doubled by a
 * doubler, and held to 1 … KIT_SUGGESTED_MAX. An emblem or a helper card: 1.
 */
export function suggestedCopies(
  kind: KitItemKind,
  contributions: readonly Contribution[],
  doublers: readonly string[],
): { copies: number; why: string[] } {
  if (kind !== "token") return { copies: 1, why: [] };
  const why: string[] = [];
  let total = 0;
  for (const c of contributions) {
    let n = c.count ?? 3;
    if (c.repeats) n = Math.max(3, n * 2);
    if (c.quantity > 1 || c.commander) n *= 2;
    total += n;
  }
  if (contributions.some((c) => c.repeats)) why.push("made again and again");
  if (contributions.some((c) => c.count === null)) why.push("a variable count");
  if (contributions.some((c) => c.commander)) why.push("your commander makes it");
  if (doublers.length > 0) {
    total *= 2;
    why.push(`doubled by ${doublers[0]}${doublers.length > 1 ? ` and ${doublers.length - 1} more` : ""}`);
  }
  return { copies: Math.max(1, Math.min(KIT_SUGGESTED_MAX, total)), why };
}

/**
 * The kit's items from the deck's makers and the token printings their
 * parts name (by printing id): one item per distinct face (kitFaceKey),
 * tokens first, then emblems, then helper cards, each by name. A part whose
 * printing didn't come back is left out (`missing` counts them).
 */
export function buildKitItems(
  makers: readonly KitMaker[],
  printings: Readonly<Record<string, readonly KitFace[]>>,
): { items: KitItem[]; missing: number; doublers: string[] } {
  const doublers = kitDoublers(makers);
  const byKey = new Map<string, { face: KitFace; makers: Set<string>; scryfallId: string | null; contributions: Contribution[] }>();
  let missing = 0;
  const add = (face: KitFace, maker: KitMaker, scryfallId: string | null, specs: readonly TextTokenSpec[]) => {
    const key = kitFaceKey(face);
    let item = byKey.get(key);
    if (!item) {
      item = { face, makers: new Set(), scryfallId, contributions: [] };
      byKey.set(key, item);
    }
    if (!item.makers.has(maker.name)) {
      item.makers.add(maker.name);
      item.contributions.push(makerContribution(maker, face, specs));
    }
    item.scryfallId ??= scryfallId;
  };
  for (const maker of makers) {
    const specs = maker.texts.flatMap((text) => tokenSpecsFromRulesText(text, maker.name));
    if (maker.parts) {
      for (const part of maker.parts) {
        const faces = printings[part.id];
        if (!faces || faces.length === 0) {
          missing += 1;
          continue;
        }
        for (const face of faces) add(face, maker, part.id, specs);
      }
    } else {
      for (const spec of specs) add(kitFaceFromSpec(spec), maker, null, specs);
    }
  }
  const order: Record<KitItemKind, number> = { token: 0, emblem: 1, helper: 2 };
  const items = [...byKey.entries()]
    .map(([key, item]): KitItem => {
      const { copies, why } = suggestedCopies(item.face.kind, item.contributions, doublers);
      return { key, face: item.face, makers: [...item.makers].sort(), scryfallId: item.scryfallId, suggested: copies, why };
    })
    .sort((a, b) => order[a.face.kind] - order[b.face.kind] || a.face.title.localeCompare(b.face.title) || a.key.localeCompare(b.key));
  return { items, missing, doublers };
}
