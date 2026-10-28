// ---------------------------------------------------------------------------
// Sagas and the two-part cards in the AI engine (the AI dialog redesign,
// PR 2) — the pure half: the kinds and their one frame, the design fields
// the model writes (a saga's chapter ROWS, a two-part card's SECOND PART),
// what the designer is told, what the lint enforces, what the autofix
// repairs, the plan-time fit (every gate the creator's save runs, read here
// before any credit is reserved) and the fill the creator pours into its
// own form paths. No model call, no React, no Supabase
// (tests/unit/ai/layout-design.test.ts).
//
// THE PRINTED SHAPES the rules follow:
//   • Saga — "Enchantment — Saga", no power / toughness; chapters I … VI
//     (most print three), a row may cover two ("I, II — …"); the reminder
//     "(As this Saga enters and after your draw step, add a lore counter.
//     Sacrifice after III.)" sits above the chapters.
//   • Split — two instants / sorceries side by side, each its own name, cost
//     and rules (Fire // Ice).
//   • Aftermath — the same, the lower half beginning "Aftermath (Cast this
//     spell only from your graveyard. Then exile it.)" (Cut // Ribbons).
//   • Adventure — a creature, and an instant or sorcery "— Adventure" on its
//     storybook page (Bonecrusher Giant // Stomp).
//   • Prepare — a creature that "enters prepared", and the instant or
//     sorcery on its page it may cast a copy of (SOS #109).
//   • Flip — a (legendary) creature and the flipped (legendary) creature,
//     each with a power / toughness; the flipped side has no mana cost.
//
// A second part's field the frame NEVER draws is never written (the
// creator's own rule, lib/creator/second-part-fields.ts): no flavour, artist,
// loyalty or defense on any second part, a power / toughness on a flip side
// only, no picture of its own on any of them (the one picture is the card's:
// split and aftermath are ONE painting, as the deck remix paints them).
// ---------------------------------------------------------------------------

