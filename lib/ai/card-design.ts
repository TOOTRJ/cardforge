import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import {
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
  type CardType,
  type ColorIdentity,
  type Rarity,
} from "@/types/card";
import { designModel, judgeModel } from "@/lib/ai/provider";
import {
  autofixCard,
  lintCardDesign,
  type LintIssue,
  type SkeletonSlot,
} from "@/lib/ai/mtg-rules";

// ---------------------------------------------------------------------------
// Card-design engine — the one text pipeline behind every AI generation flow
// (single card, options dialog, remix, sets, decks).
//
// Pipeline per batch:
//   1. DESIGN  — one structured call to the design model with per-slot
//                quotas (rarity/color/role) computed in code, few-shot
//                examples, and modern templating rules.
//   2. LINT    — deterministic checks (lib/ai/mtg-rules.ts) split into hard
//                errors and judgement warnings.
//   3. JUDGE   — if anything flagged, ONE repair call to the cheaper judge
//                model with the flawed cards + their issues.
//   4. AUTOFIX — any error that survives the judge gets mechanically
//                repaired so downstream createCardAction never sees a
//                shape-invalid card. Warnings that survive are reported,
//                not blocking — pushed designs are a homebrew liberty.
//
// IP guardrails live in the shared system prompt (same posture as the card
// assistant): real MTG keywords/templating allowed, published card names and
// Wizards-owned proper nouns forbidden.
// ---------------------------------------------------------------------------

/**
 * Prose field that can never fail validation on length. Models cannot count
 * characters, so a hard zod .max() on free text intermittently fails an
 * otherwise-perfect generation (seen live: a 900-char world blurb vs a 600
 * cap killed the whole set plan). Overlong text is trimmed instead; the
 * .describe() guidance still keeps outputs near the target length.
 */
export function clampedText(max: number, min = 1) {
  return z
    .string()
    .min(min)
    .transform((value) => value.trim().slice(0, max));
}

export const designedCardSchema = z
  .object({
    title: clampedText(80).describe(
      "Original card name — never a published Magic card title.",
    ),
    cost: z
      .string()
      .min(1)
      .max(40)
      .describe("Curly-brace mana cost (e.g. {2}{R}{R}). Use '—' for lands."),
    card_type: z.enum(CARD_TYPE_VALUES),
    supertype: clampedText(64, 0)
      .nullable()
      .describe("Legendary/Basic/Snow etc. Null when none."),
    subtypes: z
      .array(clampedText(40, 0))
      .transform((values) => values.filter(Boolean).slice(0, 6))
      .describe("Subtypes like ['Dragon', 'Elder']. [] when none."),
    rarity: z.enum(RARITY_VALUES),
    color_identity: z
      .array(z.enum(COLOR_IDENTITY_VALUES))
      .min(1)
      .max(6)
      .describe("Colors used by the mana cost and rules text."),
    rules_text: clampedText(800).describe(
      "Templated rules text. Reminder text in (parentheses).",
    ),
    flavor_text: clampedText(280, 0)
      .nullable()
      .describe("Short italic flavor. Null when omitted."),
    power: clampedText(8, 0).nullable(),
    toughness: clampedText(8, 0).nullable(),
    loyalty: clampedText(8, 0).nullable(),
    defense: clampedText(8, 0).nullable(),
    art_prompt: clampedText(600).describe(
      "Vivid 60-100 word illustration prompt for this card: subject, action, environment, lighting, palette. NO frame, NO text.",
    ),
  })
  .strict();

export type DesignedCard = z.infer<typeof designedCardSchema>;

export type DesignReport = {
  /** Warnings that survived the judge pass, per card index. */
  warnings: Array<{ index: number; title: string; issues: LintIssue[] }>;
  /** True when the judge repair pass ran. */
  judged: boolean;
  /** Card indexes that needed mechanical autofix after the judge. */
  autofixed: number[];
};

