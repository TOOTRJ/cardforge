// ---------------------------------------------------------------------------
// Re-art deck (beta tool `re-art-deck`, migration 0191) — the deck's STYLE,
// what each entry of the deck becomes, the cost line and the words the
// studio says. Pure and client-safe: the studio, the server actions, the
// step and the unit tests share it.
//
// Re-art is BUILT ON Bulk Customize (lib/tools/bulk-customize/*): a deck
// entry that stands for a REAL card becomes the maker's own card exactly as
// a Bulk Customize batch makes one ("New AI art, one style", every other
// choice left as the printing has it — the same planner, the same save,
// the entry linked to its new card), and the batch runs on the AI jobs'
// one step door with the same runner. What Re-art adds is the deck's ONE
// style (one style block in every picture's prompt) and the maker's own
// cards: an entry that is already theirs gets its new picture ON its card
// (an edit of the art alone), and its old picture is kept so it can be put
// back.
//
// Never touched: another creator's card (it keeps its art — a deck may hold
// it, D3, but it is theirs), an emblem (owner rule for remixes: it prints
// its walker's art), the maybeboard (not the deck).
// ---------------------------------------------------------------------------

import { z } from "zod";
import { STYLE_PRESETS, SURPRISE_PRESET_ID, stylePresetById } from "@/lib/ai/presets";
import { BULK_AI_ART_CREDITS_PER_FACE, BULK_VISIBILITY_VALUES, type BulkVisibility } from "@/lib/tools/bulk-customize/model";
import type { DeckBoard } from "@/types/deck";
import type { CardBackFace } from "@/types/card";
import type { Json } from "@/types/supabase";

/** The tool's slug in the catalog (lib/tools/catalog.ts) and in SQL
 *  (`has_tool_access`, 0191's policies). */
export const REART_TOOL_SLUG = "re-art-deck";

/** The most cards one run paints. A Commander deck is about 100 entries
 *  (fewer with its basics on one line); a deck holds at most 500 (0143). */
export const REART_MAX_CARDS = 150;

/** The most cards a SAMPLE paints — enough to judge a style. */
export const REART_SAMPLE_MAX = 3;

/** The longest description of the deck's world (0191's CHECK). */
export const REART_THEME_MAX = 300;

/** One credit per picture — two for a double-faced card (Bulk Customize's
 *  price, the AI deck remix's). */
export const REART_CREDITS_PER_FACE = BULK_AI_ART_CREDITS_PER_FACE;

// ---------------------------------------------------------------------------
// The style
// ---------------------------------------------------------------------------

const STYLE_IDS = [SURPRISE_PRESET_ID, ...STYLE_PRESETS.map((preset) => preset.id)] as [string, ...string[]];

export const reartStyleSchema = z
  .object({
    /** A style preset's id, or "surprise" for none. */
    preset: z.enum(STYLE_IDS),
    /** The maker's own words about the deck's world and look. */
    theme: z.string().max(REART_THEME_MAX * 2),
  })
  .strict();

export type ReartStyle = { preset: string; theme: string };

export const EMPTY_REART_STYLE: ReartStyle = { preset: SURPRISE_PRESET_ID, theme: "" };

/** Starting points for the deck's world: the maker's words, one click
 *  away (they edit them after). Original, generic words only — no
 *  Wizards-owned or real-world proper nouns (lib/ai/presets.ts's rule). */
export const REART_THEME_IDEAS: ReadonlyArray<{ label: string; theme: string }> = [
  { label: "Sunken city", theme: "a drowned clockwork city under a green sea, brass and teal, shafts of light from above" },
  { label: "Frozen north", theme: "a frozen northern frontier, aurora skies, longhouses and rune-carved stone, cold blue light" },
  { label: "Desert dusk", theme: "a vast desert at dusk, sandstone ruins and caravans, long amber shadows and violet skies" },
  { label: "Haunted fen", theme: "a haunted fen at night, will-o'-wisps, crooked trees and drowned bell towers, cold mist" },
  { label: "Sky islands", theme: "floating islands above the clouds, waterfalls into the sky, airships and wind-worn temples" },
  { label: "Neon night", theme: "a rain-soaked neon city at night, glowing signs, chrome and steam, magenta and cyan light" },
];

// Control characters, the zero-width space and the bidi marks (the same
// set lib/ai/presets.ts cleanTwist drops).
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f؜​‎‏‪-‮⁦-⁩]/g;

/** The maker's words as the prompt takes them: unsafe characters out,
 *  whitespace folded, trimmed, clipped to REART_THEME_MAX. */
