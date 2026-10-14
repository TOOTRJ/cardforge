// ---------------------------------------------------------------------------
// Spacecraft and Planets in the AI engine (TODO 4.27a, PR 3) — the pure half:
// what the designer is told, what the lint enforces, what the autofix
// repairs, how a per-field fill treats a card that already has tiers, and
// the rows an AI job's save writes. No model call, no React, no Supabase
// (tests/unit/ai/station-design.test.ts).
//
// THE PRINTED SHAPE, read off Scryfall on 2026-10-14 (`keyword:station`,
// one row per card: 35 cards — 30 Spacecraft, 5 Planets; 32 in paper and 3
// Arena-only). Counts are cards:
//
//   • Type line: "Artifact — Spacecraft" (30 of 30; 8 Legendary) — never
//     "Artifact Creature"; "Land — Planet" (5 of 5: the Planets have no
//     supertype on Scryfall's type line, their names are legendary-style).
//   • Text, top to bottom (35 of 35): the card's always-on abilities (0, 1
//     or 2 lines), then the Station line as the LAST line of the top band,
//     then the tier lines "N+ | text" with rising numbers.
//       - before the Station line: nothing on 10 Spacecraft (all 8 two-tier
//         ones and 2 others), one line on 19, two on 1; a Planet always two
//         ("This land enters tapped." / "{T}: Add {G}.").
//   • Tiers: one on 27 cards (22 Spacecraft, 5 Planets), two on 8 (all
//     Spacecraft), three on none. Numbers 1+ … 20+: a lone Spacecraft tier
//     3+ … 20+ (7+ ×6, 8+ ×5, 9+ / 10+ / 6+ ×2 each, 3+ 4+ 5+ 12+ 20+ once);
//     of two tiers the first is 1+ / 2+ / 3+ (7 of 8; 10+ once) and the
//     second 8+ … 20+ (8+ ×4, 12+ ×2, 9+, 20+); every Planet 12+.
//   • The Station line, word for word (32 of 32 paper cards):
//       "Station (Tap another creature you control: Put charge counters
//        equal to its power on this Spacecraft. Station only as a sorcery.
//        It's an artifact creature at N+.)"
//     N is the LAST tier's number on every card with a power / toughness
//     (26 of 26). The Eternity Elevator — the one paper Spacecraft with no
//     P/T — and all 5 Planets ("on this Planet") end at "…as a sorcery.)".
//     The 3 Arena-only cards print the bare word "Station".
//   • Power / toughness: 29 of 30 Spacecraft have one, printed on the tier
//     that makes the card a creature — the last (26 of 26 named). That
//     tier's first line is a keyword line starting with "Flying" on 28 of
//     29. No Planet has one.
//   • A tier holds one paragraph (22 tiers) or two (13: a keyword line, then
//     an ability). Whole texts run 144–423 characters; a tier 6–183.
//   • Self-reference: "this Spacecraft" / "this Planet"; a legendary one by
//     its name.
//
// A custom card may have up to THREE tiers (owner 2026-10-13, Q11) and any
// one of them may carry the P/T (round 54, decision 6) — in the creator. The
// DESIGNER is held to print: one to three tiers, the P/T on the tier the
// Station line names.
// ---------------------------------------------------------------------------

import {
  STATION_MAX_TIERS,
  STATION_ROW_MAX_CHARS,
  parseStationText,
  platedTierIndex,
  serializeStation,
  type StationText,
} from "@/lib/cards/station";
import { isStationFrame } from "@/lib/cards/station-frame";
import { stationReminder } from "@/lib/creator/station-rows";
import { faceContentSchema } from "@/lib/validation/card";
import type { CardType, FaceContent } from "@/types/card";

export type StationWord = "Spacecraft" | "Planet";

/** The subtype word that makes a card of each type a station card — the
 *  station frames' own gate (`SUBTYPE_DRESSES`, lib/creator/card-kinds.ts; a
 *  test holds the two together): an ARTIFACT whose subtypes say Spacecraft,
 *  a LAND whose subtypes say Planet, and nothing else. */
const STATION_WORD_OF: Partial<Record<CardType, StationWord>> = { artifact: "Spacecraft", land: "Planet" };

/** "Spacecraft" / "Planet" when the card is one, else null. */
export function stationWordOf(card: { card_type?: CardType | string | null; subtypes?: readonly string[] | null }): StationWord | null {
  const word = STATION_WORD_OF[(card.card_type ?? "") as CardType];
  if (!word) return null;
  const lower = word.toLowerCase();
  return (card.subtypes ?? []).some((subtype) => subtype.trim().toLowerCase() === lower) ? word : null;
}