export type DesignBatchInput = {
  /** World/story prompt, e.g. "haunted lighthouse keepers". Optional. */
  theme?: string;
  /** Art/tone style, e.g. "anime", "pixelate", "grimdark oil painting". */
  style?: string;
  /** Per-card quotas. Length = number of cards generated. */
  slots: DesignSlot[];
  /** Extra prose context, e.g. the set's title/blurb or deck strategy. */
  context?: string;
};

export type DesignSlot = {
  rarity?: Rarity;
  colorHint?: ColorIdentity | null;
  cardType?: CardType;
  roleHint?: SkeletonSlot["roleHint"];
  /** Freeform per-slot direction, e.g. "the deck's commander". */
  note?: string;
};

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the card designer for PipGlyph, a homebrew Magic: The Gathering-style card creator. You design ORIGINAL cards that feel like they could be printed in a real MTG set: correct templating, honest costs, resonant fantasy flavor.

DESIGN VOCABULARY YOU MAY USE FREELY:
- Any published MTG keyword ability (Flying, Trample, Deathtouch, Ward, Cascade, Flashback, Cycling, Kicker, …). Give niche keywords reminder text in (parentheses).
- Curly-brace mana templating: {W} {U} {B} {R} {G} {C} {X}, hybrid {W/U}, mono-hybrid {2/W}, Phyrexian {W/P}, snow {S}, generics like {2}.
- Modern rules templating: "When ~ enters, …", "Whenever …", "At the beginning of …", "Target creature …". Use "their" (never "his or her"), "on the battlefield" (never "in play"), "exile" (never "remove from the game"), "dies" for creatures going to a graveyard, "can't" (never "cannot"). Name self-references exactly as the card's title.
- The color pie: white = order/protection/small creatures in numbers; blue = knowledge/control/flying/counterspells; black = ambition/death/paying life; red = passion/direct damage/haste/chaos; green = growth/big creatures/mana/fighting.

MTG LORE POSTURE:
- Evoke classic Magic archetypes and moods — goblin raids, wizard duels, sprawling multiverse fantasy — but set everything in YOUR OWN original world. Invent original character, place, and faction names.
- NEVER copy a published Magic card name verbatim or near-verbatim ("Lightning Bolt", "Counterspell", "Sol Ring" are off-limits as titles; the mechanical ideas behind them are fine).
- NEVER use Wizards-owned proper nouns (Jace, Liliana, Ravnica, Phyrexia-the-place, set names) as card identity.
- NEVER reference unrelated real-world brands or franchises.

BALANCE — design for real casual play:
- Cost effects honestly. Rough creature yardstick: a vanilla creature's power + toughness ≈ 2×(mana value) + 1; every strong ability trims stats or raises cost. Pushed rares may bend this, never break it for free.
- Powerful effects want real downsides (enters tapped, sacrifice, discard, life payments) — not fake ones.
- Commons: one simple idea, low complexity. Uncommons: a twist or build-around hook. Rares: distinctive, splashy. Mythics: a set's showcase moment — dramatic but not "auto-win".