export function cleanReartTheme(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(UNSAFE_CHARACTERS, " ").replace(/\s+/g, " ").trim().slice(0, REART_THEME_MAX).trim();
}

/** A style as it is stored and compared (the preset known, the words clean). */
export function normalizeReartStyle(style: ReartStyle): ReartStyle {
  const preset = stylePresetById(style.preset) ? style.preset : SURPRISE_PRESET_ID;
  return { preset, theme: cleanReartTheme(style.theme) };
}

export function sameReartStyle(a: ReartStyle | null | undefined, b: ReartStyle | null | undefined): boolean {
  if (!a || !b) return false;
  const x = normalizeReartStyle(a);
  const y = normalizeReartStyle(b);
  return x.preset === y.preset && x.theme === y.theme;
}

/** Why a style can't paint yet, or null. A style is a preset or the
 *  deck's own words (at least a few letters) — "style first". */
export function reartStyleProblem(style: ReartStyle): string | null {
  const clean = normalizeReartStyle(style);
  if (clean.preset === SURPRISE_PRESET_ID && clean.theme.replace(/[^\p{L}]/gu, "").length < 3) {
    return "Pick a style or describe the deck's world first.";
  }
  return null;
}

/**
 * The ONE style block every picture of the deck shares — what keeps a run
 * consistent. The studio shows it to the maker word for word.
 */
