import { z } from "zod";
import {
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
} from "@/types/card";

// ---------------------------------------------------------------------------
// Action identifiers — one per AI panel button.
// ---------------------------------------------------------------------------

export const AI_ACTIONS = [
  "improve_wording",
  "suggest_cost",
  "suggest_rarity",
  "generate_flavor",
  "generate_art_prompt",
  "check_balance",
  "generate_from_concept",
] as const;

export type AIAction = (typeof AI_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Shared card-context shape — the slice of the card state the AI sees.
// We deliberately omit owner_id, slug, art_url, etc. so the model can't be
// nudged by anything that isn't card-design-relevant.
// ---------------------------------------------------------------------------

export const cardContextSchema = z.object({
  title: z.string().max(160).optional(),
  cost: z.string().max(80).optional(),
  card_type: z.enum(CARD_TYPE_VALUES).optional(),
  supertype: z.string().max(80).optional(),
  subtypes: z.array(z.string().max(40)).max(10).optional(),
  rarity: z.enum(RARITY_VALUES).optional(),
  color_identity: z.array(z.enum(COLOR_IDENTITY_VALUES)).optional(),
  rules_text: z.string().max(4000).optional(),
  flavor_text: z.string().max(1000).optional(),
  power: z.string().max(16).optional(),
  toughness: z.string().max(16).optional(),
  loyalty: z.string().max(16).optional(),
  defense: z.string().max(16).optional(),
});

export type CardContext = z.infer<typeof cardContextSchema>;

// ---------------------------------------------------------------------------
// Request payload — what the client sends to /api/ai/card-assistant.
// ---------------------------------------------------------------------------

export const cardAssistantRequestSchema = z.object({
  action: z.enum(AI_ACTIONS),
  card: cardContextSchema,
  concept: z
    .string()
    .trim()
    .max(500, "Concept must be 500 characters or fewer.")
    .optional(),
});

export type CardAssistantRequest = z.infer<typeof cardAssistantRequestSchema>;

// ---------------------------------------------------------------------------
// Per-action output schemas — `generateObject` returns one of these.
// Each suggestion includes a short `reasoning` so the user understands why
// the model chose it. The applied field(s) for each action are documented
// inline so the UI can wire them up safely.
// ---------------------------------------------------------------------------

export const improveWordingOutputSchema = z.object({
  // Applies to: rules_text
  rules_text: z.string().min(1).max(4000),
  reasoning: z.string().max(400),
});

export const suggestCostOutputSchema = z.object({
  // Applies to: cost
  cost: z
    .string()
    .min(1)
    .max(40)
    .regex(
      /^[{}WUBRGCXY0-9\/ ]+$/i,
      "Cost may only contain mana-style tokens like {2}{R}{R}.",
    ),
  reasoning: z.string().max(400),
});

export const suggestRarityOutputSchema = z.object({
  // Applies to: rarity
  rarity: z.enum(RARITY_VALUES),
  reasoning: z.string().max(400),
});

export const generateFlavorOutputSchema = z.object({
  // Applies to: flavor_text
  flavor_text: z.string().min(1).max(280),
});

export const generateArtPromptOutputSchema = z.object({
  // Applies to: (no card field — caller uses it as a prompt for image gen
  // outside this app, or pastes into artist_credit notes).
  art_prompt: z.string().min(1).max(800),
});

export const checkBalanceOutputSchema = z.object({
  // Applies to: nothing — this is read-only commentary.
  risk_level: z.enum(["low", "medium", "high"]),
  summary: z.string().max(280),
  concerns: z.array(z.string().max(280)).max(5),
  suggestions: z.array(z.string().max(280)).max(5),
});

export const generateFromConceptOutputSchema = z.object({
  // Applies to: many fields. The UI offers an apply-all button.
  title: z.string().min(1).max(120),
  cost: z.string().max(40).optional(),
  card_type: z.enum(CARD_TYPE_VALUES),
  supertype: z.string().max(64).optional(),
  subtypes: z.array(z.string().max(40)).max(6),
  rarity: z.enum(RARITY_VALUES),
  color_identity: z.array(z.enum(COLOR_IDENTITY_VALUES)).max(6),
  rules_text: z.string().min(1).max(2000),
  flavor_text: z.string().max(280).optional(),
  power: z.string().max(16).optional(),
  toughness: z.string().max(16).optional(),
});

// ---------------------------------------------------------------------------
// Discriminated union of all suggestion payloads — used by the route + UI.
// ---------------------------------------------------------------------------

export type Suggestion =
  | { action: "improve_wording"; data: z.infer<typeof improveWordingOutputSchema> }
  | { action: "suggest_cost"; data: z.infer<typeof suggestCostOutputSchema> }
  | { action: "suggest_rarity"; data: z.infer<typeof suggestRarityOutputSchema> }
  | { action: "generate_flavor"; data: z.infer<typeof generateFlavorOutputSchema> }
  | {
      action: "generate_art_prompt";
      data: z.infer<typeof generateArtPromptOutputSchema>;
    }
  | { action: "check_balance"; data: z.infer<typeof checkBalanceOutputSchema> }
  | {
      action: "generate_from_concept";
      data: z.infer<typeof generateFromConceptOutputSchema>;
    };

export type CardAssistantResponse =
  | { ok: true; suggestion: Suggestion }
  | { ok: false; error: string };
