import "server-only";

import { streamObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { DeepPartial } from "ai";
import {
  cardAssistantRequestSchema,
  checkBalanceOutputSchema,
  generateArtPromptOutputSchema,
  generateFlavorOutputSchema,
  generateFromConceptOutputSchema,
  improveWordingOutputSchema,
  suggestCostOutputSchema,
  suggestRarityOutputSchema,
  type AIAction,
  type CardAssistantRequest,
  type CardContext,
} from "@/lib/ai/schemas";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "claude-haiku-4-5";

function modelId(): string {
  return process.env.AI_CARD_MODEL?.trim() || DEFAULT_MODEL;
}

export function isAIConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

// ---------------------------------------------------------------------------
// Prompt building — same system header for every action so the no-copyright
// guardrail is impossible to bypass via action-specific prompts.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Spellwright's design assistant, helping a user craft a single custom Magic: The Gathering-style card.

ABSOLUTE RULES — VIOLATING THESE FAILS THE TASK:
- Never use proprietary names, character names, planeswalker names, set names, or world names from Magic: The Gathering, Wizards of the Coast, Hasbro, or any other official trading card game IP. Examples to avoid: Jace, Liliana, Chandra, Ajani, Innistrad, Ravnica, Dominaria, Phyrexia, the Eldrazi, Bolas, etc.
- Never reference real-world brands, trademarks, or copyrighted franchises.
- Stick to original, generic fantasy vocabulary that any homebrew designer would feel comfortable shipping under their own name.
- Keep mana-style costs in curly-brace notation like {2}{R}{R} where R = red, G = green, B = black, U = blue, W = white, C = colorless, X = variable.

STYLE:
- Match the existing card's tone (provided as JSON below).
- Card text should be evocative but readable; rules text should be templated and unambiguous.
- Avoid sycophantic preambles like "Great question!" or "Sure, here's…". Output only the structured fields you're asked for.
`;

function describeCard(card: CardContext): string {
  // Compact JSON keeps token usage low and is easy for the model to parse.
  // We strip undefined/empty fields so the model isn't tempted to inherit them.
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(card)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    filtered[key] = value;
  }
  return JSON.stringify(filtered, null, 2);
}

function actionPrompt(request: CardAssistantRequest): string {
  const cardJson = describeCard(request.card);
  const header = `Current card state:\n\`\`\`json\n${cardJson}\n\`\`\``;

  switch (request.action) {
    case "improve_wording":
      return `${header}

Task: Rewrite the card's rules text so it reads cleanly, uses standard templating ("When …", "Whenever …", "At the beginning of …", "Pay {N}"), and avoids ambiguous phrasing. Keep the same gameplay effect — don't invent new abilities. If there's no rules text yet, write a faithful first draft that matches the card's type and color identity. Cap output at ~3 short sentences.

Provide one paragraph of reasoning explaining what you changed and why.`;

    case "suggest_cost":
      return `${header}

Task: Suggest a mana-style cost for this card using curly-brace notation (e.g. {2}{R}, {X}{G}{G}, {W}{U}). Consider the card's type, rules text, power/toughness (for creatures), and color identity. Costs should feel fair for casual play — not artificially cheap. Output only the cost string and your reasoning.`;

    case "suggest_rarity":
      return `${header}

Task: Pick a rarity from common / uncommon / rare / mythic that fits the card's power level, complexity, and design space.

Heuristic:
- common: simple, straightforward, plays at almost every power level
- uncommon: slightly more complex; "build-around-me" lite
- rare: distinctive effect, build-around, or high-impact
- mythic: showcase card, hero of a deck or set

Output only the rarity and one short paragraph of reasoning.`;

    case "generate_flavor":
      return `${header}

Task: Write one short, evocative flavor text snippet for this card. Max two sentences. May be a quote (with an italicized attribution like —"NAME, ROLE") or a brief in-world observation. Must feel native to the card's color identity and type. Do NOT reuse any proprietary names.`;

    case "generate_art_prompt":
      return `${header}

Task: Write a single descriptive art prompt the user can paste into an image generator. ~80–120 words. Include: subject, action/pose, environment, lighting, color palette mood, and a 2-3 word art-style hint (e.g. "oil-painted fantasy illustration"). Stay original — never reference a copyrighted artist or fictional world by name.`;

    case "check_balance":
      return `${header}

Task: Evaluate the card's balance for casual play. Return:
- risk_level: "low" / "medium" / "high"
- summary: one sentence overall verdict
- concerns: a list of specific balance worries (cost vs. effect, swingy interactions, etc.). Up to 5 items.
- suggestions: a list of concrete tweaks the designer could try. Up to 5 items.

Be honest — flag overpowered or unfun designs even when the user clearly likes them. If the card is well-balanced, say so plainly.`;

    case "generate_from_concept":
      return `${header}

User's concept: "${request.concept ?? ""}"

Task: Draft a complete card from the user's concept. Fill in every applicable field:
- title (original, generic fantasy)
- cost (curly-brace mana-style cost, or "—" for lands)
- card_type (one of: creature, spell, artifact, enchantment, land, token)
- supertype (e.g. Legendary) — optional, only if it adds to the design
- subtypes (e.g. ["Dragon", "Elder"]) — short list, up to 6
- rarity (common / uncommon / rare / mythic)
- color_identity (subset of: white, blue, black, red, green, colorless, multicolor)
- rules_text — clean, templated, 1–3 sentences max
- flavor_text — short, evocative (optional)
- power / toughness — only for creature/token types, otherwise omit

If the user's concept is too vague, pick reasonable defaults rather than asking follow-ups. Match the existing card state's vibes when they don't conflict with the concept.`;
  }
}