export function reartStyleBlock(style: ReartStyle): string {
  const clean = normalizeReartStyle(style);
  const preset = stylePresetById(clean.preset);
  return [
    preset
      ? `Rendered strictly in ${preset.label.toLowerCase()} style. Art direction: ${preset.art}.`
      : "Painterly fantasy illustration style.",
    clean.theme ? `The deck's world and look: ${clean.theme}.` : "",
    "Every card of this deck is one cohesive set: the same rendering technique, palette, lighting and level of detail.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The short style the safety ladder's plain prompt keeps
 *  (lib/ai/art-prompt-safety.ts fallbackArtPrompt "Rendered strictly in …"). */
export function reartLadderStyle(style: ReartStyle): string {
  const clean = normalizeReartStyle(style);
  const label = stylePresetById(clean.preset)?.label.toLowerCase();
  const words = clean.theme.length > 90 ? `${clean.theme.slice(0, 90).replace(/\s+\S*$/, "")}` : clean.theme;
  return [label, words].filter(Boolean).join(", ") || "painterly fantasy";
}

// ---------------------------------------------------------------------------
// One card's prompt
// ---------------------------------------------------------------------------

export type ReartSubject = {
  title: string;
  typeLine: string | null;
  rulesText?: string | null;
  flavorText?: string | null;
};

/** Reminder text, symbols and markup out of a card text, clipped on a word. */
function sceneWords(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const plain = text
    .replace(/\([^)]*\)/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/[*_~]/g, "")
    .replace(UNSAFE_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/**
 * One picture's prompt: the card's OWN subject (its name, type line and a
 * hint of its flavour or what it does) then the deck's shared style block.
 * Never a real artist, never the source's art.
 */
export function reartArtPrompt(subject: ReartSubject, style: ReartStyle): string {
  const flavor = sceneWords(subject.flavorText, 200);
  const rules = flavor ? "" : sceneWords(subject.rulesText, 160);
  const title = subject.title.trim() || "an unnamed card";
  return [
    `Trading-card illustration of "${title}"${subject.typeLine?.trim() ? `, a ${subject.typeLine.trim()}` : ""}.`,
    flavor ? `Its mood: ${flavor}` : rules ? `As a scene, what it does: ${rules}` : "",
    reartStyleBlock(style),
    "NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.",
  ]
    .filter(Boolean)
    .join(" ");
}

// ---------------------------------------------------------------------------
// What each entry becomes
// ---------------------------------------------------------------------------

/** "printing" = a real card the run makes the maker's own; "own" = the
 *  maker's own card, which gets new art on it; "skip" = left as it is. */
export type ReartEntryKind = "printing" | "own" | "skip";

export type ReartClassified =
  | { kind: "printing" }
  | { kind: "own" }
  | { kind: "skip"; reason: "maybeboard" | "other_creator" | "emblem" | "gone" | "not_real"; message: string };

export const REART_SKIP_COPY = {
  maybeboard: "On the maybeboard — not part of the deck.",
  other_creator: "Another creator's card keeps its own art.",
  emblem: "Emblems keep their art.",
  gone: "No longer available.",
  not_real: "Not a real card yet — pick its printing or make it first.",
} as const;

/** What one entry of the deck becomes in a run. Pure: the server's plan
 *  and the studio's list read the same answer. */
export function classifyReartEntry(input: {
  board: DeckBoard | string;
  cardId: string | null;
  scryfallId: string | null;
  typeLine?: string | null;
  /** The linked card as the owner reads it (null: gone or unreadable). */
  card: { owner_id: string; card_type?: string | null } | null;
  ownerId: string;
}): ReartClassified {
  const skip = (reason: keyof typeof REART_SKIP_COPY): ReartClassified => ({ kind: "skip", reason, message: REART_SKIP_COPY[reason] });
  if (input.board === "maybe") return skip("maybeboard");
  if (input.cardId) {
    if (!input.card) return skip("gone");
    if (input.card.owner_id !== input.ownerId) return skip("other_creator");
    if (input.card.card_type === "emblem") return skip("emblem");
    return { kind: "own" };
  }
  if (!input.scryfallId || !/^[0-9a-f-]{8,64}$/i.test(input.scryfallId)) return skip("not_real");
  if (/\bemblem\b/i.test(input.typeLine ?? "")) return skip("emblem");
  return { kind: "printing" };
}

/** Which entries a run takes. */
export const REART_SCOPE_VALUES = ["all", "own", "printings"] as const;
export type ReartScope = (typeof REART_SCOPE_VALUES)[number];

export const REART_SCOPE_LABELS: Record<ReartScope, string> = {
  all: "Every card",
  own: "Only my own cards",
  printings: "Only the real cards",
};

export const REART_SCOPE_HINTS: Record<ReartScope, string> = {
  all: "Real cards become your own cards with the new art; your own cards get new art on them.",
  own: "New art on the cards you made. Real cards are left as they are and take no card slots.",
  printings: "Real cards become your own cards with the new art. Your own cards keep theirs.",
};

export function scopeTakes(scope: ReartScope, kind: ReartEntryKind): boolean {
  if (kind === "skip") return false;
  if (scope === "own") return kind === "own";
  if (scope === "printings") return kind === "printing";
  return true;
}

export { BULK_VISIBILITY_VALUES as REART_VISIBILITY_VALUES };
export type ReartVisibility = BulkVisibility;

// ---------------------------------------------------------------------------
// The cost line
// ---------------------------------------------------------------------------

export type ReartCost = {
  /** Cards the run paints. */
  cards: number;
  /** Of those, the real cards it makes the maker's own (each a slot). */
  makes: number;
  credits: number;
  /** Saved-card slots left AFTER the run, or null = no limit. */
  slotsLeftAfter: number | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "Re-arts 64 cards · 64 credits · 12 slots left" — before anything is
 *  charged. A plan with no card limit says nothing about slots. */
export function reartCostLine(cost: ReartCost): string {
  const parts = [`Re-arts ${plural(cost.cards, "card")}`, plural(cost.credits, "credit")];
  if (cost.slotsLeftAfter !== null) parts.push(`${plural(Math.max(0, cost.slotsLeftAfter), "slot")} left`);
  return parts.join(" · ");
}

/** The line under it: what happens to which cards. */
export function reartCostDetail(cost: ReartCost): string {
  const own = cost.cards - cost.makes;
  const parts: string[] = [];
  if (cost.makes > 0) parts.push(`${plural(cost.makes, "real card")} become${cost.makes === 1 ? "s" : ""} your own (${plural(cost.makes, "slot")})`);
  if (own > 0) parts.push(`${plural(own, "card")} of yours get${own === 1 ? "s" : ""} new art`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// The sample
// ---------------------------------------------------------------------------

/** A broad kind of card for picking a varied sample. */
export function typeBucketOf(typeLine: string | null | undefined, cardType?: string | null): string {
  const words = `${cardType ?? ""} ${typeLine ?? ""}`.toLowerCase();
  if (/\bcreature\b/.test(words)) return "creature";
  if (/\bplaneswalker\b/.test(words)) return "planeswalker";
  if (/\bland\b/.test(words)) return "land";
  if (/\b(instant|sorcery)\b/.test(words)) return "spell";
  if (/\b(artifact|enchantment|battle)\b/.test(words)) return "permanent";
  return "other";
}

/**
 * Up to REART_SAMPLE_MAX entries to try a style on: the commander first
 * (the face of the deck), then one of each kind of card — a creature, a
 * spell, a land… — so a style is judged on what it must paint. Cards
 * already in the style come last. Pure; ties keep the deck's order.
 */
export function suggestReartSample(
  entries: ReadonlyArray<{ id: string; board: string; bucket: string; inStyle: boolean }>,
  max = REART_SAMPLE_MAX,
): string[] {
  const ordered = [...entries].sort((a, b) => Number(a.inStyle) - Number(b.inStyle));
  const picked: string[] = [];
  const buckets = new Set<string>();
  for (const entry of ordered) {
    if (picked.length >= max) break;
    if (entry.board === "commander" && !entry.inStyle) {
      picked.push(entry.id);
      buckets.add(entry.bucket);
    }
  }
  for (const bucket of ["creature", "spell", "land", "permanent", "planeswalker", "other"]) {
    if (picked.length >= max) break;
    if (buckets.has(bucket)) continue;
    const next = ordered.find((entry) => entry.bucket === bucket && !picked.includes(entry.id));
    if (next) {
      picked.push(next.id);
      buckets.add(bucket);
    }
  }
  for (const entry of ordered) {
    if (picked.length >= max) break;
    if (!picked.includes(entry.id)) picked.push(entry.id);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// The run's request (start / plan)
// ---------------------------------------------------------------------------

const UUID = z.string().uuid();

export const reartRunSchema = z
  .object({
    deckId: UUID,
    /** The style to paint in — saved as the deck's on start. Absent: the
     *  deck's stored style (a re-roll paints in it). */
    style: reartStyleSchema.optional(),
    scope: z.enum(REART_SCOPE_VALUES).default("all"),
    visibility: z.enum(BULK_VISIBILITY_VALUES).default("public"),
    /** Paint exactly these entries (a sample, a re-roll), whether or not
     *  they are in the style already. Absent: every entry of the scope not
     *  yet in the style. */
    entryIds: z.array(UUID).min(1).max(REART_MAX_CARDS).optional(),
    /** The run is a sample (said in the run's history). */
    sample: z.boolean().optional(),
  })
  .strict()
  .refine((run) => !run.sample || (run.entryIds !== undefined && run.entryIds.length <= REART_SAMPLE_MAX), {
    message: `A sample is up to ${REART_SAMPLE_MAX} named cards.`,
  });

export type ReartRunInput = z.input<typeof reartRunSchema>;

/** The step key of entry `index`. */
export function reartStepKey(index: number): string {
  return `reart:${index}`;
}

// ---------------------------------------------------------------------------
// The studio's view of one entry (the page builds it; client-safe data)
// ---------------------------------------------------------------------------

/** Where an entry stands against the deck's saved style: painted in it,
 *  painted and then given its own art back ("kept"), painted in an earlier
 *  style, or never painted (null). */
export type ReartEntryState = "in_style" | "kept" | "earlier" | null;

export type ReartStudioEntry = {
  id: string;
  name: string;
  quantity: number;
  board: DeckBoard;
  typeLine: string | null;
  /** The printing's picture (Scryfall), for a real card's tile. */
  imageUrl: string | null;
  kind: ReartEntryKind;
  skipMessage: string | null;
  /** The maker's own card (kind "own"), as the deck page reads it. */
  card: import("@/lib/decks/queries").DeckPageCard | null;
  bucket: string;
  state: ReartEntryState;
  /** "Put the old art back" is offered. */
  canRestore: boolean;
  /** What painting it costs (a real card's is confirmed at plan time). */
  credits: number;
};

/** Words for an entry's state. */
export function reartStateLabel(entry: Pick<ReartStudioEntry, "kind" | "state" | "skipMessage">): string {
  if (entry.kind === "skip") return entry.skipMessage ?? "Left as it is";
  if (entry.state === "in_style") return "In this style";
  if (entry.state === "kept") return "Kept its own art";
  if (entry.state === "earlier") return "Painted in an earlier style";
  return entry.kind === "printing" ? "Real card — becomes yours" : "Your card — not painted yet";
}

/**
 * A stored back face resent with new art: the picture, its fit and its
 * credit replaced, every other key as stored. A null keeps the key OUT (the
 * back's schema takes a text or nothing, never null).
 */
export function withBackArt(
  back: CardBackFace,
  artUrl: string | null,
  artPosition: Json | null,
  artistCredit: string | null,
): CardBackFace {
  const { art_url: _url, art_position: _position, artist_credit: _credit, ...rest } = back as CardBackFace & {
    art_url?: unknown;
    art_position?: unknown;
    artist_credit?: unknown;
  };
  void _url;
  void _position;
  void _credit;
  return {
    ...rest,
    ...(artUrl ? { art_url: artUrl } : {}),
    ...(artUrl && artPosition ? { art_position: artPosition } : {}),
    ...(artistCredit ? { artist_credit: artistCredit } : {}),
  } as CardBackFace;
}
