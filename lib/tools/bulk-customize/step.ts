import "server-only";

import { z } from "zod";
import { getCardById } from "@/lib/scryfall/client";
import { checkScryfallRateLimit, logScryfallCall } from "@/lib/scryfall/rate-limit";
import { storeScryfallArt } from "@/lib/scryfall/import-art";
import { checkUploadRateLimit } from "@/lib/media/upload-rate-limit";
import { userFolder } from "@/lib/media/user-storage";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getCardCapacity } from "@/lib/cards/capacity";
import { remainingCapacity } from "@/lib/billing/capacity-copy";
import { createCardAction, type CreateCardResult } from "@/lib/cards/actions";
import { linkDeckCardAction } from "@/lib/decks/card-actions";
import { fitArtToWindow } from "@/lib/cards/art-fit";
import { withCreditedStep } from "@/lib/ai/credited-step";
import { logAiCall, type AiActionLabel } from "@/lib/ai/rate-limit";
import { generateImageWithFallbacks } from "@/lib/ai/image-gen";
import { discardGeneratedArt, persistGeneratedArt } from "@/lib/ai/random-art";
import { artPromptLadder, exactArtPromptLadder } from "@/lib/ai/art-prompt-safety";
import { artShapeForBackFace, artShapeForFace, type ArtFace } from "@/lib/ai/art-aspect";
import { composeArtStyle, styleArtBrief } from "@/lib/ai/presets";
import { AI_FAILURE_COPY, type AiFailureKind } from "@/lib/ai/failure";
import { buildTypeLine } from "@/lib/cards/card-display";
import type { CardType } from "@/types/card";
import { checkToolAccess } from "@/lib/tools/queries";
import { recordToolEventLater } from "@/lib/tools/events";
import type { JobStep } from "@/lib/ai/generation-jobs";
import {
  BULK_CUSTOMIZE_MAX_CARDS,
  BULK_CUSTOMIZE_TOOL_SLUG,
  bulkChoicesSchema,
  bulkSourceSchema,
  type BulkChoices,
  type BulkSource,
} from "@/lib/tools/bulk-customize/model";
import { planCustomizedCard, type BulkCardPayload } from "@/lib/tools/bulk-customize/planner";
import { importPatchOf, resolveBulkSources, writeCollectionCustomized } from "@/lib/tools/bulk-customize/server";

// ---------------------------------------------------------------------------
// One step of a Bulk Customize batch (`ai_generation_jobs.kind`
// 'bulk_customize', migration 0186) — one card. Run by runNextJobStep
// (lib/ai/generation-jobs.ts) after the atomic claim; its outcome is written
// by patch_job_step, never a whole-steps overwrite.
//
// The plan names SOURCES and the batch's choices, nothing to write (an owner
// may insert a job row of their own, 0059): the step re-reads the source
// from the caller's own rows, re-fetches the printing, re-plans the card and
// re-prices its art. The save goes through createCardAction — every gate a
// card has (frames in the colour, the kind, strong language, capacity,
// import provenance: no fingerprint, so the card reads "Edited") — and the
// deck entry is linked through linkDeckCardAction, never a direct write.
//
// A card that FAILED is recorded for the tool's analytics (`card_failed`,
// after the response: why, and whether its credit came back). The cards
// made are counted once a run, by the dialog (`run_finished`).
// ---------------------------------------------------------------------------

export type BulkPlanEntry = {
  source: z.infer<typeof bulkSourceSchema>;
  /** The card's name when the batch was planned (the step's label). */
  name: string;
  /** What the plan priced its art at (display only — the step re-prices). */
  credits: number;
};

export type BulkCustomizeJobPlan = {
  choices: BulkChoices;
  entries: BulkPlanEntry[];
  /** Cards left out at plan time (unchanged, not found…). */
  skipped: number;
};

const planEntrySchema = z.object({
  source: bulkSourceSchema,
  name: z.string().max(300),
  credits: z.number().int().min(0).max(4),
});

const planSchema = z.object({
  choices: bulkChoicesSchema,
  entries: z.array(planEntrySchema).min(1).max(BULK_CUSTOMIZE_MAX_CARDS),
  skipped: z.number().int().min(0).optional(),
});

