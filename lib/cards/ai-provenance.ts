import { printTypography, type TypographyField } from "@/lib/validation/print-typography";
import { normalizeManaCost } from "@/lib/cards/mana-order";
import { AI_TEXT_FIELD_KEYS, type AiFieldKey, type AiTextFieldKey } from "@/lib/cards/ai-provenance-keys";

// ---------------------------------------------------------------------------
// AI provenance (TODO CP1, migration 0162) — how much of a card AI made, as
// the card page says it: "Card generated with AI", "AI helped with parts of
// this card", "Art generated with AI". Pure and client-safe: the card page,
// the creator's claims and the card actions' check all read this ONE
// vocabulary.
//
// What is stored is `cards.ai_fields`: the PARTS of the card whose current
// content AI wrote. The database keeps it honest (0162's
// `cards_track_ai_fields` trigger):
//   * an API role (anon / authenticated) never writes it — an insert naming
//     a part, or an update changing the list, is refused;
//   * an API role's update that CHANGES a part's content drops that part
//     (the maker rewrote it: per field, never guessed from the text — the
//     edit rule makes a changed column a field the maker touched);
//   * the ART parts are DERIVED on every write from the picture's own
//     address: only the server's AI art store (lib/ai/random-art.ts
//     persistGeneratedArt) names an object `card-art/<user>/ai-…`, and no
//     user writes storage since 0126 — so a replaced picture drops the label
//     by itself, whoever writes the row.
// The TEXT parts are added by the server alone (the service role,
// `add_card_ai_fields`): the AI jobs for the cards they write, and the card
// actions for the parts the creator CLAIMS (an AI fill or idea it applied,
// unchanged since) once a receipt the server wrote at generation time
// (`card_ai_receipts`) holds the same text — lib/cards/ai-provenance-server.ts.
// ---------------------------------------------------------------------------

export {
  AI_ART_FIELD_KEYS,
  AI_FIELD_KEYS,
  AI_TEXT_FIELD_KEYS,
  type AiArtFieldKey,
  type AiFieldKey,
  type AiTextFieldKey,
} from "@/lib/cards/ai-provenance-keys";

const TEXT_KEYS: ReadonlySet<string> = new Set(AI_TEXT_FIELD_KEYS);

export function isAiTextFieldKey(value: unknown): value is AiTextFieldKey {
  return typeof value === "string" && TEXT_KEYS.has(value);
}

/** The columns (paths into the row) each part stands for — the trigger's
 *  table (0162 `card_ai_field_paths`) word for word; a unit test holds the
 *  two together. A part is CHANGED when any of its paths changed — JSON
 *  null, "" and [] read as one empty value, except `printed_types`, whose
 *  NULL (the built line) and "" (emptied) print differently. */
export const AI_FIELD_PATHS: Record<AiFieldKey, readonly string[]> = {
  title: ["title"],
  cost: ["cost"],
  type_line: ["card_type", "supertype", "subtypes", "printed_types"],
  // The rows a walker / saga / station draws BEFORE the text (the renderers
  // read `face_content` first): a change to them is a change to the rules.
  // (A second face has no rows of its own — backFaceSchema.)
  rules_text: ["rules_text", "face_content"],
  flavor_text: ["flavor_text"],
  stats: ["power", "toughness", "loyalty", "defense"],
  art: ["art_url"],
  "back.title": ["back_face.title"],
  "back.cost": ["back_face.cost"],
  "back.type_line": ["back_face.card_type", "back_face.supertype", "back_face.subtypes", "back_face.printed_types"],
  "back.rules_text": ["back_face.rules_text"],
  "back.flavor_text": ["back_face.flavor_text"],
  "back.stats": ["back_face.power", "back_face.toughness", "back_face.loyalty", "back_face.defense"],
  "back.art": ["back_face.art_url"],
};

/** The address of a picture the server's AI art store wrote (0162
 *  `card_ai_art_url`, the same pattern): `…/storage/v1/object/public/
 *  card-art/<uuid>/ai-<name>`. A remix's copy of one keeps the prefix
 *  (lib/cards/remix-media.ts) — its pixels are still AI's. */
