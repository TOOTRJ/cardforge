import type { ColorLetter, PlayCustomCard, PlayFace } from "./model";
import { COLOR_LETTERS } from "./model";

// ---------------------------------------------------------------------------
// What the play clients ask of a face beyond its text: its type line split
// at the dash, its MAIN type (the one a client sorts and lays out by), and
// the colours of a whole card. Pure, shared by the three exporters.
// ---------------------------------------------------------------------------

const DASH = /\s+[—–-]\s+/;

/** "Legendary Creature — Elf Druid" → ["Legendary Creature", ["Elf", "Druid"]]. */
export function splitTypes(typeLine: string): { types: string; subtypes: string[] } {
  const [left, ...rest] = typeLine.split(DASH);
  const right = rest.join(" ").trim();
  return { types: (left ?? "").trim(), subtypes: right ? right.split(/\s+/) : [] };
}

/** The main types in the order a client files a card under one of them
 *  (an Artifact Creature is a creature, a Land Creature a creature, an
 *  Enchantment Land a land). */
const MAIN_TYPE_ORDER = ["Planeswalker", "Battle", "Creature", "Land", "Instant", "Sorcery", "Artifact", "Enchantment", "Emblem"];

export function mainTypeOf(typeLine: string): string {
  const words = splitTypes(typeLine).types.split(/\s+/).map((word) => word.toLowerCase());
  const found = MAIN_TYPE_ORDER.find((type) => words.includes(type.toLowerCase()));
  if (found) return found;
  const last = splitTypes(typeLine).types.split(/\s+/).filter(Boolean).at(-1);
  return last ?? "";
}

/** Every colour of the card's faces, in WUBRG order. */
export function cardColors(card: PlayCustomCard): ColorLetter[] {
  const found = new Set<ColorLetter>();
  for (const face of facesOf(card)) for (const letter of face.colors) found.add(letter);
  return COLOR_LETTERS.filter((letter) => found.has(letter));
}

/** The faces the card has: the front, then a back or a second part. */
export function facesOf(card: PlayCustomCard): PlayFace[] {
  return [card.front, ...(card.back ? [card.back] : []), ...(card.secondPart ? [card.secondPart] : [])];
}

/** A face's stats in one line ("2/1", "Loyalty 3", "Defense 5"), else null. */
export function statsLine(face: PlayFace): string | null {
  if (face.power != null || face.toughness != null) return `${face.power ?? "?"}/${face.toughness ?? "?"}`;
  if (face.loyalty != null) return `Loyalty ${face.loyalty}`;
  if (face.defense != null) return `Defense ${face.defense}`;
  return null;
}

/** A face as plain text for a tooltip or a description: the cost, the type
 *  line, the rules, the stats. */
export function faceText(face: PlayFace): string {
  return [
    [face.name, face.cost].filter(Boolean).join("  "),
    face.typeLine,
    face.rulesText,
    statsLine(face),
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n");
}
