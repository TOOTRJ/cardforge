import "server-only";
import {
  AI_FAILURE_COPY,
  classifyProviderError,
  imageFailureKind,
  type AiFailureKind,
} from "@/lib/ai/failure";

import { experimental_generateImage as generateImage, generateText } from "ai";
import { isGatewayConfigured } from "@/lib/ai/provider";
import { autoOrientBytes } from "@/lib/media/orientation";
import { imageWithoutMetadata } from "@/lib/media/upload-bytes";
import { modelInputImage } from "@/lib/media/model-input";
import { ASPECT_RATIOS, type ArtShape } from "@/lib/ai/art-aspect";
import { FULLY_CLOTHED_LINE } from "@/lib/ai/art-prompt-safety";

// ---------------------------------------------------------------------------
// Image generation + image-to-image restyle. ALL image generation goes through
// the Vercel AI Gateway — there is deliberately NO direct-OpenAI fallback.
//
// A silent gateway→OpenAI fallback once ran every image on gpt-image-1 (~5×
// the FLUX cost, and far slower) for weeks because the gateway key wasn't set
// in prod. Images now always route through the gateway; if it's not configured
// or the call fails, we surface an error rather than quietly (and expensively)
// falling back. gpt-image-1 is never used.
//
//   - Text-to-image (batch/deck/set art): FLUX via the gateway
//     (default bfl/flux-2-flex, override AI_IMAGE_MODEL), HEDGED by ONE
//     backup gateway model (bfl/flux-2-pro, override AI_IMAGE_FALLBACK_MODEL;
//     owner 2026-10-28) — see generatePlainImage. That is a second GATEWAY
//     model, never a provider outside the gateway.
//   - Image-to-image restyle ("AI remix"): a multimodal gateway model
//     (default google/gemini-2.5-flash-image, override AI_IMAGE_REMIX_MODEL)
//     via generateText — the edited image comes back in result.files.
//   - A restyle that may NAME its model and asks for the art window's shape
//     (restyleWithFallbacks — Re-art deck's "from the card's art"): the same
//     default, or the named model alone; an image model is handed the
//     picture with the prompt (generateImage `prompt.images`), a multimodal
//     one as a message. Tried for real on the dev key (2026-11-14): FLUX.2
//     [pro], FLUX.1 Kontext, Grok Imagine (both) and Gemini's image models
//     keep the picture's subject and pose; FLUX.2 [flex] paints a new scene
//     and ignores the picture — never the default here.
// ---------------------------------------------------------------------------

const GATEWAY_REMIX_DEFAULT = "google/gemini-2.5-flash-image";

/** Hard ceiling on a single image call. The step route's function budget is
 *  180s (maxDuration); an unbounded gateway hang used to ride straight into
 *  that platform kill, which axed the request AFTER the credit spend + card
 *  insert but BEFORE the step result persisted — the root cause of the
 *  2026-07-14 duplicate-card/credit-drain incident. Aborting turns a hang
 *  into a HANDLED failure (step patched "failed", credit refunded, retry
 *  offered).
 *
 *  The default for a caller that names no budget: every card picture
 *  now passes IMAGE_BUDGET_MS / CARD_STEP_IMAGE_BUDGET_MS. Steps that stack
 *  several bounded calls (remix: identity 30s + source fetch 10s + restyle +
 *  t2i fallback) pass tighter per-call budgets so the SUM stays inside 180s
 *  — a single generous cap does not compose. */
const IMAGE_CALL_TIMEOUT_MS = 100_000;

export type ImageCallOptions = {
  /** Override the per-call abort budget (ms). */
  timeoutMs?: number;
  /**
   * Paint with THIS gateway model and no other: the default model and its
   * backup are both left out, so the result's `model` is always the one
   * named (Re-art deck's model picker — a tester has to know what painted;
   * the caller validates the id against its own list, never a user's free
   * text). The picture's shape is asked the way that model takes it
   * (imageShapeArgs); a multimodal model that answers with an image file
   * (Gemini) is called as one (isMultimodalImageModel).
   */
  model?: string;
};

export type PaintOptions = ImageCallOptions & {
  /** May the backup model be started for this picture (default true)? */
  backup?: boolean;
  /** Told when the backup model is started (the ladder spends it once). */
  onBackupStarted?: () => void;
};

