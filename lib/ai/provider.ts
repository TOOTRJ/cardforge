import "server-only";

import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

// ---------------------------------------------------------------------------
// Model resolution for the card-design engine.
//
// Preference order:
//   1. Vercel AI Gateway — opt-in via AI_GATEWAY_API_KEY. Model ids are
//      plain "provider/model" strings (the AI SDK routes strings through the
//      gateway automatically). One key, provider fallbacks, and access to
//      image models we have no direct key for (FLUX etc.).
//   2. Direct Anthropic (ANTHROPIC_API_KEY — already required by the card
//      assistant), which produces noticeably better rules templating than
//      the legacy gpt-4o flow.
//   3. Direct OpenAI (OPENAI_API_KEY) as the last resort so existing deploys
//      keep working with zero new env vars.
//
// Overrides: AI_DESIGN_MODEL / AI_JUDGE_MODEL accept either a gateway string
// ("anthropic/claude-sonnet-4-5") or a bare model id ("claude-sonnet-4-5",
// "gpt-4o") — bare ids are routed to the matching direct SDK.
// ---------------------------------------------------------------------------

const GATEWAY_DESIGN_DEFAULT = "anthropic/claude-sonnet-4-5";
const GATEWAY_JUDGE_DEFAULT = "anthropic/claude-haiku-4-5";
const DIRECT_ANTHROPIC_DESIGN_DEFAULT = "claude-sonnet-4-5";
const DIRECT_ANTHROPIC_JUDGE_DEFAULT = "claude-haiku-4-5";
const DIRECT_OPENAI_DESIGN_DEFAULT = "gpt-4o";
const DIRECT_OPENAI_JUDGE_DEFAULT = "gpt-4o-mini";

export function isGatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
}

function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function isOpenAiKeyConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/** Any provider capable of running the text design pipeline. */
export function isDesignAiConfigured(): boolean {
  return isGatewayConfigured() || isAnthropicConfigured() || isOpenAiKeyConfigured();
}

function resolve(
  override: string | undefined,
  defaults: { gateway: string; anthropic: string; openai: string },
): LanguageModel {
  const trimmed = override?.trim() || undefined;

  if (isGatewayConfigured()) {
    if (!trimmed) return defaults.gateway;
    // Gateway wants "provider/model"; tolerate bare ids by guessing the
    // provider from the id prefix.
    if (trimmed.includes("/")) return trimmed;
    return trimmed.startsWith("claude") ? `anthropic/${trimmed}` : `openai/${trimmed}`;
  }

  // Direct SDKs — strip any gateway-style prefix from the override.
  const bare = trimmed?.includes("/") ? trimmed.slice(trimmed.indexOf("/") + 1) : trimmed;
  if (bare?.startsWith("claude") && isAnthropicConfigured()) return anthropic(bare);
  if (bare && !bare.startsWith("claude") && isOpenAiKeyConfigured()) return openai(bare);

  if (isAnthropicConfigured()) return anthropic(defaults.anthropic);
  return openai(defaults.openai);
}

/** Frontier model that drafts card designs. */
export function designModel(): LanguageModel {
  return resolve(process.env.AI_DESIGN_MODEL, {
    gateway: GATEWAY_DESIGN_DEFAULT,
    anthropic: DIRECT_ANTHROPIC_DESIGN_DEFAULT,
    openai: DIRECT_OPENAI_DESIGN_DEFAULT,
  });
}

/** Cheaper model for the judge→fix pass. */
export function judgeModel(): LanguageModel {
  return resolve(process.env.AI_JUDGE_MODEL, {
    gateway: GATEWAY_JUDGE_DEFAULT,
    anthropic: DIRECT_ANTHROPIC_JUDGE_DEFAULT,
    openai: DIRECT_OPENAI_JUDGE_DEFAULT,
  });
}