import { z } from "zod";
import { colorWord } from "@/components/cards/frame-layer";
import {
  colorLettersFromWords,
  colorWordsFromLetters,
  deriveColorLetters,
  isNoCost,
  parseManaCost,
  withDrawableSymbols,
  type ColorLetter,
  type LintIssue,
} from "@/lib/ai/mtg-rules";
import { supertypeHasWord, withoutSupertypeWord } from "@/lib/cards/card-display";
import { serializeSaga, sagaFromRulesText } from "@/lib/cards/face-content";
import { frameGateError } from "@/lib/cards/frame-availability";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { cardFieldsFace, frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { drawsPartColor, frameGateColors, partColorFromCost, partColourVerdict } from "@/lib/cards/part-color";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_COLOR_KEYS, KIND_DEFS, framesForKind } from "@/lib/creator/card-kinds";
import { neverDrawnSecondPartUnits } from "@/lib/creator/second-part-fields";
import { undrawableSymbols, undrawableSymbolsMessage } from "@/lib/validation/card-glyphs";
import { FRAME_TEMPLATE_LABELS, type CardType, type ColorIdentity, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The kinds
// ---------------------------------------------------------------------------

/** The layout kinds the AI dialog can make, in the creator's chip order.
 *  (The double-faced kinds — and the double-faced saga front — are PR 3.) */
export const AI_LAYOUT_KINDS = ["saga", "adventure", "prepare", "split", "aftermath", "flip"] as const;
export type AiLayoutKind = (typeof AI_LAYOUT_KINDS)[number];

export function isAiLayoutKind(value: unknown): value is AiLayoutKind {
  return typeof value === "string" && (AI_LAYOUT_KINDS as readonly string[]).includes(value);
}

/** The ONE frame each layout kind is designed on — the kind's first layout
 *  template (never the double-faced saga front). */
export const LAYOUT_TEMPLATE: Readonly<Record<AiLayoutKind, FrameTemplate>> = {
  saga: "saga",
  adventure: "adventure",
  prepare: "prepare",
  split: "split",
  aftermath: "aftermath",
  flip: "flip",
};

/** The card types the FIRST part may be (what the AI designs). */
export const LAYOUT_FRONT_TYPES: Readonly<Record<AiLayoutKind, readonly CardType[]>> = {
  saga: ["enchantment"],
  adventure: ["creature"],
  prepare: ["creature"],
  split: ["instant", "sorcery"],
  aftermath: ["instant", "sorcery"],
  flip: ["creature"],
};

/** The card types the SECOND part may be; none for a saga. */
export const LAYOUT_SECOND_TYPES: Readonly<Partial<Record<AiLayoutKind, readonly CardType[]>>> = {
  adventure: ["instant", "sorcery"],
  prepare: ["instant", "sorcery"],
  split: ["instant", "sorcery"],
  aftermath: ["instant", "sorcery"],
  flip: ["creature"],
};

/** The front's card type the dialog steers to, where the kind has one. */
export function layoutSteerType(kind: AiLayoutKind): CardType | undefined {
  const types = LAYOUT_FRONT_TYPES[kind];
  return types.length === 1 ? types[0] : undefined;
}

export function layoutHasSecondPart(kind: AiLayoutKind): boolean {
  return kind !== "saga";
}

/** True when the second part prints a mana cost (a flip side has none). */
export function secondPartDrawsCost(kind: AiLayoutKind): boolean {
  const profile = getFrameProfile(LAYOUT_TEMPLATE[kind]);
  return Boolean(profile.adventure?.costSizePct ?? profile.secondFace?.costSizePct);
}

/** True when the second part prints a power / toughness (a flip side). */
export function secondPartDrawsPt(kind: AiLayoutKind): boolean {
  return !neverDrawnSecondPartUnits(getFrameProfile(LAYOUT_TEMPLATE[kind])).has("pt");
}

/** The colour keys the kind's frame is published in. */
export function layoutColorKeys(kind: AiLayoutKind, verifiedKeys: ReadonlySet<string>): string[] {
  const template = LAYOUT_TEMPLATE[kind];
  return [...(framesForKind(kind, verifiedKeys).find((choice) => choice.template === template)?.availableColorKeys ?? [])];
}

/** The same colours as the words the designer's colour hint takes. */
export function layoutColorHints(kind: AiLayoutKind, verifiedKeys: ReadonlySet<string>): ColorIdentity[] {
  const byKey: Record<string, ColorIdentity> = { w: "white", u: "blue", b: "black", r: "red", g: "green", c: "colorless", m: "multicolor" };
  return layoutColorKeys(kind, verifiedKeys).map((key) => byKey[key]!).filter(Boolean);
}

// ---------------------------------------------------------------------------
// The design fields
// ---------------------------------------------------------------------------

const clamped = (max: number, min = 1) =>
  z
    .string()
    .min(min)
    .transform((value) => value.trim().slice(0, max));

/** The saga's rows as the model writes them. Lenient on the numbers (the
 *  autofix brings them into I–VI); the limits of faceContentSchema — six
 *  rows, 600 characters a row, a 400-character intro — are the clamps. */
export const sagaDesignSchema = z
  .object({
    intro: clamped(400, 0)
      .nullable()
      .describe("The saga's reminder line, or null for the standard lore-counter reminder."),
    chapters: z
      .array(
        z
          .object({
            numerals: z
              .array(z.number().int())
              .min(1)
              .max(6)
              .describe("The chapter numbers this row covers: [1] for I, [2, 3] for 'II, III'."),
            text: clamped(600).describe("The chapter's effect, templated rules text."),
          })
          .strict(),
      )
      .min(1)
      .max(8)
      .describe("The chapter rows in order, I first."),
  })
  .strict();

/** A two-part card's second part as the model writes it. */
export const secondPartDesignSchema = z
  .object({
    title: clamped(80).describe("The second part's own original name."),
    cost: z.string().max(40).describe("Its curly-brace mana cost; '' for a flipped side (it has none)."),
    card_type: z.enum(["instant", "sorcery", "creature"]),
    supertype: clamped(64, 0).nullable().describe("Legendary etc., or null."),
    subtypes: z
      .array(clamped(40, 0))
      .transform((values) => values.filter(Boolean).slice(0, 6))
      .describe("Subtypes, e.g. ['Adventure'] for an adventure spell; [] when none."),
    rules_text: clamped(600).describe("The second part's templated rules text."),
    power: clamped(8, 0).nullable().describe("Only a flipped creature side has power / toughness; else null."),
    toughness: clamped(8, 0).nullable(),
  })
  .strict();

export type SagaDesign = z.infer<typeof sagaDesignSchema>;
export type SecondPartDesign = z.infer<typeof secondPartDesignSchema>;

/** The extra field a layout's design schema carries. */
export function layoutDesignPart(kind: AiLayoutKind): "saga" | "second_part" {
  return kind === "saga" ? "saga" : "second_part";
}

/** The design card's layout fields (on top of the one-faced design). */
export type LayoutDesignFields = {
  saga?: SagaDesign | null;
  second_part?: SecondPartDesign | null;
};

/** The design as the layout code reads it: the one-faced card and its
 *  layout fields. */
export type LayoutDesignCard = {
  title: string;
  cost: string;
  card_type: CardType;
  supertype: string | null;
  subtypes: string[];
  color_identity: ColorIdentity[];
  rules_text: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
} & LayoutDesignFields;

// ---------------------------------------------------------------------------
// What the designer is told
// ---------------------------------------------------------------------------

const AFTERMATH_LINE = "Aftermath (Cast this spell only from your graveyard. Then exile it.)";
const PREPARE_LINE = "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)";

/** The saga's standard reminder for its last chapter. */
export function sagaReminder(lastChapter: number): string {
  const roman = ["I", "II", "III", "IV", "V", "VI"][Math.min(Math.max(lastChapter, 1), 6) - 1];
  return `(As this Saga enters and after your draw step, add a lore counter. Sacrifice after ${roman}.)`;
}

const SECOND_PART_FIELDS =
  'Write `second_part` with: title (its OWN original name, never the first part\'s), cost, card_type, supertype, subtypes, rules_text, power and toughness.';

/** What the designer is told about the kind's shape (one paragraph). */
export function layoutShapeRules(kind: AiLayoutKind): string {
  switch (kind) {
    case "saga":
      return [
        'It is a SAGA: card_type "enchantment", subtypes include "Saga", supertype without "Creature", no power or toughness.',
        "Write `saga`: `chapters` — two to four rows (never more than six), chapter numbers I, II, III… in order from I with no gap or repeat, a row may cover two chapters ([1, 2] prints \"I, II —\"); each chapter ONE short effect under about 120 characters, building a small story; `intro` null (the frame prints the lore-counter reminder).",
        'rules_text: the same chapters as lines "I — effect".',
      ].join(" ");
    case "split":
      return [
        "It is a SPLIT card: two spells side by side, read together (\"Fire // Ice\").",
        'The first part is the card\'s own fields: card_type "instant" or "sorcery".',
        SECOND_PART_FIELDS,
        'The second part is an "instant" or "sorcery" with its own mana cost and no power / toughness (null). Each half: one short effect, under about 150 characters.',
        "The two halves are a matched pair: one idea told two ways, each castable on its own.",
      ].join(" ");
    case "aftermath":
      return [
        "It is an AFTERMATH card: the top half is cast from the hand, the aftermath half from the graveyard (\"Cut // Ribbons\").",
        'The first part is the card\'s own fields: card_type "instant" or "sorcery".',
        SECOND_PART_FIELDS,
        `The second part is an "instant" or "sorcery" with its own mana cost and no power / toughness (null); its rules_text begins with the line "${AFTERMATH_LINE}". Each half: under about 150 characters.`,
      ].join(" ");
    case "adventure":
      return [
        "It is an ADVENTURE card: a creature, and the adventure spell on its storybook page (\"Bonecrusher Giant // Stomp\").",
        'The first part is the creature: card_type "creature" with its power and toughness.',
        SECOND_PART_FIELDS,
        'The second part is an "instant" or "sorcery" whose subtypes are ["Adventure"], with its own mana cost and no power / toughness (null); its rules_text one short effect under about 120 characters.',
      ].join(" ");
    case "prepare":
      return [
        "It is a PREPARE card: a creature, and the spell on its page it can cast a copy of while it is prepared.",
        `The first part is the creature: card_type "creature" with its power and toughness; its rules_text says how it becomes prepared — usually the line "${PREPARE_LINE}"`,
        SECOND_PART_FIELDS,
        'The second part is an "instant" or "sorcery" with its own mana cost, no subtypes and no power / toughness (null); its rules_text one short effect under about 120 characters.',
      ].join(" ");
    case "flip":
      return [
        "It is a FLIP card: a creature that flips into another when a condition is met (the flipped side is printed upside down).",
        'The first part is the creature: card_type "creature" with its power and toughness; its rules_text ends with the condition that flips it ("…, flip it.").',
        SECOND_PART_FIELDS,
        'The second part is the flipped side: card_type "creature", usually supertype "Legendary", cost "" (a flipped side has no mana cost), its OWN power and toughness, rules_text under about 120 characters.',
      ].join(" ");
  }
}

/**
 * The frame brief for a layout kind (the frame-first brief of
 * lib/ai/frame-brief.ts, for the one frame the kind is made on).
 * `colorKeys`: the colours the frame is published in when the card's colour
 * is FREE — every part is held to them; omit when the colour is pinned.
 */
export function layoutFrameBrief(kind: AiLayoutKind, colorKeys?: readonly string[]): string {
  const template = LAYOUT_TEMPLATE[kind];
  const parts = [
    `FRAME (the maker picked it — design the card FOR it): "${FRAME_TEMPLATE_LABELS[template]}", the modern frame (2015 on).`,
    layoutShapeRules(kind),
  ];
  if (colorKeys && colorKeys.length > 0 && !FRAME_COLOR_KEYS.every((key) => colorKeys.includes(key))) {
    parts.push(
      kind === "saga"
        ? `Its color must be ${colorKeys.map(colorWord).join(" or ")} — the frame is published in no other.`
        : `Each part's color must be ${colorKeys.map(colorWord).join(" or ")} — the frame is published in no other.`,
    );
  }
  if (kind !== "saga") {
    parts.push("color_identity covers BOTH parts' mana symbols (the whole card).");
  }
  return parts.join(" ");
}

/** The prompt line that pins the second part's kept fields. */
export function secondPartPinNote(locked: LockedSecondPart | undefined): string | null {
  if (!locked) return null;
  const pinned: string[] = [];
  if (locked.title) pinned.push(`title "${locked.title}"`);
  if (locked.cost) pinned.push(`mana cost ${locked.cost}`);
  if (locked.rules_text) pinned.push(`rules text "${locked.rules_text}"`);
  if (locked.power && locked.toughness) pinned.push(`stats ${locked.power}/${locked.toughness}`);
  return pinned.length > 0
    ? `Its second part already exists in part. Keep these EXACTLY as given in second_part, verbatim: ${pinned.join("; ")}.`
    : null;
}

/** The second part's fields the maker keeps (the fill's `locked.back_face`):
 *  only those the fill is NOT writing are sent. */
export type LockedSecondPart = {
  title?: string;
  cost?: string;
  rules_text?: string;
  power?: string;
  toughness?: string;
};

// ---------------------------------------------------------------------------
// Normalize (always) — a saga's rules text IS its rows
// ---------------------------------------------------------------------------

/** The design with its saga rows written into rules_text (canonical, what
 *  the creator's saga editor reads back into the same rows) and the empty
 *  intro the standard reminder. Every other design: untouched. */
export function normalizeLayoutDesign<T extends LayoutDesignCard>(card: T, kind: AiLayoutKind | undefined): T {
  if (kind !== "saga") return card;
  // No rows but chapter lines in the text: those are its rows (the editor
  // reads them the same way).
  const rows = card.saga ?? (() => {
    const parsed = sagaFromRulesText(card.rules_text);
    return parsed.chapters.length > 0 ? parsed : null;
  })();
  if (!rows) return card;
  const chapters = rows.chapters.map((row) => ({ numerals: [...row.numerals], text: row.text.trim() }));
  const last = Math.max(0, ...chapters.flatMap((row) => row.numerals));
  const intro = rows.intro?.trim() || (last > 0 ? sagaReminder(last) : null);
  const saga = { intro, chapters };
  return { ...card, saga, rules_text: serializeSaga(intro, chapters) };
}

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

/** The saga's chapter numbers, flattened in row order. */
function chapterNumbers(chapters: readonly { numerals: readonly number[] }[]): number[] {
  return chapters.flatMap((row) => [...row.numerals]);
}

/** Problems with a saga's rows (errors): none, too many, a number outside
 *  I–VI, a gap or a repeat, an empty row. */
export function sagaRowProblems(saga: { chapters: readonly { numerals: readonly number[]; text: string }[] } | null | undefined): string[] {
  const out: string[] = [];
  const chapters = saga?.chapters ?? [];
  if (chapters.length === 0) return ["A saga needs chapter rows (I, II, III…)."];
  if (chapters.length > 6) out.push("A saga has at most six chapter rows.");
  const numbers = chapterNumbers(chapters);
  if (numbers.some((n) => n < 1 || n > 6)) out.push("Chapter numbers run from I to VI.");
  const expected = numbers.map((_, index) => index + 1);
  if (numbers.join(",") !== expected.join(",")) {
    out.push("Chapter numbers must run I, II, III… in order, with no gap or repeat.");
  }
  if (chapters.some((row) => !row.text.trim())) out.push("Every chapter row needs its effect.");
  return out;
}

const issue = (field: LintIssue["field"], message: string): LintIssue => ({ field, message });

/**
 * The layout's own errors and warnings for a design (on top of
 * lintCardDesign, which reads the first part). The whole card's colours
 * must cover BOTH parts' symbols.
 */
export function lintLayoutDesign(card: LayoutDesignCard, kind: AiLayoutKind): { errors: LintIssue[]; warnings: LintIssue[] } {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  if (!LAYOUT_FRONT_TYPES[kind].includes(card.card_type)) {
    errors.push(issue("rules_text", `A ${KIND_DEFS[kind].label} card's first part is ${LAYOUT_FRONT_TYPES[kind].join(" or ")}, never ${card.card_type}.`));
  }
  if (kind === "saga") {
    if (!(card.subtypes ?? []).some((subtype) => subtype.trim().toLowerCase() === "saga")) {
      errors.push(issue("supertype", 'A saga\'s subtypes include "Saga".'));
    }
    if (supertypeHasWord(card.supertype, "Creature") || card.power != null || card.toughness != null) {
      errors.push(issue("power", "The saga frame draws no power / toughness: no Creature word, no stats."));
    }
    for (const message of sagaRowProblems(card.saga)) errors.push(issue("rules_text", message));
    if (card.saga?.intro && !/lore counter/i.test(card.saga.intro)) {
      warnings.push(issue("rules_text", "The saga's intro is not the lore-counter reminder."));
    }
    return { errors, warnings };
  }
  const second = card.second_part;
  if (!second) {
    errors.push(issue("rules_text", "A two-part card needs its second_part."));
    return { errors, warnings };
  }
  if (!second.title.trim()) errors.push(issue("rules_text", "The second part needs its own name."));
  else if (second.title.trim().toLowerCase() === card.title.trim().toLowerCase()) {
    errors.push(issue("rules_text", "The second part needs a name of its own, not the first part's."));
  }
  const allowed = LAYOUT_SECOND_TYPES[kind] ?? [];
  if (!allowed.includes(second.card_type)) {
    errors.push(issue("rules_text", `The second part is ${allowed.join(" or ")}, never ${second.card_type}.`));
  }
  if (secondPartDrawsCost(kind)) {
    if (parseManaCost(second.cost) === null) {
      errors.push(issue("cost", `The second part's mana cost "${second.cost}" isn't valid curly-brace notation.`));
    } else if (isNoCost(second.cost)) {
      errors.push(issue("cost", "The second part needs a mana cost."));
    }
    const undrawn = undrawableSymbols(second.cost);
    if (undrawn.length > 0) errors.push(issue("cost", `${undrawableSymbolsMessage(undrawn)} — use a symbol the card has a pip for.`));
  } else if (!isNoCost(second.cost)) {
    errors.push(issue("cost", "A flipped side has no mana cost — use \"\"."));
  }
  const undrawnRules = undrawableSymbols(second.rules_text);
  if (undrawnRules.length > 0) errors.push(issue("rules_text", `${undrawableSymbolsMessage(undrawnRules)} — use a symbol the card has a pip for.`));
  if (!second.rules_text.trim()) errors.push(issue("rules_text", "The second part needs its rules text."));
  if (secondPartDrawsPt(kind)) {
    if (second.power == null || second.toughness == null || !second.power.trim() || !second.toughness.trim()) {
      errors.push(issue("power", "The flipped side is a creature: it needs both power and toughness."));
    }
  } else if (second.power != null || second.toughness != null) {
    errors.push(issue("power", "The second part has no power / toughness on this frame — use null."));
  }
  if (kind === "adventure" && !second.subtypes.some((subtype) => subtype.trim().toLowerCase() === "adventure")) {
    errors.push(issue("supertype", 'An adventure spell\'s subtypes are ["Adventure"].'));
  }
  if (kind === "aftermath" && !/^aftermath\b/i.test(second.rules_text.trim())) {
    errors.push(issue("rules_text", `The aftermath half's rules begin with "${AFTERMATH_LINE}".`));
  }
  // The whole card's colour covers both parts (owner decision M2).
  const declared = new Set(colorLettersFromWords(card.color_identity));
  const missing = deriveColorLetters(second.cost, second.rules_text).filter((letter) => !declared.has(letter));
  if (missing.length > 0) {
    errors.push(issue("color_identity", `The second part's mana symbols use ${missing.join(", ")} but the card's color_identity doesn't include them.`));
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Autofix — the last resort, after the judge: only what has one right value
// ---------------------------------------------------------------------------

/** The saga's rows put in order: numbers into I–VI, each once, from I, in
 *  rows of the sizes written; empty rows and a seventh row dropped. Never a
 *  row invented. */
export function repairSagaRows(chapters: readonly { numerals: readonly number[]; text: string }[]): { numerals: number[]; text: string }[] {
  const rows = chapters
    .map((row) => ({ size: Math.max(1, new Set(row.numerals).size), first: row.numerals.length > 0 ? Math.min(...row.numerals) : 99, text: row.text.trim() }))
    .filter((row) => row.text)
    .sort((a, b) => a.first - b.first);
  const out: { numerals: number[]; text: string }[] = [];
  let next = 1;
  for (const row of rows) {
    if (next > 6) break;
    const numerals: number[] = [];
    for (let i = 0; i < row.size && next <= 6; i += 1) numerals.push(next++);
    out.push({ numerals, text: row.text });
  }
  return out;
}

/** Pre-repair of the first part, before the one-faced autofix runs: a type
 *  the kind can't take becomes its first one; a saga gets its Saga subtype
 *  and loses a Creature word. */
export function autofixLayoutFront<T extends LayoutDesignCard>(card: T, kind: AiLayoutKind): T {
  const fixed = { ...card };
  if (!LAYOUT_FRONT_TYPES[kind].includes(fixed.card_type)) fixed.card_type = LAYOUT_FRONT_TYPES[kind][0]!;
  if (kind === "saga") {
    if (!fixed.subtypes.some((subtype) => subtype.trim().toLowerCase() === "saga")) fixed.subtypes = [...fixed.subtypes, "Saga"];
    // (…and no "Enchantment" word of its own: that is its card type.)
    for (const word of ["Creature", "Enchantment"]) {
      if (supertypeHasWord(fixed.supertype, word)) fixed.supertype = withoutSupertypeWord(fixed.supertype, word) || null;
    }
  }
  return fixed;
}

/** Repair of the layout fields after the one-faced autofix: the saga's rows
 *  (and its text from them), the second part's shape, and the whole card's
 *  colours from both parts. */
export function autofixLayoutParts<T extends LayoutDesignCard>(card: T, kind: AiLayoutKind): T {
  const fixed = { ...card };
  if (kind === "saga") {
    fixed.power = null;
    fixed.toughness = null;
    if (!fixed.saga) return fixed;
    // The standard reminder is written again for the rows as repaired (its
    // "Sacrifice after N" follows the last chapter); a maker-style intro of
    // the model's own stays.
    const intro = /^\(As this Saga enters/.test(fixed.saga.intro ?? "") ? null : fixed.saga.intro;
    return normalizeLayoutDesign({ ...fixed, saga: { intro, chapters: repairSagaRows(fixed.saga.chapters) } }, kind);
  }
  const second = fixed.second_part;
  if (!second) return fixed;
  const part = { ...second, subtypes: [...second.subtypes] };
  const allowed = LAYOUT_SECOND_TYPES[kind] ?? [];
  if (!allowed.includes(part.card_type)) part.card_type = allowed[0] as SecondPartDesign["card_type"];
  if (!secondPartDrawsCost(kind)) part.cost = "";
  else part.cost = withDrawableSymbols(part.cost);
  part.rules_text = withDrawableSymbols(part.rules_text);
  if (secondPartDrawsPt(kind)) {
    if (!part.power?.trim()) part.power = "2";
    if (!part.toughness?.trim()) part.toughness = "2";
  } else {
    part.power = null;
    part.toughness = null;
  }
  if (kind === "adventure" && !part.subtypes.some((subtype) => subtype.trim().toLowerCase() === "adventure")) {
    part.subtypes = ["Adventure", ...part.subtypes];
  }
  if (kind === "aftermath" && !/^aftermath\b/i.test(part.rules_text.trim())) {
    part.rules_text = `${AFTERMATH_LINE}\n${part.rules_text.trim()}`;
  }
  fixed.second_part = part;
  // The whole card's colours: both parts' symbols (M2).
  const letters = new Set<ColorLetter>([
    ...deriveColorLetters(fixed.cost, fixed.rules_text),
    ...deriveColorLetters(part.cost, part.rules_text),
  ]);
  if (letters.size > 0) fixed.color_identity = colorWordsFromLetters([...letters].sort());
  return fixed;
}

// ---------------------------------------------------------------------------
// The fit — every gate the creator's save runs, at plan time
// ---------------------------------------------------------------------------

/** The card as the creator will hold it once filled (the designed fields
 *  over the pinned ones). */
export type LayoutFace = {
  card_type: CardType;
  supertype: string | null | undefined;
  subtypes: readonly string[] | undefined;
  title: string | null | undefined;
  cost: string | null | undefined;
  rules_text: string | null | undefined;
  color_identity: readonly ColorIdentity[];
  power: string | null | undefined;
  toughness: string | null | undefined;
  second_part?: SecondPartDesign | null;
};

export type LayoutPartColour = {
  /** frame_style.partColor: on where the frame draws each part in its own
   *  colour and both are verified; false where it draws it and they are
   *  not (the look off — the card's whole colour, never a refused save);
   *  absent where the frame draws no part colour. */
  on?: boolean;
  /** frame_style.firstPartColor (a split / aftermath half's own). */
  first?: ColorIdentity[];
  /** back_face.color_identity: the second part's colour ([] = the card's). */
  second?: ColorIdentity[];
};

export type LayoutFit = {
  ok: boolean;
  /** Why not, for the log. */
  reason: string | null;
  partColour: LayoutPartColour;
};

/** A split / aftermath half's own colour where it is not the whole card's
 *  key (the import's rule, firstPartColorOf). */
function firstPartColorOf(template: FrameTemplate, cost: string | null | undefined, whole: readonly ColorIdentity[]): ColorIdentity[] | undefined {
  if (getFrameProfile(template).partColorSeam === undefined) return undefined;
  const first = partColorFromCost(cost);
  if (first.length === 0) return undefined;
  return pickFrameColorKey(first) === pickFrameColorKey([...whole]) ? undefined : first;
}

/**
 * Whether the filled card saves on the kind's frame: its types, its rows or
 * second part (the layout lint), the kind gate, each part's colour (on where
 * both are verified, else off) and the published-frame gate in the colour
 * the frame is verified in. Pure: the plan reads it before any credit is
 * reserved, so nothing can fail after the art.
 */
export function layoutFitOf(kind: AiLayoutKind, face: LayoutFace, verifiedKeys: ReadonlySet<string>): LayoutFit {
  const template = LAYOUT_TEMPLATE[kind];
  const no = (reason: string): LayoutFit => ({ ok: false, reason, partColour: {} });
  const saga = kind === "saga" ? sagaFromRulesText(face.rules_text) : null;
  const lint = lintLayoutDesign(
    {
      title: face.title ?? "",
      cost: face.cost ?? "",
      card_type: face.card_type,
      supertype: face.supertype ?? null,
      subtypes: [...(face.subtypes ?? [])],
      color_identity: [...face.color_identity],
      rules_text: face.rules_text ?? "",
      power: face.power?.trim() ? face.power : null,
      toughness: face.toughness?.trim() ? face.toughness : null,
      loyalty: null,
      defense: null,
      ...(saga ? { saga: { intro: saga.intro, chapters: saga.chapters } } : {}),
      second_part: face.second_part ?? null,
    },
    kind,
  );
  if (lint.errors.length > 0) return no(lint.errors.map((e) => e.message).join(" "));
  const kindError = frameKindGateError(
    template,
    cardFieldsFace({ card_type: face.card_type, supertype: face.supertype, subtypes: face.subtypes, title: face.title, rules_text: face.rules_text }),
  );
  if (kindError) return no(kindError);
  const whole = [...face.color_identity];
  let partColour: LayoutPartColour = {};
  if (drawsPartColor(template)) {
    const second = partColorFromCost(face.second_part?.cost);
    const first = firstPartColorOf(template, face.cost, whole);
    const verdict = partColourVerdict(template, whole, first, second, verifiedKeys);
    partColour = verdict.ok ? { on: true, ...(first ? { first } : {}), second } : { on: false, second: [] };
  }
  const gateColours = frameGateColors(template, { partColor: partColour.on, firstPartColor: partColour.first }, whole);
  const gate = frameGateError(template, gateColours, verifiedKeys);
  if (gate) return no(gate);
  return { ok: true, reason: null, partColour };
}

// ---------------------------------------------------------------------------
// The fill — what the creator pours into its back_face.* paths
// ---------------------------------------------------------------------------

/** A second part as the fill hands it to the creator: the `back_face.*`
 *  fields the frame draws, only those the fill was asked for. */
export type FillSecondPart = {
  title?: string;
  cost?: string;
  card_type?: CardType;
  supertype?: string | null;
  subtypes?: string[];
  rules_text?: string;
  power?: string | null;
  toughness?: string | null;
  /** The second part's own colour (TODO 4.26); [] = the card's. */
  color_identity?: ColorIdentity[];
  /** A split / aftermath half's own window: the SAME stored picture as the
   *  card's (owner 2026-10-28 — still one picture, one credit). Set by the
   *  step once the picture is painted (secondHalfSharesPicture). */
  art_url?: string;
};

/** True when the frame paints the second half in a window of its own (split,
 *  aftermath): the fill puts the card's one picture there too. */
export function secondHalfSharesPicture(template: FrameTemplate | string | null | undefined): boolean {
  return Boolean(template) && (template === LAYOUT_TEMPLATE.split || template === LAYOUT_TEMPLATE.aftermath) &&
    Boolean(getFrameProfile(template as FrameTemplate).secondFace?.artSlot);
}

/** The designed second part, kept to the fields wanted and the frame draws.
 *  (The fill is only offered with the card type written, so the type words
 *  always come with it.) */
export function fillSecondPartOf(
  kind: AiLayoutKind,
  second: SecondPartDesign,
  want: readonly string[],
): FillSecondPart {
  const has = (field: string) => want.includes(field);
  const out: FillSecondPart = {
    card_type: second.card_type,
    supertype: second.supertype,
    subtypes: [...second.subtypes],
  };
  if (has("title")) out.title = second.title;
  if (has("cost") && secondPartDrawsCost(kind)) out.cost = second.cost;
  if (has("rules_text")) out.rules_text = second.rules_text;
  if (has("stats") && secondPartDrawsPt(kind)) {
    out.power = second.power;
    out.toughness = second.toughness;
  }
  return out;
}

/** The second part as the card will hold it: the designed fields wanted,
 *  over the ones the maker keeps. */
export function mergedSecondPart(
  kind: AiLayoutKind,
  designed: SecondPartDesign | null | undefined,
  want: readonly string[],
  locked: LockedSecondPart | undefined,
): SecondPartDesign | null {
  if (!designed) return null;
  const has = (field: string) => want.includes(field);
  return {
    ...designed,
    title: has("title") ? designed.title : (locked?.title ?? designed.title),
    cost: !secondPartDrawsCost(kind) ? "" : has("cost") ? designed.cost : (locked?.cost ?? designed.cost),
    rules_text: has("rules_text") ? designed.rules_text : (locked?.rules_text ?? designed.rules_text),
    power: !secondPartDrawsPt(kind) ? null : has("stats") ? designed.power : (locked?.power ?? designed.power),
    toughness: !secondPartDrawsPt(kind) ? null : has("stats") ? designed.toughness : (locked?.toughness ?? designed.toughness),
  };
}