/** Map a raw provider error to its failure kind and the user's sentence.
 *  The raw text is logged here (server only, truncated) and NEVER returned:
 *  it used to reach the user as "Image generation failed: <detail>", and a
 *  credential / quota problem told them to "check the AI keys". */
export function imageFailure(detail: string, model: string): { kind: AiFailureKind; error: string } {
  const kind = imageFailureKind(classifyProviderError(detail));
  console.warn(`[ai:image] ${model} failed (${kind}): ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
  return { kind, error: AI_FAILURE_COPY[kind] };
}

/** The prompt a model is sent: the caller's, cut to `max` characters with
 *  room kept for the "fully clothed" line (owner 2026-10-28: on EVERY art
 *  prompt, text-to-image and restyle alike — added here, at the one gateway
 *  door, so no path can forget it). A prompt that already ends with it is
 *  sent as is. */
export function withFullyClothedLine(prompt: string, max: number): string {
  const trimmed = prompt.trim();
  if (trimmed.endsWith(FULLY_CLOTHED_LINE)) return trimmed.slice(0, max);
  return `${trimmed.slice(0, max - FULLY_CLOTHED_LINE.length - 1).trimEnd()} ${FULLY_CLOTHED_LINE}`;
}

export type RestyleResult =
  | { ok: true; bytes: Uint8Array; contentType: string; model?: string }
  | { ok: false; error: string; failure: AiFailureKind };

/** A text-to-image answer: the picture and the gateway model that PAINTED
 *  it (logged and stored on the step as `image_model`, for analytics). */
export type PaintResult =
  | { ok: true; bytes: Uint8Array; contentType: string; model: string }
  | { ok: false; error: string; failure: AiFailureKind };

/** How long ONE picture may take, all prompts included: the WHOLE wait is
 *  given to the first prompt.
 *
 *  It used to be 70 s a prompt, a second (reworded) prompt after a timeout,
 *  on the belief that a moderated prompt hangs at the gateway (probed
 *  2026-09-17). Production disproved that for the slow renders on
 *  2026-10-28 (fix/ai-image-timeout): in two windows (20:30–20:45 and
 *  02:10–02:35 UTC) FLUX.2 [flex] took 93–168 s to answer, and the gateway
 *  answered EVERY aborted request 200 with an image, billed. The 70 s cap
 *  threw away pictures that were on their way, paid for a second one that
 *  was just as slow, and failed every generation in the window. A slow
 *  render now gets the whole wait; a refusal the provider SAYS is a
 *  refusal still walks to the next, safer prompt; a timeout stops. A retry
 *  of a deck or `card` job step starts its ladder one prompt further on;
 *  the creator's AI fill and the DFC back step start a NEW job on "try
 *  again", so they begin at the original prompt again.
 *
 *  150 s leaves the step route (maxDuration 180 s) its claim, upload and
 *  patch. A step that also saves and publishes a card around the picture
 *  passes a smaller budget (CARD_STEP_IMAGE_BUDGET_MS). */
export const IMAGE_BUDGET_MS = 150_000;

/** The picture's budget inside a step that ALSO creates the card, attaches
 *  the art and bakes it in the same 180 s function — the worst case the
 *  old two-prompt ladder already spent (2 × 70 s). */
export const CARD_STEP_IMAGE_BUDGET_MS = 140_000;

/** A later prompt (after a refusal) is started only with this much left:
 *  a healthy render is ~10–40 s. */
const MIN_RUNG_MS = 45_000;

/** Try each prompt in order until one renders. A refusal the provider says
 *  is a refusal moves to the next, safer prompt while the budget allows;
 *  a timeout or any other failure stops (rewording cures neither a slow
 *  provider nor a rate limit). The first prompt is given the whole budget.
 *  `promptIndex` says which rung succeeded, `model` which model painted.
 *
 *  The backup model (generatePlainImage) is spent ONCE per picture: the
 *  rung that started it used it, later rungs run the default alone. */
export async function generateImageWithFallbacks(
  prompts: readonly string[],
  aspect: ImageAspect = "square",
  options: ImageCallOptions & { budgetMs?: number } = {},
): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string; promptIndex: number; model: string }
  | { ok: false; error: string; failure: AiFailureKind; safetyBlocked: boolean }
> {
  const started = Date.now();
  const budget = options.budgetMs ?? IMAGE_BUDGET_MS;
  let lastError = AI_FAILURE_COPY.art_failed;
  let lastFailure: AiFailureKind = "art_failed";
  let blocked = false;
  let backupSpent = false;
  for (let i = 0; i < prompts.length; i += 1) {
    const remaining = budget - (Date.now() - started);
    // Don't start a rung we can't finish inside the step budget.
    if (i > 0 && remaining < MIN_RUNG_MS) break;
    const result = await generatePlainImage(prompts[i], aspect, {
      timeoutMs: Math.min(options.timeoutMs ?? remaining, Math.max(remaining, 10_000)),
      model: options.model,
      backup: !backupSpent,
      onBackupStarted: () => {
        backupSpent = true;
      },
    });
    if (result.ok) return { ...result, promptIndex: i };
    lastError = result.error;
    lastFailure = result.failure;
    // Only a stated refusal moves to the next, safer prompt.
    blocked = result.failure === "art_blocked";
    if (!blocked) break;
  }
  return { ok: false, error: lastError, failure: lastFailure, safetyBlocked: blocked };
}

/** Re-render `source` in a new style. `prompt` should describe both the
 *  target style and what must stay (subject, composition). */
export async function restyleImage(input: {
  source: Uint8Array;
  sourceContentType: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<RestyleResult> {
  if (!input.prompt.trim()) return { ok: false, error: AI_FAILURE_COPY.art_failed, failure: "art_failed" };
  const prompt = withFullyClothedLine(input.prompt, 2000);

  if (!isGatewayConfigured()) {
    console.warn("[ai:image] restyle refused: the AI Gateway isn't configured on this deployment.");
    return { ok: false, error: AI_FAILURE_COPY.ai_unavailable, failure: "ai_unavailable" };
  }
  // The model gets the art as the owner sees it in the creator: a JPEG/PNG
  // stored before uploads were normalized may still carry an EXIF "turn me"
  // tag that the browser applies (TODO 3.14), and nothing promises the model
  // reads it. Same rule as the bake (lib/media/orientation.ts). And it gets
  // no camera metadata (TODO 3.14a): a file stored before uploads were
  // stripped may still carry the owner's GPS, and this goes to a third party.
  const upright = await autoOrientBytes(input.source, input.sourceContentType);
  const clean = await imageWithoutMetadata(upright.bytes, upright.contentType);
  // Card art may be 20 MiB since TODO 6.10; the image goes to Gemini inline
  // (base64) in a request capped at 20 MB, so a big file goes as a 2048 px
  // copy (lib/media/model-input.ts) — anything that uploaded before goes
  // untouched.
  const source = await modelInputImage(clean.bytes, clean.contentType, { keepAlpha: true });
  return restyleViaGateway(
    source.bytes,
    source.contentType,
    prompt,
    input.timeoutMs,
  );
}

/** The picture a restyle starts from. */
export type RestyleSource = { bytes: Uint8Array; contentType: string };

/** What a restyle the provider REFUSED is told. A model can decline the
 *  picture itself (FLUX.2 [pro] and Gemini 3.1 declined one real card's art
 *  that four other models repainted — tried 2026-11-14): rewording rarely
 *  cures that, another model or a picture painted from the prompt does. */
export const RESTYLE_BLOCKED_COPY =
  "The image service declined to repaint this picture. Try another model, or paint the card from the prompt instead.";

/** The model a restyle runs on when none is named: the app's one restyle
 *  model (AI_IMAGE_REMIX_MODEL, default Gemini 2.5 Flash Image). */
export function restyleModel(named?: string | null): string {
  return named?.trim() || process.env.AI_IMAGE_REMIX_MODEL?.trim() || GATEWAY_REMIX_DEFAULT;
}

/**
 * ONE edit of `source` by `model`: an image model is handed the picture
 * with the prompt, a multimodal one (isMultimodalImageModel) as a message —
 * both asked for `aspect` the way the model takes it. A stated refusal (the
 * content filter, or words in place of the picture) is `art_blocked`.
 * Never throws.
 */
async function restyleWith(
  model: string,
  prompt: string,
  source: RestyleSource,
  aspect: ImageAspect,
  timeoutMs: number,
): Promise<PaintResult> {
  const started = Date.now();
  const abortSignal = AbortSignal.timeout(Math.max(1, timeoutMs));
  try {
    if (isMultimodalImageModel(model)) {
      const { aspectRatio } = imageShapeArgs(model, aspect);
      const result = await generateText({
        model,
        abortSignal,
        maxRetries: 1,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", image: source.bytes, mediaType: source.contentType },
              { type: "text", text: prompt },
            ],
          },
        ],
        providerOptions: {
          google: { responseModalities: ["TEXT", "IMAGE"], ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}) },
        },
      });
      const file = result.files.find((f) => f.mediaType?.startsWith("image/"));
      if (file) return { ok: true, bytes: file.uint8Array, contentType: file.mediaType ?? "image/png", model };
      const said = typeof result.text === "string" && result.text.trim().length > 0;
      const refused = result.finishReason === "content-filter" || said;
      // Never the model's words in the log: they can quote the prompt.
      console.warn(`[ai:image] ${model} returned no restyled image (${result.finishReason ?? "no reason"}${said ? ", text only" : ""}).`);
      return refused
        ? { ok: false, error: AI_FAILURE_COPY.art_blocked, failure: "art_blocked" }
        : { ok: false, error: AI_FAILURE_COPY.art_failed, failure: "art_failed" };
    }
    const { image } = await generateImage({
      model,
      abortSignal,
      maxRetries: 1,
      prompt: { text: prompt, images: [source.bytes] },
      ...imageShapeArgs(model, aspect),
    });
    return { ok: true, bytes: image.uint8Array, contentType: image.mediaType ?? "image/png", model };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Image restyle failed.";
    const failure = imageFailure(`${detail} (after ${secondsSince(started)} s)`, model);
    return { ok: false, error: failure.error, failure: failure.kind };
  }
}

/**
 * `source` repainted — its subject kept, its look changed — trying each
 * prompt in order like generateImageWithFallbacks: a refusal the provider
 * states moves to the next, safer prompt while the budget allows; anything
 * else stops. ONE model paints (the named one, else restyleModel()): a
 * restyle has no backup. The picture goes to the model upright, with no
 * camera metadata and at most 2048 px (restyleImage's rules), prepared once.
 */
export async function restyleWithFallbacks(
  prompts: readonly string[],
  source: RestyleSource,
  aspect: ImageAspect = "square",
  options: ImageCallOptions & { budgetMs?: number } = {},
): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string; promptIndex: number; model: string }
  | { ok: false; error: string; failure: AiFailureKind; safetyBlocked: boolean }
> {
  const failedAs = (failure: AiFailureKind) => ({ ok: false as const, error: AI_FAILURE_COPY[failure], failure, safetyBlocked: false });
  if (prompts.length === 0 || !prompts[0].trim() || source.bytes.byteLength === 0) return failedAs("art_failed");
  if (!isGatewayConfigured()) {
    console.warn("[ai:image] restyle refused: the AI Gateway isn't configured on this deployment.");
    return failedAs("ai_unavailable");
  }
  const model = restyleModel(options.model);
  const started = Date.now();
  const budget = options.budgetMs ?? IMAGE_BUDGET_MS;
  const upright = await autoOrientBytes(source.bytes, source.contentType);
  const clean = await imageWithoutMetadata(upright.bytes, upright.contentType);
  const input = await modelInputImage(clean.bytes, clean.contentType, { keepAlpha: true });

  let lastError: string = AI_FAILURE_COPY.art_failed;
  let lastFailure: AiFailureKind = "art_failed";
  let blocked = false;
  for (let i = 0; i < prompts.length; i += 1) {
    const remaining = budget - (Date.now() - started);
    if (i > 0 && remaining < MIN_RUNG_MS) break;
    const result = await restyleWith(
      model,
      withFullyClothedLine(prompts[i], 4000),
      { bytes: input.bytes, contentType: input.contentType },
      aspect,
      Math.min(options.timeoutMs ?? remaining, Math.max(remaining, 10_000)),
    );
    if (result.ok) return { ...result, promptIndex: i };
    lastFailure = result.failure;
    blocked = result.failure === "art_blocked";
    lastError = blocked ? RESTYLE_BLOCKED_COPY : result.error;
    if (!blocked) break;
  }
  return { ok: false, error: lastError, failure: lastFailure, safetyBlocked: blocked };
}

// ---------------------------------------------------------------------------
// Text-to-image through the gateway (batch/set art). FLUX is the default —
// cheap (~$0.05/image), and strong at consistent painterly fantasy — with
// FLUX.2 [pro] as its hedge (generatePlainImage).
// ---------------------------------------------------------------------------

const GATEWAY_IMAGE_DEFAULT = "bfl/flux-2-flex";

/** A CARD picture is asked for in its frame's shape — an ArtShape
 *  (lib/ai/art-aspect.ts, TODO 4.48b: the art window of the frame the card
 *  lands on, at today's pixel budget). "square" suits icons; "wide" (16:9)
 *  suits deck cover tiles (normalised to 16:9 before upload, lib/decks/
 *  cover.ts); "banner" (21:9) suits the deck hero. There is no "card"
 *  aspect any more: it asked every frame for 4:3, which FLUX.2 dropped. */
export type ImageAspect = "square" | "wide" | "banner" | ArtShape;

/** FLUX.2 models take an output SIZE, not a ratio: an aspectRatio alone is
 *  dropped and the picture comes back at the 1024 × 1024 default
 *  (help.bfl.ai: default 1024 × 1024, width / height in multiples of 16,
 *  any aspect ratio). Every production picture before TODO 4.48b was square
 *  for that reason (measured 2026-10-21). */
export function isSizedFluxModel(model: string): boolean {
  return /^bfl\/flux-2-/.test(model);
}

type Ratio = `${number}:${number}`;

/** The ratios a ratio-only model takes when they are NOT art-aspect.ts's
 *  ASPECT_RATIOS (which FLUX's ratio input takes whole): asked for one it
 *  doesn't know, a model answers in its default shape or refuses the call.
 *  From each provider's own list (AI SDK provider docs, 2026-11): Grok
 *  Imagine has no 21 : 9 before 2.0 and no 9 : 21 at all; Gemini's image
 *  models have neither 9 : 21 nor anything narrower than 9 : 16. */
const MODEL_RATIOS: ReadonlyArray<{ match: RegExp; ratios: readonly Ratio[] }> = [
  { match: /\/grok-imagine-image-2/, ratios: ["21:9", "20:9", "2:1", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16", "1:2", "9:20"] },
  { match: /\/grok-imagine-image/, ratios: ["20:9", "2:1", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16", "1:2", "9:20"] },
  { match: /^google\/gemini-.*image/, ratios: ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"] },
];

const ratioValue = (ratio: string) => {
  const [w, h] = ratio.split(":").map(Number);
  return w / h;
};

/** The ratio `model` is asked for a window of `aspect` (width ÷ height):
 *  the nearest (on a log scale) of the ratios that model takes. */
export function modelAspectRatio(model: string, aspect: number): Ratio {
  const ratios: readonly Ratio[] = MODEL_RATIOS.find((entry) => entry.match.test(model))?.ratios ?? ASPECT_RATIOS;
  let best = ratios[0];
  let bestDistance = Infinity;
  for (const ratio of ratios) {
    const distance = Math.abs(Math.log(ratioValue(ratio) / aspect));
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  }
  return best;
}

/** A multimodal gateway model that answers a text call with an image FILE
 *  (Gemini's image models): painted through generateText, never
 *  generateImage — the same call shape as the restyle below. */
export function isMultimodalImageModel(model: string): boolean {
  return /^google\/gemini-.*image/.test(model);
}

/** What the gateway is asked for one picture's shape: a FLUX.2 model gets
 *  the ArtShape's width × height — `size`, and the Black Forest Labs
 *  provider's own `width` / `height` options (which win over `size` there)
 *  — never an aspectRatio it would drop; any other model the nearest ratio
 *  IT takes (modelAspectRatio). "square" / "wide" / "banner" are asked as
 *  they always were. */
export function imageShapeArgs(
  model: string,
  aspect: ImageAspect,
): {
  aspectRatio?: Ratio;
  size?: `${number}x${number}`;
  providerOptions?: { blackForestLabs: { width: number; height: number } };
} {
  if (typeof aspect === "string") {
    return { aspectRatio: aspect === "banner" ? "21:9" : aspect === "wide" ? "16:9" : "1:1" };
  }
  if (!isSizedFluxModel(model)) return { aspectRatio: modelAspectRatio(model, aspect.windowAspect) };
  return {
    size: `${aspect.width}x${aspect.height}`,
    providerOptions: { blackForestLabs: { width: aspect.width, height: aspect.height } },
  };
}

/** The backup text-to-image model (owner 2026-10-28, sampled on the dev
 *  key: design-backup/ai-image-models/sheet.jpg). FLUX.2 [pro] answered in
 *  9.9–14.9 s while [flex] took 114 s for the same kind of picture, painted
 *  the dark prompt [flex] refused, takes the same width × height
 *  (isSizedFluxModel) and costs less ($0.03 vs $0.05). Seedream 4.5 was
 *  rejected: square only through the gateway and an "AI generated" stamp. */
export const GATEWAY_IMAGE_BACKUP = "bfl/flux-2-pro";

/** When the backup is started if the default hasn't answered: healthy
 *  [flex] renders take 9–33 s, the slow windows 93–168 s. 60 s rarely
 *  fires on a healthy render and leaves the backup ~90 s (80 s on a card
 *  step) for a render that normally takes ~15 s. */
export const IMAGE_HEDGE_AT_MS = 60_000;

/** The backup is not started with less than this left before the deadline
 *  (it could not finish): a call budget under IMAGE_HEDGE_AT_MS + this has
 *  no timed hedge, only the start-on-failure one. */
export const MIN_BACKUP_MS = 20_000;

/** A backup override we warned about already (once per process). */
let warnedBackup: string | null = null;

/** The default model and its backup (null when they're the same model). An
 *  AI_IMAGE_FALLBACK_MODEL override must be a gateway FLUX.2 model — the
 *  family isSizedFluxModel knows, which takes the window's width × height
 *  and was sampled — or the default; anything else (a typo, a model the
 *  gateway lacks, one that would paint the wrong shape) is NO backup, said
 *  once in the log (review of #644). */
export function imageModels(): { primary: string; backup: string | null } {
  const primary = process.env.AI_IMAGE_MODEL?.trim() || GATEWAY_IMAGE_DEFAULT;
  const override = process.env.AI_IMAGE_FALLBACK_MODEL?.trim();
  let backup = override || GATEWAY_IMAGE_BACKUP;
  if (override && !isSizedFluxModel(override) && override !== GATEWAY_IMAGE_DEFAULT) {
    if (warnedBackup !== override) {
      warnedBackup = override;
      console.warn(`[ai:image] AI_IMAGE_FALLBACK_MODEL "${override.slice(0, 80)}" isn't a known gateway FLUX.2 model; no backup.`);
    }
    return { primary, backup: null };
  }
  if (backup === primary) backup = "";
  return { primary, backup: backup || null };
}