/** The step key of entry `index`. */
export function bulkStepKey(index: number): string {
  return `bulk:${index}`;
}

/** How long a step waits before its next try when Scryfall's art quota is
 *  spent for the minute (the client reads `retry_after_seconds`). */
const IMPORT_ART_WAIT_FALLBACK_S = 20;

/** Each picture's budget: a double-faced card paints two inside the 180 s
 *  step function, with the save and bake after. */
const ONE_PICTURE_BUDGET_MS = 130_000;
const TWO_PICTURES_BUDGET_MS = 70_000;

// Every result names `error_code`, `note` and `retry_after_seconds` (null
// when unset): a step copies its last attempt, and a code from an earlier
// try (a RATE_LIMITED wait, a CARD_CAPACITY stop) must not ride on the next
// outcome; patchJobStep writes these keys only for a step that names them.
const CLEARED = { error_code: null, note: null, retry_after_seconds: null } as const;

function failed(step: JobStep, error: string, extra: Partial<JobStep> = {}): JobStep {
  return { ...step, ...CLEARED, status: "failed", error, ...extra };
}

function createFailure(result: Extract<CreateCardResult, { ok: false }>): Partial<JobStep> & { error: string } {
  const error = result.formError ?? Object.values(result.fieldErrors ?? {})[0] ?? "The card couldn't be saved.";
  return result.code === "UPGRADE_REQUIRED" && result.reason === "capacity"
    ? { error, error_code: "CARD_CAPACITY" }
    : { error, failure: "save_failed" };
}

export type BulkStepDeps = {
  gameSystemId: () => Promise<string | null>;
  artistCredit: () => Promise<string | undefined>;
};

/** The AI picture's prompt: the card's own words (its name and type line),
 *  the batch's one style, never a real artist or the source's art. */
function aiArtPrompt(payload: BulkCardPayload, choices: BulkChoices, face: "front" | "back"): { prompt: string; style: string } {
  const back = face === "back" ? payload.back_face : undefined;
  const title = back?.title ?? payload.title;
  const typeLine = buildTypeLine({
    cardType: (back?.card_type ?? payload.card_type) as CardType | undefined,
    supertype: back ? (back.supertype ?? null) : (payload.supertype ?? null),
    subtypes: back ? (back.subtypes ?? []) : payload.subtypes,
  });
  const style = composeArtStyle(choices.artStyle, choices.artTwist) ?? "painterly fantasy";
  const direction = styleArtBrief(choices.artStyle);
  return {
    style,
    prompt: [
      `Fantasy trading-card illustration of "${title}"${typeLine ? `, a ${typeLine}` : ""}.`,
      `Rendered strictly in ${style} style.${direction ? ` ${direction}` : ""}`,
      "One cohesive set: consistent rendering technique, palette and lighting.",
      "NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.",
    ].join(" "),
  };
}

export async function runBulkCustomizeStep(
  userId: string,
  jobId: string,
  rawPlan: unknown,
  step: JobStep,
  stepIndex: number,
  deps: BulkStepDeps,
): Promise<JobStep> {
  // A beta tool: open to its testers only, step by step (the plan is the
  // owner's to insert; the door is checked again here).
  const access = await checkToolAccess(BULK_CUSTOMIZE_TOOL_SLUG);
  if (!access || access.userId !== userId) return failed(step, "Bulk Customize isn't open to you.");

  const parsedPlan = planSchema.safeParse(rawPlan);
  if (!parsedPlan.success) return failed(step, "This batch can't be read — start it again.");
  const plan = parsedPlan.data;
  const entry = plan.entries[stepIndex];
  if (!entry || step.key !== bulkStepKey(stepIndex)) return failed(step, "Missing card plan.");

  const result = await customizeSourceStep(
    userId,
    jobId,
    step,
    { source: entry.source, choices: plan.choices, aiLabel: "bulk_customize_art" },
    deps,
  );
  if (result.status === "failed") {
    recordToolEventLater({
      slug: BULK_CUSTOMIZE_TOOL_SLUG,
      userId,
      event: "card_failed",
      access: access.via,
      props: {
        reason: bulkStepFailureReason(result),
        art: plan.choices.art,
        source: entry.source.kind,
        refunded: Boolean(result.refunded),
        refund_pending: Boolean(result.refund_pending),
      },
    });
  }
  return result;
}

