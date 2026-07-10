import "server-only";

import type { LanguageModel } from "ai";

// ---------------------------------------------------------------------------
// Model resolution for the card-design engine.
//
// The AI SDK 6.0+ uses AI Gateway string model IDs ("provider/model") by
// default. These work with any provider API key (ANTHROPIC_API_KEY,
// OPENAI_API_KEY, etc.) or with AI_GATEWAY_API_KEY for unified access.
//
// Overrides: AI_DESIGN_MODEL / AI_JUDGE_MODEL accept either a gateway string
// ("anthropic/claude-sonnet-4.5") or a bare model id ("claude-sonnet-4.5",
// "gpt-4o") — bare ids are automatically prefixed with the provider.
// ---------------------------------------------------------------------------

const DEFAULT_DESIGN_MODEL = "anthropic/claude-sonnet-4.5";
const DEFAULT_JUDGE_MODEL = "anthropic/claude-haiku-4.5";

/**
 * True when the AI Gateway itself is reachable — an explicit key, or the
 * OIDC token Vercel injects on deployments with the gateway enabled. Image
 * flows use this to pick gateway models (FLUX / Gemini) over the direct
 * OpenAI image API; text flows don't need it (string ids fall back through
 * provider keys).
 */
export function isGatewayConfigured(): boolean {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY?.trim() ||
      process.env.VERCEL_OIDC_TOKEN?.trim(),
  );
}

/** Check if any AI provider is configured. */
export function isDesignAiConfigured(): boolean {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY?.trim() ||
      process.env.ANTHROPIC_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim(),
  );
}

function resolve(
  override: string | undefined,
  defaultModel: string,
): LanguageModel {
  const trimmed = override?.trim();
  if (!trimmed) return defaultModel;

  // If already in "provider/model" format, use as-is
  if (trimmed.includes("/")) return trimmed;

  // Bare model id - prefix with provider based on model name pattern
  if (trimmed.startsWith("claude")) return `anthropic/${trimmed}`;
  if (trimmed.startsWith("gpt") || trimmed.startsWith("o1") || trimmed.startsWith("o3")) {
    return `openai/${trimmed}`;
  }

  // Unknown format, return as-is and let the AI SDK handle it
  return trimmed;
}

/** Frontier model that drafts card designs. */
export function designModel(): LanguageModel {
  return resolve(process.env.AI_DESIGN_MODEL, DEFAULT_DESIGN_MODEL);
}

/** Cheaper model for the judge→fix pass. */
export function judgeModel(): LanguageModel {
  return resolve(process.env.AI_JUDGE_MODEL, DEFAULT_JUDGE_MODEL);
}