const secondsSince = (start: number) => Math.round((Date.now() - start) / 1000);

/** ONE gateway call. `stop` aborts it when the other model won: that is
 *  logged as such, never as the model failing. Never throws. */
async function paintWith(
  model: string,
  prompt: string,
  aspect: ImageAspect,
  timeoutMs: number,
  stop: AbortSignal,
): Promise<PaintResult> {
  const started = Date.now();
  try {
    if (isMultimodalImageModel(model)) return await paintViaText(model, prompt, aspect, timeoutMs, stop);
    const { image } = await generateImage({
      model,
      abortSignal: AbortSignal.any([AbortSignal.timeout(Math.max(1, timeoutMs)), stop]),
      // One retry within the abort budget — the SDK default (2) can push a
      // slow-failing call past the timeout for no user-visible benefit.
      maxRetries: 1,
      prompt,
      ...imageShapeArgs(model, aspect),
    });
    // A shape the model didn't take comes back as a warning, not an error —
    // the AI SDK already logs every one ("AI SDK Warning (…)", logWarnings),
    // so a run shows it without a second line of ours. The picture still
    // lands fitted to its window.
    return { ok: true, bytes: image.uint8Array, contentType: image.mediaType ?? "image/png", model };
  } catch (error) {
    if (stop.aborted) {
      console.info(`[ai:image] ${model} stopped after ${secondsSince(started)} s: the other model answered first.`);
      return { ok: false, error: AI_FAILURE_COPY.art_failed, failure: "art_failed" };
    }
    const detail = error instanceof Error ? error.message : "Image generation failed.";
    // How long it waited, so a slow provider shows in the log as one.
    const failure = imageFailure(`${detail} (after ${secondsSince(started)} s)`, model);
    return { ok: false, error: failure.error, failure: failure.kind };
  }
}