// ---------------------------------------------------------------------------
// What the designer is told
// ---------------------------------------------------------------------------

/** The designer's section of the system prompt: print's convention, in
 *  Wizards' own wording. */
export const STATION_DESIGN_RULES = `SPACECRAFT AND PLANETS (only when you design one — never required):
- A Spacecraft is card_type "artifact" with the subtype "Spacecraft" (never a creature card: it BECOMES one). A Planet is card_type "land" with the subtype "Planet". Both have Station and print their abilities in TIERS that switch on as charge counters build up.
- rules_text, top to bottom, one item per line:
  1. Abilities the card always has, if any ("When this Spacecraft enters, …"). A Planet starts with "This land enters tapped." and its mana ability ("{T}: Add {G}.").
  2. The Station line, word for word: "${stationReminder("Spacecraft", null).replace(/\)$/, "")} It's an artifact creature at N+.)" — a Planet says "on this Planet" and stops after "Station only as a sorcery.)".
  3. One to three tier lines, each "N+ | text": what the card has once it holds N or more charge counters. The numbers rise down the card. Print uses 1+ to 20+: a single tier is usually 6+ to 12+; with two tiers the first is 1+ to 3+ and the last 8+ or more. Another ability of the same tier goes on its own line right under it, without a number.
- A Spacecraft has power and toughness, printed on its LAST tier: the N of the Station line is that tier's number, and that tier starts with its keywords (nearly always "Flying"). A Planet has no power or toughness and no creature sentence; its tier is an activated ability.
- The card calls itself "this Spacecraft" / "this Planet" (a legendary one by its name).`;

/** One example output in the shape above (an original card). */
export const STATION_DESIGN_EXAMPLE = `{"title":"Halcyon Driftbarge","cost":"{2}{U}","card_type":"artifact","supertype":null,"subtypes":["Spacecraft"],"rarity":"rare","color_identity":["blue"],"rules_text":"${[
  stationReminder("Spacecraft", 9),
  "2+ | Whenever you cast an artifact spell, scry 1.",
  "9+ | Flying",
  "Whenever this Spacecraft attacks, draw a card.",
]
  .join("\\n")
  .replace(/"/g, '\\"')}","flavor_text":null,"power":"4","toughness":"5","loyalty":null,"defense":null,"art_prompt":"A vast teal-hulled barge of brass ribs and sailcloth solar vanes drifting above a ringed gas giant, tiny crew lanterns along its spine, cold starlight and a warm amber engine glow, deep blue and copper palette, wide cinematic composition, painterly science-fantasy illustration."}`;

/** The judge's reminder: the shape is not his to restyle. */
export const STATION_JUDGE_RULE =
  'A Spacecraft (an artifact with that subtype) or a Planet (a land with that subtype) keeps its tier shape: the Station line as the last line before the tiers, then one to three lines "N+ | text" with rising numbers — fix what the findings name and leave the rest of that shape exactly as it is.';

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

/** Straight quotes for comparing a line with print's wording (the save's
 *  typography pass sets the apostrophe curly; the designer may too). */
const plain = (text: string) => text.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

/** A top-band line that IS the Station keyword: the bare word, or the word
 *  and its reminder — never "Station only as a sorcery." inside one. */
