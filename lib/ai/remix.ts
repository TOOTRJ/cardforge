import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import type { Card } from "@/types/card";
import { designModel } from "@/lib/ai/provider";
import { clampedText } from "@/lib/ai/card-design";

// ---------------------------------------------------------------------------
// AI remix — a re-SKIN, never a redesign. The remix keeps the parent card's
// mechanics byte-identical (cost, type line, rules text, stats); the AI
// contributes a new name, new flavor, and an art instruction that re-renders
// the same scene in the requested style. Provenance rides on parent_card_id
// like every other remix.
// ---------------------------------------------------------------------------

// Prose lengths are clamped, never hard-failed — see clampedText.
export const remixIdentitySchema = z
  .object({
    title: clampedText(80).describe(
      "New ORIGINAL name that fits the new style while echoing the original card's identity.",
    ),
    flavor_text: clampedText(280, 0)
      .nullable()
      .describe("New flavor text matching the style's tone. Null to omit."),
    art_instruction: clampedText(600).describe(
      "Instruction (under 90 words) for an image model that re-renders the ORIGINAL artwork in the new style: what to keep (subject, pose, composition) and how the style changes rendering, palette, and mood.",
    ),
  })
  .strict();

export type RemixIdentity = z.infer<typeof remixIdentitySchema>;

const SYSTEM_PROMPT = `You re-theme existing custom Magic: The Gathering-style cards into a new visual style ("anime", "pixel art", "oil painting", …). The card's MECHANICS ARE UNTOUCHABLE — you only rename it, rewrite the flavor text, and describe how the artwork should be re-rendered.

RULES:
- The new title must be ORIGINAL: never a published Magic card name, never Wizards-owned proper nouns, never real-world brands or franchises. It should feel like the same card wearing the new style.
- Flavor text: short, evocative, tuned to the new style's tone.
- art_instruction: tell an image model to re-render the PROVIDED artwork in the new style. Spell out what stays (subject, pose, composition, key colors) and what changes (rendering technique, linework, palette, mood). Never mention copyrighted artists or franchises. End with: "No text, no frame, no borders."
- Output ONLY the structured fields.`;

export async function generateRemixIdentity(input: {
  card: Pick<
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
  style: string;
  theme?: string;
}): Promise<RemixIdentity> {
  const { card } = input;
  const summary = {
    title: card.title,
    cost: card.cost,
    type: [card.supertype, card.card_type, ...(card.subtypes ?? [])]
      .filter(Boolean)
      .join(" "),
    rules_text: card.rules_text,
    flavor_text: card.flavor_text,
    stats:
      card.power != null && card.toughness != null
        ? `${card.power}/${card.toughness}`
        : null,
  };

  const { object } = await generateObject({
    model: designModel(),
    schema: remixIdentitySchema,
    system: SYSTEM_PROMPT,
    prompt: [
      `Original card:\n${JSON.stringify(summary, null, 2)}`,
      `Target style: ${input.style.trim().slice(0, 200)}`,
      input.theme?.trim()
        ? `Extra theme direction: ${input.theme.trim().slice(0, 300)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
    temperature: 0.8,
  });
  return object;
}