EXAMPLE OUTPUTS (match this quality and templating exactly):
{"title":"Lanternhollow Vigil","cost":"{1}{W}","card_type":"creature","supertype":null,"subtypes":["Spirit","Cleric"],"rarity":"common","color_identity":["white"],"rules_text":"Vigilance\\nWhen Lanternhollow Vigil enters, you gain 2 life.","flavor_text":"The lanterns never gutter while she watches.","power":"2","toughness":"1","loyalty":null,"defense":null,"art_prompt":"A serene spirit cleric in flowing pale robes holding a brass lantern aloft on a fog-drowned village wall at dusk, warm golden lantern light cutting through cold blue mist, soft painterly fantasy illustration, quiet and watchful mood."}
{"title":"Riptide Calculus","cost":"{1}{U}{U}","card_type":"instant","supertype":null,"subtypes":[],"rarity":"uncommon","color_identity":["blue"],"rules_text":"Counter target spell unless its controller pays {2}. Draw a card.","flavor_text":"\\"Every wave breaks. I simply know where.\\"","power":null,"toughness":null,"loyalty":null,"defense":null,"art_prompt":"A sea-mage mid-gesture atop a tidal rock, a colossal wave frozen in impossible geometric spirals above her, teal and silver palette, dramatic backlighting through the curl of the wave, detailed oil-painted fantasy illustration."}
{"title":"Emberwake Tyrant","cost":"{3}{R}{R}","card_type":"creature","supertype":null,"subtypes":["Dragon"],"rarity":"rare","color_identity":["red"],"rules_text":"Flying, haste\\nWhenever Emberwake Tyrant attacks, it deals 2 damage to each other attacking creature you control and 2 damage to each player.","flavor_text":"Its allies learned to fly behind it.","power":"4","toughness":"4","loyalty":null,"defense":null,"art_prompt":"A furious crimson dragon erupting from a volcanic caldera at dawn, wings scattering embers over a charging warband below, orange and ash-grey palette, cinematic low-angle composition, painterly high-fantasy illustration."}

OUTPUT RULES:
- power/toughness only for creatures and tokens; loyalty only for planeswalkers; defense only for battles; otherwise null.
- color_identity must cover every colored mana symbol in the cost AND the rules text.
- art_prompt: 60-100 words, subject + action + environment + lighting + palette. No frames, no text, no copyrighted artist or world names.
- Output ONLY the structured fields. No preamble.`;

function slotLine(slot: DesignSlot, index: number): string {
  const parts: string[] = [`Card ${index + 1}:`];
  if (slot.rarity) parts.push(`rarity ${slot.rarity}.`);
  if (slot.cardType) parts.push(`card_type ${slot.cardType}.`);
  else if (slot.roleHint === "creature") parts.push("prefer a creature.");
  else if (slot.roleHint === "noncreature") parts.push("prefer a noncreature spell or permanent.");
  if (slot.colorHint) parts.push(`color: ${slot.colorHint}.`);
  else if (slot.colorHint === null) parts.push("color: designer's choice (artifact/multicolor welcome).");
  if (slot.note) parts.push(slot.note);
  return parts.join(" ");
}

function batchPrompt(input: DesignBatchInput): string {
  const lines: string[] = [];
  if (input.theme?.trim()) lines.push(`Theme: ${input.theme.trim().slice(0, 300)}`);
  if (input.style?.trim()) {
    lines.push(
      `Art & tone style: ${input.style.trim().slice(0, 200)} — every art_prompt must explicitly render in this style, and names/flavor should suit it.`,
    );
  }
  if (input.context?.trim()) lines.push(input.context.trim().slice(0, 1000));
  lines.push(
    `Design exactly ${input.slots.length} card${input.slots.length === 1 ? "" : "s"}:`,
  );
  input.slots.forEach((slot, index) => lines.push(slotLine(slot, index)));
  if (input.slots.length > 1) {
    lines.push(
      "The cards belong together: shared world, recurring names/factions, and at least one mechanical thread connecting them.",
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Judge → fix
// ---------------------------------------------------------------------------

const repairSchema = z
  .object({
    cards: z.array(designedCardSchema).min(1),
  })
  .strict();

const JUDGE_SYSTEM = `You are the rules editor for a Magic: The Gathering-style card designer. You receive drafted cards plus lint findings. Fix every ERROR exactly (mana-cost grammar, stat slots per card type, color identity). Address WARNINGS with the lightest possible touch: adjust a cost or stat line for balance flags, modernize templating, add reminder text to unknown keywords — keep each card's concept, name, and feel intact. Return the corrected cards in the SAME order, complete (every field, changed or not).`;