// ---------------------------------------------------------------------------
// Streaming response builder — NDJSON protocol.
//
// Each line emitted is a single JSON object terminated by `\n`:
//   { "partial": <DeepPartial>, "action": "<action_name>" }   ← repeated
//   { "done":    { "action": "<action_name>", "data": <final> } }
//   { "error":   "<friendly message>" }                        ← on failure
//
// The client (components/creator/ai-assistant-panel.tsx) consumes this via
// fetch + ReadableStream getReader(). NDJSON keeps each event self-contained
// and easy to recover from if a chunk lands mid-line — the client only
// dispatches on full lines.
// ---------------------------------------------------------------------------

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson",
  "Cache-Control": "no-cache, no-transform",
};

function ndjsonError(message: string, status = 400): Response {
  const body = JSON.stringify({ error: message }) + "\n";
  return new Response(body, { status, headers: NDJSON_HEADERS });
}

type StreamObjectResult<T> = {
  partialObjectStream: AsyncIterable<DeepPartial<T>>;
  object: Promise<T>;
};

function makeStream<T>(
  result: StreamObjectResult<T>,
  action: AIAction,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const writeLine = (payload: object) => {
        controller.enqueue(
          encoder.encode(JSON.stringify(payload) + "\n"),
        );
      };
      try {
        for await (const partial of result.partialObjectStream) {
          writeLine({ partial, action });
        }
        const final = await result.object;
        writeLine({ done: { action, data: final } });
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "Unknown AI provider error.";
        writeLine({ error: friendlyError(detail) });
      } finally {
        controller.close();
      }
    },
  });
}

/**
 * Validate the request, kick off a streaming AI call, and return a
 * streaming NDJSON Response. The caller (the route handler) is expected
 * to have already done auth + rate-limit checks; this function is purely
 * concerned with the AI-provider conversation.
 */
export function streamCardAssistantResponse(rawRequest: unknown): Response {
  const parsed = cardAssistantRequestSchema.safeParse(rawRequest);
  if (!parsed.success) {
    return ndjsonError(
      parsed.error.issues[0]?.message ?? "Invalid request.",
      400,
    );
  }

  if (!isAIConfigured()) {
    return ndjsonError(
      "AI assistant isn't configured. Set ANTHROPIC_API_KEY in your environment.",
      503,
    );
  }

  const request = parsed.data;
  const prompt = actionPrompt(request);
  const model = anthropic(modelId());

  // Branch by action so each `streamObject` call gets its narrow schema.
  // The result is fed into the shared NDJSON encoder.
  switch (request.action) {
    case "improve_wording": {
      const result = streamObject({
        model,
        schema: improveWordingOutputSchema,
        system: SYSTEM_PROMPT,
        prompt,
      });
      return new Response(makeStream(result, "improve_wording"), {
        headers: NDJSON_HEADERS,
      });
    }
    case "suggest_cost": {
      const result = streamObject({
        model,
        schema: suggestCostOutputSchema,
        system: SYSTEM_PROMPT,
        prompt,
      });
      return new Response(makeStream(result, "suggest_cost"), {
        headers: NDJSON_HEADERS,
      });
    }
    case "suggest_rarity": {
      const result = streamObject({
        model,
        schema: suggestRarityOutputSchema,
        system: SYSTEM_PROMPT,
        prompt,
      });
      return new Response(makeStream(result, "suggest_rarity"), {
        headers: NDJSON_HEADERS,
      });
    }
    case "generate_flavor": {
      const result = streamObject({
        model,
        schema: generateFlavorOutputSchema,
        system: SYSTEM_PROMPT,
        prompt,
      });
      return new Response(makeStream(result, "generate_flavor"), {
        headers: NDJSON_HEADERS,
      });
    }
    case "generate_art_prompt": {
      const result = streamObject({
        model,
        schema: generateArtPromptOutputSchema,
        system: SYSTEM_PROMPT,
        prompt,
      });
      return new Response(makeStream(result, "generate_art_prompt"), {
        headers: NDJSON_HEADERS,
      });
    }
    case "check_balance": {
      const result = streamObject({
        model,
        schema: checkBalanceOutputSchema,
        system: SYSTEM_PROMPT,
        prompt,
      });
      return new Response(makeStream(result, "check_balance"), {
        headers: NDJSON_HEADERS,
      });
    }
    case "generate_from_concept": {
      if (!request.concept || request.concept.trim().length === 0) {
        return ndjsonError(
          "Give the assistant a concept to riff on (a sentence or two is plenty).",
          400,
        );
      }
      const result = streamObject({
        model,
        schema: generateFromConceptOutputSchema,
        system: SYSTEM_PROMPT,
        prompt,
      });
      return new Response(makeStream(result, "generate_from_concept"), {
        headers: NDJSON_HEADERS,
      });
    }
  }
}

function friendlyError(detail: string): string {
  const lower = detail.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "Hit the AI rate limit. Wait a minute and try again.";
  }
  if (lower.includes("auth") || lower.includes("401") || lower.includes("403")) {
    return "AI provider rejected the key. Double-check ANTHROPIC_API_KEY.";
  }
  if (lower.includes("timeout")) {
    return "The AI provider took too long to respond. Try again.";
  }
  return `AI error: ${detail}`;
}