/** ONE gateway call to a multimodal model that answers with an image file
 *  (isMultimodalImageModel). A refusal is `art_blocked`, so the ladder walks
 *  to a softer prompt: the content filter as its finish reason, or WORDS in
 *  place of the picture (these models decline in text: "I can't create…").
 *  An answer with neither a picture nor a word is `art_failed`. Throws what
 *  the gateway throws: paintWith reports it. */
async function paintViaText(
  model: string,
  prompt: string,
  aspect: ImageAspect,
  timeoutMs: number,
  stop: AbortSignal,
): Promise<PaintResult> {
  const { aspectRatio } = imageShapeArgs(model, aspect);
  const result = await generateText({
    model,
    abortSignal: AbortSignal.any([AbortSignal.timeout(Math.max(1, timeoutMs)), stop]),
    maxRetries: 1,
    prompt,
    providerOptions: {
      google: { responseModalities: ["TEXT", "IMAGE"], ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}) },
    },
  });
  const file = result.files.find((f) => f.mediaType?.startsWith("image/"));
  if (file) return { ok: true, bytes: file.uint8Array, contentType: file.mediaType ?? "image/png", model };
  const said = typeof result.text === "string" && result.text.trim().length > 0;
  const refused = result.finishReason === "content-filter" || said;
  // Never the model's words in the log: they can quote the prompt.
  console.warn(`[ai:image] ${model} returned no image (${result.finishReason ?? "no reason"}${said ? ", text only" : ""}).`);
  return refused
    ? { ok: false, error: AI_FAILURE_COPY.art_blocked, failure: "art_blocked" }
    : { ok: false, error: AI_FAILURE_COPY.art_failed, failure: "art_failed" };
}