/** Why a step failed, as a code: the plan limit it stopped on, else its
 *  failure kind (lib/ai/failure.ts), else "other" (the source is gone,
 *  Scryfall didn't answer, the card came out unchanged…). */
export function bulkStepFailureReason(step: Pick<JobStep, "error_code" | "failure">): string {
  if (step.error_code === "CARD_CAPACITY") return "capacity";
  if (step.error_code === "INSUFFICIENT_CREDITS") return "insufficient_credits";
  return step.failure ?? "other";
}

/** What a tool built on Bulk Customize hands its one-card core (Re-art
 *  deck: lib/tools/re-art/step.ts). The caller has checked its own gate and
 *  read its own plan; the core re-reads the source, re-plans and re-prices. */
export type CustomizeSourceOptions = {
  source: BulkSource;
  choices: BulkChoices;
  /** The AI label the pictures are logged and charged under (card_ai_calls
   *  + the ledger's reason). */
  aiLabel: AiActionLabel;
  /** A picture's prompt; default: the batch's one style (aiArtPrompt).
   *  `exact`: the prompt is its maker's own words — the safety ladder dresses
   *  it but never swaps it for a picture built from the card's name
   *  (lib/ai/art-prompt-safety.ts exactArtPromptLadder). */
  artPrompt?: (payload: BulkCardPayload, face: "front" | "back") => { prompt: string; style: string; exact?: boolean };
  /** A planned card the caller refuses before anything is stored or paid
   *  (Re-art: an emblem). Its sentence, or null. */
  refusePlanned?: (payload: BulkCardPayload) => string | null;
  /** After the card is saved and recorded on its source: the caller's own
   *  record. A note when it didn't land (never a failed step: the card
   *  exists). */
  onSaved?: (cardId: string, art: { front: string | null; back: string | null }) => Promise<string | null>;
};

/**
 * One real card made the maker's own — the Bulk Customize step's body,
 * shared with the tools built on it. Re-reads the source from the caller's
 * own rows, re-fetches the printing on their quota, re-plans the card and
 * re-prices its art; saves through createCardAction and links through
 * linkDeckCardAction (recordCustomized).
 */
