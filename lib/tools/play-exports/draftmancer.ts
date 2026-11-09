import { cardColors, splitTypes, statsLine } from "./card-words";
import type { PlayCustomCard, PlayExport, PlayFace } from "./model";

// ---------------------------------------------------------------------------
// Draftmancer — a custom card list (https://draftmancer.com/cubeformat.html;
// Draftmancer's src/parseCardList.ts and src/CustomCards.ts at 2c5e5ba8):
//
//   [Settings]      { "name": … }
//   [CustomCards]   a JSON array: name, mana_cost, type (required), subtypes,
//                   rarity, colors, oracle_text, power / toughness / loyalty,
//                   image, set, collector_number; a double-faced card's
//                   other face is `back` (one face — never "backs")
//   [MainSlot]      the card pool, one `count Name` line each — a real card
//                   by its name (Draftmancer's own database), a custom card
//                   by its own
//
// Uploaded by the session owner as a .txt. Each player's browser loads the
// pictures itself, so `image` is the card's stored display bake (its 600 px
// thumbnail) — a private card has none and is listed without a picture.
// Collation (rarity slots) can come later: one sheet, the cards as a pool.
// Pure.
// ---------------------------------------------------------------------------

type DraftmancerFace = {
  name: string;
  mana_cost: string;
  type: string;
  subtypes?: string[];
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  image?: string;
};

type DraftmancerCard = DraftmancerFace & {
  colors: string[];
  rarity: string;
  set: string;
  collector_number: string;
  back?: DraftmancerFace;
};

function faceOf(face: PlayFace, name = face.name): DraftmancerFace {
  const { types, subtypes } = splitTypes(face.typeLine);
  const out: DraftmancerFace = { name, mana_cost: face.cost ?? "", type: types || "Card" };
  if (subtypes.length > 0) out.subtypes = subtypes;
  if (face.rulesText) out.oracle_text = face.rulesText;
  if (face.power != null) out.power = face.power;
  if (face.toughness != null) out.toughness = face.toughness;
  // Draftmancer's one counter slot holds a battle's defense too.
  const loyalty = face.loyalty ?? face.defense;
  if (loyalty != null) out.loyalty = loyalty;
  const image = face.thumb ?? face.image;
  if (image) out.image = image;
  return out;
}

function customCardJson(card: PlayCustomCard, index: number): DraftmancerCard {
  const front = faceOf(card.front);
  if (card.secondPart) {
    // One picture: the second part's words under the first part's rules.
    const second = card.secondPart;
    front.oracle_text = [
      card.front.rulesText ?? "",
      "---",
      [second.name, second.cost].filter(Boolean).join(" "),
      second.typeLine,
      second.rulesText ?? "",
      statsLine(second) ?? "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return {
    ...front,
    colors: cardColors(card),
    rarity: card.rarity,
    set: "custom",
    collector_number: String(index + 1),
    ...(card.back ? { back: faceOf(card.back) } : {}),
  };
}

/** A pool line: a real card by its name (Draftmancer's own database); a
 *  custom card by its name, set and number — Draftmancer's exact id for it,
 *  so a name with parentheses ("Lightning Bolt (PipGlyph)") is never read
 *  as a set code, and never falls back to the real card. */
function poolLine(count: number, name: string, customNumber: number | null): string {
  const clean = name.replace(/\s+/g, " ").trim();
  return customNumber != null ? `${count} ${clean} (custom) ${customNumber}` : `${count} ${clean}`;
}

export function buildDraftmancer(exp: PlayExport): { text: string; pictured: number; unpictured: number } {
  const byId = new Map(exp.cards.map((card) => [card.id, card]));
  const custom = exp.cards.map(customCardJson);
  const numberOf = new Map(exp.cards.map((card, i) => [card.id, i + 1]));
  // A card's count in the pool: every copy the deck holds, across boards.
  const counts = new Map<string, { count: number; name: string; customNumber: number | null }>();
  for (const line of exp.lines) {
    const custom = line.kind === "custom" ? byId.get(line.cardId) : null;
    const name = custom ? custom.front.name : line.kind === "real" ? line.name : null;
    if (!name) continue;
    const key = custom ? `custom:${custom.id}` : `real:${name.toLowerCase()}`;
    const seen = counts.get(key);
    if (seen) seen.count += line.quantity;
    else counts.set(key, { count: line.quantity, name, customNumber: custom ? (numberOf.get(custom.id) ?? null) : null });
  }
  const pool = [...counts.values()].map((entry) => poolLine(entry.count, entry.name, entry.customNumber));
  const text = [
    "# Exported from PipGlyph — upload it in Draftmancer as a Custom Card List.",
    "[Settings]",
    JSON.stringify({ name: exp.title }),
    "[CustomCards]",
    JSON.stringify(custom, null, 2),
    "[MainSlot]",
    ...pool,
    "",
  ].join("\n");
  const pictured = exp.cards.filter((card) => card.front.image).length;
  return { text, pictured, unpictured: exp.cards.length - pictured };
}