/** Both models failed on the same prompt. When EITHER refused, the prompt is
 *  what failed, so the answer is the refusal and the ladder walks to a
 *  softer prompt (MIN_RUNG_MS still bounds it) — a backup that then failed
 *  for its own reason (a 429, a 5xx, a model the gateway lacks) must not end
 *  the ladder with ~140 s left (review of #644). Neither refused: the
 *  backup's failure, the last word on that prompt. */
function bothFailed(primary: PaintResult, backup: PaintResult): PaintResult {
  if (backup.ok || primary.ok) return backup.ok ? backup : primary;
  if (primary.failure === "art_blocked") return primary;
  return backup;
}

/**
 * Text-to-image returning raw bytes (batch jobs persist via
 * persistGeneratedArt). Gateway-only. Never touches OpenAI.
 *
 * HEDGED (owner 2026-10-28): the default model starts at once; the backup
 * (GATEWAY_IMAGE_BACKUP) starts — once, on the same prompt and shape — when
 * the default has no answer after IMAGE_HEDGE_AT_MS, or as soon as the
 * default FAILS (a refusal included) if that comes first. The first picture
 * wins and the other call is aborted; nothing outlives `timeoutMs`, so the
 * caller's budget (IMAGE_BUDGET_MS / CARD_STEP_IMAGE_BUDGET_MS) holds. The
 * CREDIT is the caller's step's: one per picture whichever model painted
 * it (the provider may still bill the aborted render — a few cents, only
 * on a slow default). `model` names the painter.
 */
