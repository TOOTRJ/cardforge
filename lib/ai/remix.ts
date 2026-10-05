import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import type { Card, CardBackFace } from "@/types/card";
import { designModel } from "@/lib/ai/provider";
import { clampedText } from "@/lib/ai/card-design";
import { REMIX_DOUBLE_FACED_LAYOUTS, shortNameOf, type RemixSecondHalfLayout } from "@/lib/ai/remix-names";

// ---------------------------------------------------------------------------
// AI remix — a re-SKIN, never a redesign. The remix keeps the parent card's
// mechanics byte-identical (cost, type line, rules text, stats); the AI
// contributes a new name, new flavor, and an art instruction that re-renders
// the same scene in the requested style. Provenance rides on parent_card_id
// like every other remix.
//
// A two-part layout card (adventure, split, aftermath, flip) is renamed on
// BOTH halves, the two names read as one card (owner decision B3,
// 2026-09-29): the same one call, with a second name and flavour in its
// schema. lib/ai/remix-names.ts writes them onto the card.
// ---------------------------------------------------------------------------

// Prose lengths are clamped, never hard-failed — see clampedText.
const identityShape = {
  title: clampedText(80).describe(
    "New ORIGINAL name that fits the new style while echoing the original card's identity.",
  ),
  flavor_text: clampedText(280, 0)
    .nullable()
    .describe("New flavor text matching the style's tone. Null to omit."),
  art_instruction: clampedText(600).describe(
    "Instruction (under 90 words) for an image model that re-renders the ORIGINAL artwork in the new style: what to keep (subject, pose, composition) and how the style changes rendering, palette, and mood.",
  ),
};

const remixIdentitySchema = z.object(identityShape).strict();

const twoPartShape = {
  ...identityShape,
  second_title: clampedText(80).describe(
    "New ORIGINAL name for the card's second half, read together with the new title as one card.",
  ),
  second_flavor_text: clampedText(280, 0)
    .nullable()
    .describe(
      "New flavor text for the second half, in the same voice. Null when the original second half has none.",
    ),
};

const twoPartRemixIdentitySchema = z.object(twoPartShape).strict();

// A double-faced card's back face has its OWN artwork (TODO 5.4): the same
// one call also describes the second picture.
const doubleFacedRemixIdentitySchema = z
  .object({
    ...twoPartShape,
    second_art_instruction: clampedText(600).describe(
      "Instruction (under 90 words) for an image model that paints the BACK FACE's artwork in the new style: the back's own subject (what the front becomes, or the other mode), composed to read as the same card's other side. Never mention copyrighted artists or franchises. End with: \"No text, no frame, no borders.\"",
    ),
  })
  .strict();

export type RemixIdentity = z.infer<typeof remixIdentitySchema> & {
  /** Two-part cards only: the second half's new name and flavour. */
  second_title?: string;
  second_flavor_text?: string | null;
  /** Double-faced cards only (TODO 5.4): the back face's own art. */
  second_art_instruction?: string;
};

const SYSTEM_PROMPT = `You re-theme existing custom Magic: The Gathering-style cards into a new visual style ("anime", "pixel art", "oil painting", …). The card's MECHANICS ARE UNTOUCHABLE — you only rename it, rewrite the flavor text, and describe how the artwork should be re-rendered.

RULES:
- The new title must be ORIGINAL: never a published Magic card name, never Wizards-owned proper nouns, never real-world brands or franchises. It should feel like the same card wearing the new style.
- Flavor text: short, evocative, tuned to the new style's tone.
- art_instruction: tell an image model to re-render the PROVIDED artwork in the new style. Spell out what stays (subject, pose, composition, key colors) and what changes (rendering technique, linework, palette, mood). Never mention copyrighted artists or franchises. End with: "No text, no frame, no borders."
- Output ONLY the structured fields.`;

/** How a layout's second half relates to the first — what makes the two
 *  new names read as one card. */
export const SECOND_HALF_RELATIONSHIP: Record<RemixSecondHalfLayout, string> = {
  adventure:
    "The second half is an Adventure: a spell the first half's subject casts before it arrives, printed on the same card. Name it as that subject's deed, errand or tale, never a second character.",
  split:
    "The halves are two spells printed side by side on one card. Name them as a matched pair (opposites, or two beats of one idea), similar in shape and length.",
  aftermath:
    "The second half is cast later, from the graveyard. Name it as what follows the first half (its consequence or second act), so the two names read in order as one story.",
  flip:
    "The second half is the same being after the card flips upside down, transformed or ascended. Give that new form its own new name, so the pair reads as one being's two stages.",
  // The double-faced cards (TODO 5.4): the second half is the card's BACK
  // FACE, with its own artwork.
  transform:
    "The second half is the card's BACK FACE: what the front becomes when it transforms — the same being or place changed, unleashed or revealed. Name it as the front's other form, so the two names read as before and after.",
  mdfc:
    "The second half is the card's BACK FACE, the other MODE of a modal double-faced card: a different spell, creature or land the player may choose instead of the front. Name it as a second, related choice from the same world, not the same being.",
};

const GENERIC_RELATIONSHIP =
  "The second half is printed on the same card. Name the two halves so they read as one card.";