export const AI_ART_URL_PATTERN = /\/storage\/v1\/object\/public\/card-art\/[0-9a-fA-F-]{36}\/ai-[^/]*$/;

export function isAiArtUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && AI_ART_URL_PATTERN.test(url);
}

/** A row-shaped card or face — the columns the parts read. Loose on purpose:
 *  a payload, an inserted row, a fill or an idea all fit. */
export type AiFieldSource = {
  title?: unknown;
  cost?: unknown;
  card_type?: unknown;
  supertype?: unknown;
  subtypes?: unknown;
  printed_types?: unknown;
  rules_text?: unknown;
  flavor_text?: unknown;
  power?: unknown;
  toughness?: unknown;
  loyalty?: unknown;
  defense?: unknown;
  art_url?: unknown;
  back_face?: unknown;
};

const text = (value: unknown, field?: TypographyField): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return field ? printTypography(trimmed, field) : trimmed;
};

const words = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((word) => text(word, "type")).filter((word): word is string => word !== null)
    : [];

function faceValue(part: string, face: Record<string, unknown>): unknown {
  switch (part) {
    case "title":
      return text(face.title, "name");
    case "cost": {
      const cost = text(face.cost);
      return cost ? normalizeManaCost(cost) : null;
    }
    case "type_line": {
      const cardType = text(face.card_type);
      const supertype = text(face.supertype, "type");
      const subtypes = words(face.subtypes);
      // (The Types field's own text, `printed_types`, is left out: the
      // creator sends the built line there and the server stores it only
      // when it differs — TODO 3b.16. An edit that retypes it still drops
      // the part: the database's paths name the column.)
      if (!cardType && !supertype && subtypes.length === 0) return null;
      return [cardType, supertype, subtypes];
    }
    case "rules_text":
      return text(face.rules_text, "rules");
    case "flavor_text":
      return text(face.flavor_text, "flavor");
    case "stats": {
      const stats = [face.power, face.toughness, face.loyalty, face.defense].map((stat) => text(stat));
      return stats.every((stat) => stat === null) ? null : stats;
    }
    case "art":
      return text(face.art_url);
    default:
      return null;
  }
}

/**
 * The canonical value of one part of a card — what "the same text" means
 * when the server checks a claim against its receipt and when the creator
 * checks a field still holds what AI wrote into it: trimmed, as print sets
 * it (curly quotes, dashes — TODO 6.11; the save stores that), a cost in
 * pip order. Null = the part is empty. A JSON string, so two values compare
 * with `===`.
 */
export function aiFieldValue(key: AiFieldKey, source: AiFieldSource | null | undefined): string | null {
  if (!source) return null;
  const back = key.startsWith("back.");
  const face = back
    ? source.back_face && typeof source.back_face === "object"
      ? (source.back_face as Record<string, unknown>)
      : null
    : (source as Record<string, unknown>);
  if (!face) return null;
  const value = faceValue(back ? key.slice(5) : key, face);
  return value === null ? null : JSON.stringify(value);
}

/** The text parts a card HAS (a non-empty value) — front, and the second
 *  face's where it holds one. */
export function aiTextPartsPresent(source: AiFieldSource | null | undefined): AiTextFieldKey[] {
  return AI_TEXT_FIELD_KEYS.filter((key) => aiFieldValue(key, source) !== null);
}

export type AiProvenance = {
  /** "card": every text part the card has is AI's; "parts": some are. */
  text: "card" | "parts" | null;
  /** A picture on the card (either face) is AI's. */
  art: boolean;
};

export const AI_PROVENANCE_LABELS = {
  card: "Card generated with AI",
  parts: "AI helped with parts of this card",
  art: "Art generated with AI",
} as const;

/**
 * What the card page says, from the stored parts and the card as it is:
 * the text is "Card generated with AI" when EVERY text part it has is AI's
 * (a maker who rewrites or adds one makes it "AI helped with parts"), and
 * the art label stands on its own. A card made by hand says nothing (both
 * null / false).
 */