export async function generatePlainImage(
  prompt: string,
  aspect: ImageAspect = "square",
  options: PaintOptions = {},
): Promise<PaintResult> {
  if (!prompt.trim()) return { ok: false, error: AI_FAILURE_COPY.art_failed, failure: "art_failed" };
  if (!isGatewayConfigured()) {
    console.warn("[ai:image] refused: the AI Gateway isn't configured on this deployment.");
    return { ok: false, error: AI_FAILURE_COPY.ai_unavailable, failure: "ai_unavailable" };
  }
  const text = withFullyClothedLine(prompt, 4000);
  // A caller that names its model gets that model alone: no backup, so the
  // result always says who painted (ImageCallOptions.model).
  const pinned = options.model?.trim() || null;
  const { primary, backup } = pinned ? { primary: pinned, backup: null } : imageModels();
  const timeoutMs = options.timeoutMs ?? IMAGE_CALL_TIMEOUT_MS;
  const started = Date.now();
  const deadline = started + timeoutMs;

  return new Promise<PaintResult>((resolve) => {
    const stopPrimary = new AbortController();
    const stopBackup = new AbortController();
    let settled = false;
    let primaryResult: PaintResult | null = null;
    let backupResult: PaintResult | null = null;
    let backupRunning = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: PaintResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // The loser (if any) is still on the wire: stop it.
      if (!primaryResult) stopPrimary.abort();
      if (backupRunning && !backupResult) stopBackup.abort();
      if (result.ok) {
        console.info(
          `[ai:image] painted by ${result.model} in ${secondsSince(started)} s${result.model === primary ? "" : " (backup)"}.`,
        );
      }
      resolve(result);
    };

    const startBackup = (why: string): boolean => {
      if (!backup || options.backup === false || backupRunning || settled) return false;
      const left = deadline - Date.now();
      if (left < MIN_BACKUP_MS) return false;
      backupRunning = true;
      options.onBackupStarted?.();
      console.warn(`[ai:image] starting the backup ${backup} after ${secondsSince(started)} s: ${why}.`);
      void paintWith(backup, text, aspect, left, stopBackup.signal).then((result) => {
        backupResult = result;
        if (result.ok) return finish(result);
        // The default is still painting: it may yet answer.
        if (primaryResult) finish(bothFailed(primaryResult, result));
      });
      return true;
    };

    void paintWith(primary, text, aspect, timeoutMs, stopPrimary.signal).then((result) => {
      primaryResult = result;
      if (result.ok) return finish(result);
      // A deployment that can't reach the gateway can't reach the backup.
      if (!backupRunning && result.failure !== "ai_unavailable" && startBackup(`${primary} failed (${result.failure})`)) return;
      if (backupRunning && !backupResult) return; // the backup may yet answer
      finish(backupResult ? bothFailed(result, backupResult) : result);
    });

    if (backup && options.backup !== false && timeoutMs >= IMAGE_HEDGE_AT_MS + MIN_BACKUP_MS) {
      timer = setTimeout(() => startBackup(`${primary} had no answer`), IMAGE_HEDGE_AT_MS);
    }
  });
}

