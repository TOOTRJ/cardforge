import type { LanguageModel } from "ai";

// ---------------------------------------------------------------------------
// The model + sampling options of every TEXT call (generateObject).
//
// Claude Sonnet 5.5 and Haiku 5.5 (the design and judge defaults since
// Sonnet 4.5's retirement on 2026-11-30) answer a request that sets
// `temperature`, `top_p` or `top_k` with a 400 ("`temperature` is deprecated for this model"), and so do Opus
// 4.7 / 4.8, every Claude 5 model, Fable and Mythos. The AI Gateway drops the
// field today before it reaches Anthropic, but that is the gateway's rewrite,
// not a contract (its fallbacks are Bedrock and Vertex) — so a call never
// SENDS a sampling parameter a model refuses. A model that still takes one
// (Claude 4.6 and older, a non-reasoning id set through AI_DESIGN_MODEL /
// AI_JUDGE_MODEL) keeps the temperature the call asks for. That "still takes
// one" holds on the API version the gateway sends today: Anthropic's
// 2026-10-21 version refuses sampling on EVERY model, Haiku 4.5 included.
//
// Nothing else model-specific is sent: no thinking / effort options, no
// tool_choice and no assistant prefill. Measured through the gateway on
// 2026-11-09: these calls ran on Sonnet 5.5 with 0 thinking tokens (as
// Sonnet 4.5 did; the gateway set that, whatever thinking options were sent)
// and generateObject's JSON response format came back as native structured
// output (a text block, never a forced tool call, which 5.x refuses). Both
// are the gateway's choices, not a contract.
// ---------------------------------------------------------------------------

function modelIdOf(model: LanguageModel): string {
  if (typeof model === "string") return model;
  const id = (model as { modelId?: unknown }).modelId;
  return typeof id === "string" ? id : "";
}

/** "claude-sonnet-5.5", "claude-haiku-4-5-20251001", "claude-opus-4-8". The
 *  minor is one or two digits, so "claude-sonnet-4-20250514" reads as 4.0. */
const FAMILY_FIRST = /claude-(?:opus|sonnet|haiku)-(\d+)(?:[.-](\d{1,2})(?!\d))?/;
/** The older naming: "claude-3-5-sonnet-latest", "claude-3-haiku-20240307". */
const VERSION_FIRST = /claude-(\d+)(?:[.-](\d{1,2})(?!\d))?-(?:opus|sonnet|haiku)/;

/** True when a request to `model` may carry temperature / top_p / top_k. */
export function acceptsSamplingParams(model: LanguageModel): boolean {
  const id = modelIdOf(model).toLowerCase();
  // OpenAI's reasoning models (o1, o3, o4-mini, gpt-5…) refuse a temperature.
  if (/(?:^|\/)(?:o\d|gpt-5)/.test(id)) return false;
  if (!id.includes("claude")) return true;
  if (/claude-(?:fable|mythos)/.test(id)) return false;
  const match = FAMILY_FIRST.exec(id) ?? VERSION_FIRST.exec(id);
  // A Claude id we can't read: leave the parameter out (omitting it never
  // fails a request; sending it can).
  if (!match) return false;
  const major = Number(match[1]);
  const minor = match[2] === undefined ? 0 : Number(match[2]);
  if (major >= 5) return false;
  if (major === 4 && minor >= 7) return false;
  return true;
}

/** `{ model, temperature? }` for a generateObject call — the temperature
 *  only where the model accepts one. */
export function textModelOptions(
  model: LanguageModel,
  temperature: number,
): { model: LanguageModel; temperature?: number } {
  return acceptsSamplingParams(model) ? { model, temperature } : { model };
}
