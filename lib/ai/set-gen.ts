import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import {
  designCards,
  type DesignedCard,
  type DesignReport,
} from "@/lib/ai/card-design";
import { judgeModel } from "@/lib/ai/provider";
import { buildSetSkeleton } from "@/lib/ai/mtg-rules";

// ---------------------------------------------------------------------------
// AI set generator (formerly deck-gen.ts — it always generated SETS; renamed
// ahead of the real deck generator so the names stop lying).
//
// Two-step pipeline:
//   1. SET CONCEPT — a cheap call drafts the set's title, blurb, and a world
//      paragraph from the user's theme/style.
//   2. CARDS — the shared card-design engine (prompt + lint + judge→fix)
//      generates one card per skeleton slot, where the skeleton's
//      rarity/color/role quotas are computed in code from real post-2024
//      set ratios (lib/ai/mtg-rules.ts). The world paragraph rides along as
//      context so names and factions recur across the whole set.
//
// Text only — art/icon generation joins in the jobs pipeline (set gen v2).
// Each generated card costs credits (SET_CARD_CREDIT_COST), metered by the
// route. IP guardrails live in the engine's system prompt.
// ---------------------------------------------------------------------------

export const MIN_SET_SIZE = 3;
export const MAX_SET_SIZE = 12;
export const DEFAULT_SET_SIZE = 8;
export const SET_CARD_CREDIT_COST = 1;

export type SetOutput = {
  set_title: string;
  set_description: string;
  cards: DesignedCard[];
  report: DesignReport;
};

export function clampSetSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SET_SIZE;
  return Math.max(MIN_SET_SIZE, Math.min(MAX_SET_SIZE, Math.round(value)));
}

const setConceptSchema = z
  .object({
    set_title: z.string().min(1).max(80).describe("Original expansion name."),
    set_description: z
      .string()
      .max(300)
      .describe("One-sentence pitch for the set."),
    world_blurb: z
      .string()
      .max(600)
      .describe(
        "A short paragraph describing the set's world: place names, factions, conflict, visual identity. Original names only.",
      ),
  })
  .strict();

const SET_CONCEPT_SYSTEM = `You name and pitch ORIGINAL Magic: The Gathering-style expansion sets for a homebrew tool. Given a theme, invent an evocative set title, a one-sentence description, and a short world paragraph (places, factions, conflict, visual identity) that card designers will build from. Everything must be original — never Wizards-owned set, plane, or character names, never real-world brands.`;

export async function generateSet(input: {
  theme: string;
  style?: string;
  size: number;
  /** When generating INTO an existing set, its identity anchors the concept
   *  (the returned set_title is ignored by the caller in that case). */
  existingSet?: { title: string; description: string | null };
}): Promise<SetOutput> {
  const size = clampSetSize(input.size);
  const theme =
    input.theme.trim().slice(0, 300) ||
    "a balanced, flavorful original expansion slice — surprise me";

  const { object: concept } = await generateObject({
    model: judgeModel(),
    schema: setConceptSchema,
    system: SET_CONCEPT_SYSTEM,
    prompt: [
      `Theme: ${theme}`,
      input.style?.trim() ? `Art/tone style: ${input.style.trim().slice(0, 200)}` : null,
      input.existingSet
        ? `The cards join an EXISTING set called "${input.existingSet.title}"${
            input.existingSet.description ? ` — ${input.existingSet.description}` : ""
          }. Keep the concept consistent with it (set_title should echo it).`
        : null,
      `The set will contain ${size} cards.`,
    ]
      .filter(Boolean)
      .join("\n"),
    temperature: 0.9,
  });

  const { cards, report } = await designCards({
    theme,
    style: input.style,
    slots: buildSetSkeleton(size),
    context: `These cards belong to the set "${concept.set_title}" — ${concept.set_description}\nWorld: ${concept.world_blurb}\nReuse this world's names and factions across the cards.`,
  });

  return {
    set_title: concept.set_title,
    set_description: concept.set_description,
    cards,
    report,
  };
}