export async function customizeSourceStep(
  userId: string,
  jobId: string,
  step: JobStep,
  options: CustomizeSourceOptions,
  deps: BulkStepDeps,
): Promise<JobStep> {
  const plan = { choices: options.choices };
  const entry = { source: options.source };

  // The source, from the caller's own rows again.
  const { resolved } = await resolveBulkSources(userId, [entry.source]);
  const source = resolved[0];
  // A retry after the card saved: only its link is left.
  if (step.card_id) {
    const note = await recordCustomized(userId, source, step.card_id);
    return { ...step, ...CLEARED, status: "done", error: undefined, note: note ?? null };
  }
  if (!source) return failed(step, "This card is no longer in your deck or collection.");

  // A spent MINUTE puts the step back in line (the runner waits); a spent
  // DAY fails it — waiting would never end.
  const wait = (seconds: number | undefined): JobStep => ({
    ...step,
    ...CLEARED,
    status: "pending",
    error: undefined,
    error_code: "RATE_LIMITED",
    retry_after_seconds: Math.max(1, Math.min(120, Math.round(seconds || IMPORT_ART_WAIT_FALLBACK_S))),
  });

  // The printing is read from Scryfall on the caller's own quota (the plan
  // is the owner's to insert: its steps are never free calls).
  const lookup = await checkScryfallRateLimit(userId, "named");
  if (!lookup.ok) return lookup.reason === "per_day" ? failed(step, lookup.message) : wait(lookup.retryAfterSeconds);
  await logScryfallCall(userId, "named");
  const card = await getCardById(source.scryfallId);
  if (!card) return failed(step, "Scryfall didn't answer for this card — try it again.");

  const verifiedKeys = new Set(await getVerifiedFrameKeys());
  const patch = await importPatchOf(card, verifiedKeys);
  const entitlements = await getEntitlements();
  const planned = planCustomizedCard({
    patch,
    fallbackTitle: source.name || card.name,
    scryfallSet: card.set ?? null,
    choices: plan.choices,
    verifiedKeys,
    removeWatermark: entitlements.removeWatermark,
  });
  if (!planned.ok) return failed(step, planned.message);
  const refusal = options.refusePlanned?.(planned.payload);
  if (refusal) return failed(step, refusal);

  // The saved-card limit before any picture is stored or paid for (the
  // card action and the database check it again at the insert).
  const capacity = await getCardCapacity();
  if (capacity && remainingCapacity(capacity) === 0) {
    return failed(step, "You've reached your plan's card limit.", { error_code: "CARD_CAPACITY" });
  }

  const gameSystemId = await deps.gameSystemId();
  if (!gameSystemId) return failed(step, "No game system configured.");

  let savedArt: { front: string | null; back: string | null } = { front: null, back: null };
  const save = async (art: { front?: string; back?: string; artist?: string; backArtist?: string }) => {
    savedArt = { front: art.front ?? null, back: art.back ?? null };
    const { visibility, back_face, ...rest } = planned.payload;
    const result = await createCardAction(
      {
        ...rest,
        game_system_id: gameSystemId,
        ...(art.front ? { art_url: art.front, art_position: fitArtToWindow() } : {}),
        ...(art.artist ? { artist_credit: art.artist } : {}),
        ...(back_face
          ? {
              back_face: {
                ...back_face,
                ...(art.back ? { art_url: art.back, art_position: fitArtToWindow() } : {}),
                ...(art.backArtist ? { artist_credit: art.backArtist } : {}),
              },
            }
          : {}),
        // A card with no picture is never published (the planner keeps
        // "add art later" private; a picture that didn't arrive the same).
        visibility: art.front ? visibility : "private",
      },
      { redirectAfterCreate: false },
    );
    return result;
  };

  const done = async (result: Extract<CreateCardResult, { ok: true }>, extra: Partial<JobStep> = {}): Promise<JobStep> => {
    const note = await recordCustomized(userId, source, result.cardId);
    const own = options.onSaved ? await options.onSaved(result.cardId, savedArt) : null;
    return {
      ...step,
      ...CLEARED,
      ...extra,
      status: "done",
      card_id: result.cardId,
      label: planned.title,
      error: undefined,
      // The record's note (a link that didn't land) beside the save's own.
      note: [extra.note, note, own].filter(Boolean).join(" ") || null,
      ...(result.forcedPrivate ? { forced_private: result.forcedPrivate } : {}),
    };
  };

  // ---- Each printing's own art ----
  if (plan.choices.art === "keep") {
    // Scryfall's art quota first: an upload is counted only when the
    // import can go ahead.
    const quota = await checkScryfallRateLimit(userId, "import_art");
    if (!quota.ok) {
      if (quota.reason === "per_day") return failed(step, quota.message);
      return wait(quota.retryAfterSeconds);
    }
    // One upload counted per picture the card stores (a double-faced card
    // stores two).
    for (let i = 0; i < (planned.doubleFaced ? 2 : 1); i += 1) {
      const uploads = await checkUploadRateLimit(userId);
      if (uploads.ok) continue;
      if (uploads.window === "minute") return wait(uploads.retryAfterSeconds);
      return failed(step, uploads.message);
    }
    const front = await storeScryfallArt(userId, card, "art");
    let back: Awaited<ReturnType<typeof storeScryfallArt>> | null = null;
    if (front.ok && planned.doubleFaced) back = await storeScryfallArt(userId, card, "art-back");
    const result = await save({
      front: front.ok ? front.publicUrl : undefined,
      artist: front.ok ? (front.artist ?? undefined) : undefined,
      back: back?.ok ? back.publicUrl : undefined,
      backArtist: back?.ok ? (back.artist ?? undefined) : undefined,
    });
    if (!result.ok) {
      // The stored pictures are unused: removed (best effort).
      const names = [front, back].flatMap((art) => (art?.ok ? [art.fileName] : []));
      if (names.length > 0) await userFolder("card-art", userId).remove(names).catch(() => undefined);
      return failed(step, createFailure(result).error, createFailure(result));
    }
    return done(result, front.ok ? {} : { note: "Saved without its art (Scryfall had none to give) — add your own." });
  }

  // ---- No art yet ----
  if (plan.choices.art === "later") {
    const result = await save({});
    if (!result.ok) return failed(step, createFailure(result).error, createFailure(result));
    return done(result);
  }

  // ---- New AI art, priced again here and reserved before any call ----
  return withCreditedStep(userId, jobId, planned.credits, options.aiLabel, step, async () => {
    const attempt = (step.attempts ?? 0) + 1;
    const frontFace: ArtFace = {
      template: planned.payload.frame_style.template ?? null,
      colorIdentity: planned.payload.color_identity,
      cardType: planned.payload.card_type ?? null,
      supertype: planned.payload.supertype ?? null,
      cost: planned.payload.cost ?? null,
      style: planned.payload.frame_style,
    };
    const budgetMs = planned.doubleFaced ? TWO_PICTURES_BUDGET_MS : ONE_PICTURE_BUDGET_MS;
    const painted: string[] = [];
    const models: string[] = [];
    const paint = async (face: "front" | "back"): Promise<{ ok: true; url: string } | { ok: false; error: string; failure: AiFailureKind }> => {
      const { prompt, style, exact } = options.artPrompt
        ? options.artPrompt(planned.payload, face)
        : { ...aiArtPrompt(planned.payload, plan.choices, face), exact: false };
      await logAiCall(userId, options.aiLabel);
      const title = face === "back" ? (planned.payload.back_face?.title ?? planned.payload.title) : planned.payload.title;
      const image = await generateImageWithFallbacks(
        exact
          ? exactArtPromptLadder(prompt)
          : artPromptLadder(attempt, prompt, { title, colors: planned.payload.color_identity, style }),
        face === "back" ? artShapeForBackFace(frontFace, planned.payload.back_face) : artShapeForFace(frontFace),
        { budgetMs },
      );
      if (!image.ok) return { ok: false, error: image.error, failure: image.failure };
      const stored = await persistGeneratedArt(image.bytes, image.contentType);
      if (!stored.ok) return { ok: false, error: stored.error, failure: stored.failure };
      painted.push(stored.publicUrl);
      models.push(image.model);
      return { ok: true, url: stored.publicUrl };
    };
    const discard = () => Promise.all(painted.map((url) => discardGeneratedArt(userId, url)));

    const front = await paint("front");
    if (!front.ok) return { ...failed(step, front.error), failure: front.failure, attempts: attempt };
    let backUrl: string | undefined;
    if (planned.doubleFaced) {
      const back = await paint("back");
      if (!back.ok) {
        await discard();
        return { ...failed(step, back.error), failure: back.failure, attempts: attempt };
      }
      backUrl = back.url;
    }
    const result = await save({ front: front.url, back: backUrl, artist: await deps.artistCredit() });
    if (!result.ok) {
      // The pictures are unused: removed, and the credit goes back.
      await discard();
      return { ...failed(step, createFailure(result).error, createFailure(result)), attempts: attempt };
    }
    return done(result, { attempts: attempt, image_model: [...new Set(models)].join(" + ") || null });
  });
}

/**
 * What the new card is recorded on: its deck entry linked to it (the deck's
 * own writer — owner checked, D3 judged) or its collection row's
 * `customized_card_id` (0186: the server writes it; a trigger holds the card
 * to the row's owner). Returns a note when the card was saved but the record
 * didn't land — never a failed step (the card exists; a retry would make a
 * second one).
 */
async function recordCustomized(
  userId: string,
  source: Awaited<ReturnType<typeof resolveBulkSources>>["resolved"][number] | undefined,
  cardId: string,
): Promise<string | null> {
  if (!source) return null;
  if (source.deckEntryId) {
    const linked = await linkDeckCardAction(source.deckEntryId, cardId, { surface: "deck" });
    return linked.ok ? null : "Saved, but not linked to its deck entry — link it from the deck page.";
  }
  if (source.collectionId && !(await writeCollectionCustomized(userId, source.collectionId, cardId))) {
    return "Saved, but your collection doesn't show it yet.";
  }
  return null;
}

/** The copy a failed AI picture's step shows when nothing better is known. */
export const BULK_ART_FAILED = AI_FAILURE_COPY.art_failed;