async function judgeRepair(
  flawed: Array<{ card: DesignedCard; issues: LintIssue[] }>,
): Promise<DesignedCard[] | null> {
  const prompt = flawed
    .map(({ card, issues }, index) =>
      [
        `Card ${index + 1}: ${JSON.stringify(card)}`,
        `Findings: ${issues.map((issue) => `[${issue.field}] ${issue.message}`).join(" | ")}`,
      ].join("\n"),
    )
    .join("\n\n");
  try {
    const { object } = await generateObject({
      model: judgeModel(),
      schema: repairSchema,
      system: JUDGE_SYSTEM,
      prompt,
      temperature: 0.2,
    });
    if (object.cards.length !== flawed.length) return null;
    return object.cards;
  } catch {
    // Judge is best-effort — autofix below still guarantees shape validity.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type DesignBatchResult = {
  cards: DesignedCard[];
  report: DesignReport;
};

const batchSchema = z
  .object({
    cards: z.array(designedCardSchema).min(1),
  })
  .strict();

/**
 * Design a batch of cards (1..N). Callers own auth/rate-limit/credits; this
 * function owns quality. Always returns exactly `input.slots.length` cards,
 * each guaranteed lint-error-free (via judge repair, then autofix).
 */
export async function designCards(
  input: DesignBatchInput,
): Promise<DesignBatchResult> {
  const { object } = await generateObject({
    model: designModel(),
    schema: batchSchema,
    system: SYSTEM_PROMPT,
    prompt: batchPrompt(input),
    temperature: 0.9,
  });

  // Trim/pad drift: the model occasionally overshoots the requested count.
  let cards = object.cards.slice(0, input.slots.length);

  // ---- Lint ----
  let lints = cards.map((card) => lintCardDesign(card));
  const flawedIndexes = lints
    .map((lint, index) => ({ lint, index }))
    .filter(({ lint }) => lint.errors.length > 0 || lint.warnings.length > 0)
    .map(({ index }) => index);

  // ---- Judge repair (one pass, only the flawed cards) ----
  let judged = false;
  if (flawedIndexes.length > 0) {
    judged = true;
    const repaired = await judgeRepair(
      flawedIndexes.map((index) => ({
        card: cards[index],
        issues: [...lints[index].errors, ...lints[index].warnings],
      })),
    );
    if (repaired) {
      cards = cards.map((card, index) => {
        const repairIndex = flawedIndexes.indexOf(index);
        return repairIndex === -1 ? card : repaired[repairIndex];
      });
      lints = cards.map((card) => lintCardDesign(card));
    }
  }

  // ---- Autofix any surviving hard errors ----
  const autofixed: number[] = [];
  cards = cards.map((card, index) => {
    if (lints[index].errors.length === 0) return card;
    autofixed.push(index);
    return autofixCard(card);
  });

  const finalLints = cards.map((card) => lintCardDesign(card));
  return {
    cards,
    report: {
      judged,
      autofixed,
      warnings: finalLints
        .map((lint, index) => ({
          index,
          title: cards[index].title,
          issues: lint.warnings,
        }))
        .filter((entry) => entry.issues.length > 0),
    },
  };
}

export type SingleCardOptions = {
  theme?: string;
  style?: string;
  cardType?: CardType;
  rarity?: Rarity;
  colorHint?: ColorIdentity;
};

/** Design one card. Used by the random-card flow and the options dialog. */
export async function designSingleCard(
  options: SingleCardOptions = {},
): Promise<{ card: DesignedCard; report: DesignReport }> {
  const { cards, report } = await designCards({
    theme: options.theme,
    style: options.style,
    slots: [
      {
        cardType: options.cardType,
        rarity: options.rarity,
        colorHint: options.colorHint,
        note:
          options.theme || options.style || options.cardType
            ? undefined
            : "No steering — surprise the user with a creative, well-rounded design.",
      },
    ],
  });
  return { card: cards[0], report };
}