function twoPartRules(layout: RemixSecondHalfLayout | null): string {
  const doubleFaced = layout !== null && REMIX_DOUBLE_FACED_LAYOUTS.has(layout);
  return `

TWO-PART CARD: this card prints a second half ("second_half") on the same ${doubleFaced ? "card, on its back face" : "frame"}. Rename BOTH halves:
- second_title: a new ORIGINAL name for the second half, under the same rules as the title. ${layout ? SECOND_HALF_RELATIONSHIP[layout] : GENERIC_RELATIONSHIP}
- Neither new name may reuse either original name or any proper noun in them, and neither may be a keyword or game term (Flying, Trample, Exile, Adventure…).
- Keep each new name close to the length of the name it replaces: a half's title bar is small.
- A Legendary half gets a NEW character's proper name, shaped like the original's (for example a name and an epithet).
- second_flavor_text: new flavor for the second half in the same voice. Null when the original second half has none.${
    doubleFaced
      ? `
- second_art_instruction: the back face has its OWN artwork. Tell an image model what to paint for it in the new style — the back's subject (what the front becomes, or the other mode), composed to read as the same card's other side, in the same palette and technique as the front's instruction. Never mention copyrighted artists or franchises. End with: "No text, no frame, no borders."`
      : ""
  }`;
}

/** The original names — and a legendary's own name ("Dokai" of "Dokai,
 *  Weaver of Life", "Goka" of "Goka the Unjust"; shortNameOf) — the new
 *  ones must not reuse. Spelled out because a live run (2026-09-28) kept
 *  "Dokai" under the general rule; applyRemixNames enforces the same list. */
function reservedNamesLine(
  ...faces: { title: string; supertype?: string | null }[]
): string {
  const names = new Set<string>();
  for (const face of faces) {
    const name = face.title.trim();
    if (!name) continue;
    names.add(name);
    const short = shortNameOf(name, face.supertype);
    if (short) names.add(short);
  }
  return `Names the new ones must not reuse: ${[...names]
    .map((name) => JSON.stringify(name))
    .join(", ")}.`;
}

type RemixSourceFace = Pick<
  Card,
  | "title"
  | "cost"
  | "card_type"
  | "supertype"
  | "subtypes"
  | "rules_text"
  | "flavor_text"
  | "power"
  | "toughness"
>;

export type RemixIdentityInput = {
  card: RemixSourceFace;
  /** The second half a two-part layout frame paints (a Scryfall remix that
   *  landed on its adventure / split / aftermath / flip frame). */
  secondHalf?: { layout: RemixSecondHalfLayout | null; face: CardBackFace } | null;
  style: string;
  theme?: string;
};

function faceSummary(face: {
  title: string;
  cost?: string | null;
  card_type?: string | null;
  supertype?: string | null;
  subtypes?: string[] | null;
  rules_text?: string | null;
  flavor_text?: string | null;
  power?: string | null;
  toughness?: string | null;
}) {
  return {
    title: face.title,
    cost: face.cost,
    type: [face.supertype, face.card_type, ...(face.subtypes ?? [])]
      .filter(Boolean)
      .join(" "),
    rules_text: face.rules_text,
    flavor_text: face.flavor_text,
    stats:
      face.power != null && face.toughness != null
        ? `${face.power}/${face.toughness}`
        : null,
  };
}

/** The identity call's system prompt, prompt and schema — pure, so the
 *  prompt a one-face card sends stays pinned and a two-part card's is
 *  tested (tests/unit/ai/remix-identity.test.ts). */
export function buildRemixIdentityRequest(input: RemixIdentityInput) {
  const second = input.secondHalf ?? null;
  const summary = {
    ...faceSummary(input.card),
    ...(second
      ? { second_half: { layout: second.layout, ...faceSummary(second.face) } }
      : {}),
  };
  const doubleFaced = second?.layout != null && REMIX_DOUBLE_FACED_LAYOUTS.has(second.layout);
  return {
    twoPart: second != null,
    doubleFaced,
    schema: doubleFaced
      ? doubleFacedRemixIdentitySchema
      : second
        ? twoPartRemixIdentitySchema
        : remixIdentitySchema,
    system: second ? SYSTEM_PROMPT + twoPartRules(second.layout) : SYSTEM_PROMPT,
    prompt: [
      `Original card:\n${JSON.stringify(summary, null, 2)}`,
      second ? reservedNamesLine(input.card, second.face) : null,
      `Target style: ${input.style.trim().slice(0, 200)}`,
      input.theme?.trim()
        ? `Extra theme direction: ${input.theme.trim().slice(0, 300)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export async function generateRemixIdentity(
  input: RemixIdentityInput,
): Promise<RemixIdentity> {
  const request = buildRemixIdentityRequest(input);
  const { object } = await generateObject({
    model: designModel(),
    // Remix steps stack this call + an art fetch + up to two image calls
    // inside the step route's 180s budget — every leg must be bounded or the
    // composition rides into the platform kill (the original double-charge
    // incident mode). 30s is generous for one identity.
    abortSignal: AbortSignal.timeout(30_000),
    maxRetries: 1,
    schema: request.schema,
    system: request.system,
    prompt: request.prompt,
    temperature: 0.8,
  });
  return object as RemixIdentity;
}