const isStationLine = (line: string) => /^station\b\s*(\(.*)?$/i.test(line.trim());

const everyTier = (rulesText: string | null | undefined) => parseStationText(rulesText, false, Number.POSITIVE_INFINITY);

/** The Station line print would set on this card: the creature sentence
 *  only on a card with a power / toughness, naming the tier the text
 *  already names when that is one of its tiers, else the last. */
export function expectedStationLine(word: StationWord, hasPt: boolean, text: Pick<StationText, "intro" | "tiers">): string {
  if (!hasPt || word === "Planet" || text.tiers.length === 0) return stationReminder(word, null);
  return stationReminder(word, text.tiers[platedTierIndex(text.intro, text.tiers)]!.threshold);
}

export type StationLintInput = {
  card_type: CardType;
  subtypes?: readonly string[] | null;
  rules_text: string;
  power?: string | null;
  toughness?: string | null;
};

/**
 * What is wrong with a designed Spacecraft's / Planet's text against the
 * printed shape — each an ERROR of the design lint (lib/ai/mtg-rules.ts):
 * the judge is asked to fix it and the autofix repairs what a machine can.
 * [] for every other card, whatever its text.
 */
export function stationDesignProblems(card: StationLintInput): string[] {
  const word = stationWordOf(card);
  if (!word) return [];
  const all = everyTier(card.rules_text);
  const problems: string[] = [];
  if (all.tiers.length === 0) {
    return [
      `A ${word} prints its abilities in tiers: after the Station line, add one to three lines "N+ | text" (N = the charge counters that switch the tier on)${
        word === "Spacecraft" ? " — its power/toughness is printed on the last one" : ""
      }.`,
    ];
  }
  if (all.tiers.length > STATION_MAX_TIERS) {
    problems.push(`A ${word} has at most ${STATION_MAX_TIERS} tiers — this one has ${all.tiers.length} "N+ |" lines.`);
  }
  all.tiers.forEach((tier, i) => {
    if (tier.text === "") problems.push(`Tier ${tier.threshold}+ has no text.`);
    if (i > 0 && tier.threshold <= all.tiers[i - 1]!.threshold) {
      problems.push(`Tier numbers rise down the card: ${tier.threshold}+ comes after ${all.tiers[i - 1]!.threshold}+.`);
    }
    if (tier.text.length > STATION_ROW_MAX_CHARS) problems.push(`Tier ${tier.threshold}+ is over ${STATION_ROW_MAX_CHARS} characters — shorten it.`);
  });
  if (all.intro.length > STATION_ROW_MAX_CHARS) problems.push(`The text above the tiers is over ${STATION_ROW_MAX_CHARS} characters — shorten it.`);
  const hasPt = card.power != null && card.toughness != null;
  const expected = expectedStationLine(word, hasPt, all);
  const introLines = all.intro.split("\n").map((line) => line.trim()).filter(Boolean);
  const stationLines = introLines.filter(isStationLine);
  const last = introLines[introLines.length - 1] ?? "";
  if (stationLines.length !== 1 || !isStationLine(last) || plain(last) !== plain(expected)) {
    problems.push(`The last line before the tiers must be the Station line, word for word: "${expected}"`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Autofix — the last resort after the judge
// ---------------------------------------------------------------------------

/** A tier line written another way ("8+: Flying", "8+ — Flying",
 *  "STATION 8+ | Flying", "8 + | Flying"): what the designer meant. */
const NEAR_TIER_LINE = /^\s*(?:station\s+)?(\d{1,2})\s*\+\s*(?:\||:|—|–|-)\s*(.*)$/i;

/**
 * A Spacecraft's / Planet's text put into the printed shape by machine:
 * near-miss tier lines respelled, empty tiers dropped, numbers sorted to
 * rise (equal ones joined), tiers past the third folded into the third as
 * further lines, and the Station line set word for word as the last line of
 * the top band. Returns the text UNCHANGED for any other card — and for a
 * station card with no tier line at all: a machine does not invent a tier
 * (the card then never lands on a station frame, lib/creator/frame-random.ts).
 */
export function repairStationText(card: StationLintInput): string {
  const word = stationWordOf(card);
  if (!word) return card.rules_text;
  const respelled = card.rules_text
    .split(/\r?\n/)
    .map((line) => {
      const near = NEAR_TIER_LINE.exec(line);
      return near && Number(near[1]) >= 1 ? `${Number(near[1])}+ | ${near[2] ?? ""}` : line;
    })
    .join("\n");
  const all = everyTier(respelled);
  const filled = all.tiers.filter((tier) => tier.text !== "");
  if (filled.length === 0) return card.rules_text;
  // Rising numbers, equal ones joined (a stable sort keeps the text order).
  const sorted = [...filled].sort((a, b) => a.threshold - b.threshold);
  const joined: { threshold: number; text: string }[] = [];
  for (const tier of sorted) {
    const before = joined[joined.length - 1];
    if (before && before.threshold === tier.threshold) before.text = `${before.text}\n${tier.text}`;
    else joined.push({ threshold: tier.threshold, text: tier.text });
  }
  const tiers = joined.slice(0, STATION_MAX_TIERS);
  for (const extra of joined.slice(STATION_MAX_TIERS)) tiers[tiers.length - 1]!.text += `\n${extra.text}`;
  const kept = all.intro
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !isStationLine(line));
  const hasPt = card.power != null && card.toughness != null;
  const named = { intro: all.intro, tiers: tiers.map((tier) => ({ ...tier, pt: false })) };
  const intro = [...kept, expectedStationLine(word, hasPt, named)].join("\n");
  return serializeStation(intro, tiers);
}

// ---------------------------------------------------------------------------
// The per-field fill on a card that already has tiers
// ---------------------------------------------------------------------------

/** The lines of a station text, each with the tier it OPENS (its index),
 *  or null — the reading parseStationText makes of the same text. */
function tierLines(text: string): { raw: string; tier: number | null }[] {
  let tier = -1;
  return text.split(/\r?\n/).map((raw) => {
    const opens = /^(\d{1,2})\+\s*\|/.exec(raw);
    if (opens && Number(opens[1]) >= 1 && tier + 1 < STATION_MAX_TIERS) {
      tier += 1;
      return { raw, tier };
    }
    return { raw, tier: null };
  });
}

/** The tiers of `text` that have NO text yet (their indices) — what a fill
 *  of the rules text writes, leaving every other band alone. [] when the
 *  text has no tier, or none is empty. */
export function emptyStationTiers(text: string | null | undefined): number[] {
  const parsed = parseStationText(text);
  return parsed.tiers.flatMap((tier, i) => (tier.text === "" ? [i] : []));
}

/** The fill's prompt note for a card that already has tiers: with a gap
 *  the designer writes the gap alone; with none it may rewrite the text and
 *  is told the shape it has. "" for a text with no tier. */
export function stationFillNote(current: string | null | undefined): string {
  const parsed = parseStationText(current);
  if (parsed.tiers.length === 0) return "";
  const gaps = emptyStationTiers(current);
  const shape = parsed.tiers.map((tier) => `${tier.threshold}+`).join(", ");
  if (gaps.length === 0) {
    return `The card's text is laid out in tiers (${shape}). Keep that layout: the Station line, then "N+ | text" lines with rising numbers.`;
  }
  const wanted = gaps.map((i) => `${parsed.tiers[i]!.threshold}+`).join(" and ");
  return `The card's rules text already reads:\n${current!.trim()}\nWrite ONLY the text of tier ${wanted} (an empty "N+ |" line above). Reproduce every other line exactly as given, keep the tier numbers, and return the whole rules_text.`;
}

/**
 * The rules text a fill SAVES into the form for a card that already had
 * tiers. A tier with no text is a gap the maker left for the AI: the
 * designed text of the tier with the same number (else the tier at the same
 * place) is written into that line and EVERY OTHER LINE IS KEPT BYTE FOR
 * BYTE — the top band, the other tiers, their spelling. With no gap the
 * designed text is the answer (the maker asked for a new rules text).
 */
export function mergeStationFill(current: string | null | undefined, designed: string): string {
  const now = current ?? "";
  const gaps = emptyStationTiers(now);
  if (gaps.length === 0) return designed;
  const had = parseStationText(now);
  const got = parseStationText(designed);
  // A designed tier whose number the current text ALREADY has belongs to
  // that tier: it is never taken "by place" for a gap of another number —
  // that would fill the gap with a copy of a tier the maker wrote (the
  // independent check of #561: "3+ | \n8+ | Flying" answered with "8+ |
  // Flying" alone is a gap left, not "3+ | Flying").
  const known = new Set(had.tiers.map((tier) => tier.threshold));
  const lines = tierLines(now);
  return lines
    .map((line) => {
      if (line.tier === null || !gaps.includes(line.tier)) return line.raw;
      const threshold = had.tiers[line.tier]!.threshold;
      const byPlace = got.tiers[line.tier];
      const source =
        nthWithThreshold(got.tiers, threshold, occurrenceOf(had.tiers, line.tier)) ??
        (byPlace && !known.has(byPlace.threshold) ? byPlace : undefined);
      const text = source?.text.trim() ?? "";
      return text ? `${threshold}+ | ${text}` : line.raw;
    })
    .join("\n");
}

/** Which occurrence of its number tier `index` is (0 for the first tier
 *  with that number) — two tiers may share one. */
function occurrenceOf(tiers: readonly { threshold: number }[], index: number): number {
  const threshold = tiers[index]!.threshold;
  return tiers.slice(0, index).filter((tier) => tier.threshold === threshold).length;
}

/** The `n`-th tier (0-based) with `threshold`, if any. */
function nthWithThreshold<T extends { threshold: number }>(tiers: readonly T[], threshold: number, n: number): T | undefined {
  return tiers.filter((tier) => tier.threshold === threshold)[n];
}

/** A tier text that says nothing: blank, punctuation alone, or the Station
 *  reminder alone — a gap "written" so is still a gap. */
function saysNothing(text: string): boolean {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return true;
  if (lines.every((line) => isStationLine(line))) return true;
  return !/[\p{L}\p{N}{]/u.test(text);
}

/**
 * The gaps of `current` (their indices) that the merged fill text still
 * leaves EMPTY — the model and the judge came back without writing them
 * (mergeStationFill keeps such a line as it was). [] when every gap was
 * written, and for a text with no gap. A fill that leaves one is refused
 * before it is charged (owner 2026-10-14; createCardFillJob).
 */
export function stationGapsLeftEmpty(current: string | null | undefined, merged: string): number[] {
  const gaps = emptyStationTiers(current);
  if (gaps.length === 0) return [];
  const had = parseStationText(current);
  const now = parseStationText(merged);
  // Each gap is looked up by its number AND which occurrence of it it is,
  // so two tiers with one number are each checked.
  return gaps.filter((i) => {
    const tier = nthWithThreshold(now.tiers, had.tiers[i]!.threshold, occurrenceOf(had.tiers, i));
    return !tier || saysNothing(tier.text);
  });
}

/** What the fill dialog says when a fill was refused because the empty
 *  tier came back empty — nothing was charged, nothing in the form moved.
 *  `others`: the fill also asked for other fields (title, flavour, art…),
 *  which are not applied either. */
export function stationGapUnfilledMessage(count: number, others = false): string {
  const which = count > 1 ? "those tiers" : "that tier";
  const it = count > 1 ? "them" : "it";
  return others
    ? `The AI couldn't write ${which}, so nothing was applied and nothing was charged. Try again or write ${it} yourself.`
    : `The AI couldn't write ${which} — nothing was charged. Try again or write ${it} yourself.`;
}

/** Thrown by designCardFill (lib/ai/card-fill.ts) when a station card's empty tier came back
 *  empty. createCardFillJob turns it into a refused plan: no job row, no
 *  step, no spend — so nothing to refund or settle. */
export class StationGapUnfilledError extends Error {
  readonly code = "STATION_TIER_UNFILLED" as const;
  constructor(count: number, others = false) {
    super(stationGapUnfilledMessage(count, others));
    this.name = "StationGapUnfilledError";
  }
}

/**
 * The maker's "power / toughness on this tier" choice after a NEW rules
 * text arrived from a fill: it follows its tier by NUMBER (the tier may
 * have moved), and is dropped — null, "as the text says" — only when the
 * new text has no tier with that number. Null stays null.
 */
export function stationPtChoiceAfterFill(before: string | null | undefined, choice: number | null | undefined, after: string | null | undefined): number | null {
  if (choice == null || choice < 0) return choice ?? null;
  const threshold = parseStationText(before).tiers[choice]?.threshold;
  if (threshold === undefined) return null;
  const at = parseStationText(after).tiers.findIndex((tier) => tier.threshold === threshold);
  return at >= 0 ? at : null;
}

// ---------------------------------------------------------------------------
// What an AI job's save writes
// ---------------------------------------------------------------------------

/**
 * The rows a card saved by an AI job carries on a STATION frame — what the
 * creator's own save writes for a new card (lib/creator/structured-rules.ts
 * `submittedRulesOf`): the canonical text and `face_content.station`, the
 * P/T on the tier the text plates (its Station line's, else the last) or on
 * `ptTier` (a remix of the maker's own card keeps the tier they chose).
 * Null — the caller sends its text as it is and no rows — off the station
 * frames, for a text with no tier, and for rows the server would not store
 * (a band over 600 characters, numbers that do not rise): plain text draws
 * the same tiers.
 */
export function stationSaveFields(input: {
  template: string | null | undefined;
  rulesText: string | null | undefined;
  /** The card prints a power / toughness (printsPowerToughness). */
  hasPt: boolean;
  ptTier?: number | null;
}): { rules_text: string; face_content: FaceContent } | null {
  if (!isStationFrame(input.template)) return null;
  const parsed = parseStationText(input.rulesText);
  if (parsed.tiers.length === 0) return null;
  const own = input.ptTier != null && input.ptTier >= 0 && input.ptTier < parsed.tiers.length ? input.ptTier : null;
  const plated = !input.hasPt ? -1 : (own ?? platedTierIndex(parsed.intro, parsed.tiers));
  const content: FaceContent = {
    v: 1,
    station: {
      intro: parsed.intro || null,
      tiers: parsed.tiers.map((tier, i) => ({ threshold: tier.threshold, text: tier.text, ...(i === plated ? { pt: true as const } : {}) })),
    },
  };
  if (!faceContentSchema.safeParse(content).success) return null;
  return { rules_text: serializeStation(parsed.intro, parsed.tiers), face_content: content };
}

/** True when a remix's renamed text still has the source's tiers: as many,
 *  with the same numbers, in the same order. (The remix copies the rules and
 *  only swaps the card's names in them — this is the guard that a new name
 *  never made or unmade a tier line.) */
export function sameStationShape(before: string | null | undefined, after: string | null | undefined): boolean {
  const a = parseStationText(before).tiers;
  const b = parseStationText(after).tiers;
  return a.length === b.length && a.every((tier, i) => tier.threshold === b[i]!.threshold);
}