export function aiProvenanceOf(
  card: AiFieldSource & { ai_fields?: readonly string[] | null },
): AiProvenance {
  const stored = new Set(card.ai_fields ?? []);
  const art = stored.has("art") || stored.has("back.art");
  const present = aiTextPartsPresent(card);
  const aiText = present.filter((key) => stored.has(key));
  const text = aiText.length === 0 ? null : aiText.length === present.length ? "card" : "parts";
  return { text, art };
}

/** The labels in the order the page shows them (text first, then art). */
export function aiProvenanceLabels(provenance: AiProvenance): string[] {
  const labels: string[] = [];
  if (provenance.text) labels.push(AI_PROVENANCE_LABELS[provenance.text]);
  if (provenance.art) labels.push(AI_PROVENANCE_LABELS.art);
  return labels;
}

/** The Card details line: one sentence, or null for a hand-made card. */
export function aiProvenanceSentence(provenance: AiProvenance): string | null {
  if (provenance.text === "card") {
    return provenance.art ? "Card and art generated with AI." : "Card generated with AI.";
  }
  if (provenance.text === "parts") {
    return provenance.art
      ? "Art generated with AI; AI helped with parts of the text."
      : "AI helped with parts of this card.";
  }
  return provenance.art ? "Art generated with AI." : null;
}

// ---------------------------------------------------------------------------
// The creator's side: which parts an AI fill / idea wrote this session, and
// which of them a save may CLAIM (the field still holds exactly what AI
// wrote). The server checks every claim against its receipt; a claim is
// never trusted on its own.
// ---------------------------------------------------------------------------

/** What AI wrote into the form, part by part (canonical values). */
export type AiFieldOrigins = Map<AiTextFieldKey, string>;

/** Record the parts `written` names, read from `source` (the fill or idea
 *  in row shape). An empty part is never recorded. */
export function recordAiOrigins(
  origins: AiFieldOrigins,
  written: readonly AiTextFieldKey[],
  source: AiFieldSource,
): void {
  for (const key of written) {
    const value = aiFieldValue(key, source);
    if (value === null) origins.delete(key);
    else origins.set(key, value);
  }
}

/** The parts a save claims: those whose value in the outgoing payload is
 *  still exactly what AI wrote. */
export function aiFieldClaims(origins: AiFieldOrigins, payload: AiFieldSource): AiTextFieldKey[] {
  const claims: AiTextFieldKey[] = [];
  for (const [key, value] of origins) {
    if (aiFieldValue(key, payload) === value) claims.push(key);
  }
  return claims.sort();
}

/** The text parts a fill result WRITES into the creator (its keys; a
 *  revise — edit or remix — never takes the type). */
export function fillWrittenParts(
  fill: {
    title?: unknown;
    cost?: unknown;
    card_type?: unknown;
    rules_text?: unknown;
    flavor_text?: unknown;
    power?: unknown;
    toughness?: unknown;
    loyalty?: unknown;
    defense?: unknown;
    back_face?: unknown;
  },
  options: { revise: boolean },
): AiTextFieldKey[] {
  const parts: AiTextFieldKey[] = [];
  if (fill.title !== undefined) parts.push("title");
  if (fill.cost !== undefined) parts.push("cost");
  if (fill.card_type !== undefined && !options.revise) parts.push("type_line");
  if (fill.rules_text !== undefined) parts.push("rules_text");
  if (fill.flavor_text !== undefined) parts.push("flavor_text");
  if ([fill.power, fill.toughness, fill.loyalty, fill.defense].some((stat) => stat !== undefined)) parts.push("stats");
  const back = fill.back_face && typeof fill.back_face === "object" ? (fill.back_face as Record<string, unknown>) : null;
  if (back) {
    if (back.title !== undefined) parts.push("back.title");
    if (back.cost !== undefined) parts.push("back.cost");
    if (back.card_type !== undefined) parts.push("back.type_line");
    if (back.rules_text !== undefined) parts.push("back.rules_text");
    if (back.flavor_text !== undefined) parts.push("back.flavor_text");
    if (back.power !== undefined || back.toughness !== undefined) parts.push("back.stats");
  }
  return parts;
}