async function restyleViaGateway(
  source: Uint8Array,
  sourceContentType: string,
  prompt: string,
  timeoutMs?: number,
): Promise<RestyleResult> {
  const model = process.env.AI_IMAGE_REMIX_MODEL?.trim() || GATEWAY_REMIX_DEFAULT;
  try {
    const result = await generateText({
      model,
      abortSignal: AbortSignal.timeout(timeoutMs ?? IMAGE_CALL_TIMEOUT_MS),
      maxRetries: 1,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image: source, mediaType: sourceContentType },
            { type: "text", text: prompt },
          ],
        },
      ],
      // Gemini image models want the image modality opted into explicitly;
      // ignored by providers that don't know the key.
      providerOptions: {
        google: { responseModalities: ["TEXT", "IMAGE"] },
      },
    });
    const file = result.files.find((f) => f.mediaType?.startsWith("image/"));
    if (!file) {
      console.warn(`[ai:image] ${model} returned no image.`);
      return { ok: false, error: AI_FAILURE_COPY.art_failed, failure: "art_failed" };
    }
    return {
      ok: true,
      bytes: file.uint8Array,
      contentType: file.mediaType ?? "image/png",
      model,
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Image restyle failed.";
    const failure = imageFailure(detail, model);
    return { ok: false, error: failure.error, failure: failure.kind };
  }
}
