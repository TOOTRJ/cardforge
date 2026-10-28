import "server-only";
import { buildAndStoreDeckGuide } from "@/lib/decks/guides";
import { deckTypeByKey } from "@/lib/decks/deck-types";

import type { Json } from "@/types/supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createClient,
  getCurrentProfile,
  getCurrentUser,
} from "@/lib/supabase/server";
import { storedAnatomyOf, type FrameAnatomyStyle } from "@/lib/cards/anatomy";
import { fitArtToWindow } from "@/lib/cards/art-fit";
import {
  createCardAction,
  updateCardAction,
  type CreateCardResult,
} from "@/lib/cards/actions";
import { getCardById } from "@/lib/cards/queries";
import { createDeckAction, updateDeckAction } from "@/lib/decks/actions";
import { listDeckCards } from "@/lib/decks/queries";
import { computeDeckAnalytics } from "@/lib/decks/analytics";
import { buildDeckBrief } from "@/lib/ai/deck-brief";
import { requireTier } from "@/lib/billing/entitlements";
import {
  generateDeckPlan,
  type AiDeckFormat,
} from "@/lib/ai/deck-design";
import { generateRemixIdentity } from "@/lib/ai/remix";
import {
  generateImageWithFallbacks,
  generatePlainImage,
  restyleImage,
  type ImageAspect,
} from "@/lib/ai/image-gen";
import {
  artShapeForBackFace,
  artShapeForFace,
  type ArtFace,
  type ArtShape,
} from "@/lib/ai/art-aspect";
import {
  artPromptLadder,
  softenArtPrompt,
  type FallbackArtInputs,
} from "@/lib/ai/art-prompt-safety";
import { persistGeneratedArt } from "@/lib/ai/random-art";
import { normalizeDeckCover } from "@/lib/decks/cover";
import {
  logAiCall,
  type AiActionLabel,
} from "@/lib/ai/rate-limit";
import { generateRandomCard } from "@/lib/ai/random-card";
import { designCardFill } from "@/lib/ai/card-fill";
import type {
  CardFillField,
  CardFillLocked,
  CardFillResult,
  CardFillSteer,
} from "@/lib/ai/card-fill-shared";
import { isAllowedServerImageFetchUrl } from "@/lib/validation/card";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import {
  colorHintsForFrame,
  resolveDeckCardFrame,
  resolveGeneratedFrame,
  designHasPublishedFrame,
  typesWithoutPublishedFrame,
  FREE_DESIGN_TYPES,
} from "@/lib/creator/frame-random";
import { frameBrief, frameColorKeysOf, frameFitOf } from "@/lib/ai/frame-brief";
import { frameArtBrief } from "@/lib/ai/frame-art-brief";
import { isAiDesignKind, type AiDesignKind } from "@/lib/ai/frame-choices";
import type {
  CardBackFace,
  CardType,
  ColorIdentity,
  FrameTemplate,
  Rarity,
} from "@/types/card";
import type { DesignedCard } from "@/lib/ai/card-design";
import { getCardById as getScryfallCardById } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import {
  REMIX_EMBLEM_LEFT_OUT,
  isEmblemRemixSource,
  ownCardRemixFrame,
  ownCardTextStandIn,
  ownCardRulesText,
  remixableDeckItems,
  remixCreditsOf,
  remixSavedFrames,
  scryfallRemixMechanics,
} from "@/lib/ai/remix-mechanics";
import { cardFieldsFace, frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { applyRemixNames, remixSecondHalfLayout } from "@/lib/ai/remix-names";
import { DFC_REMIX_CREDITS } from "@/lib/scryfall/dfc-import";
import { templateTakesBackBody } from "@/lib/cards/dfc";

/** A remix step priced for both faces whose double-faced frames aren't
 *  available any more (a tick withdrawn since the plan): refused, refunded. */
export const REMIX_DFC_FRAMES_GONE =
  "The double-faced frames this card was priced for aren't available any more — retry this card.";
import type { DeckFormat } from "@/types/deck";
import { withCreditedStep } from "@/lib/ai/credited-step";
import { StationGapUnfilledError, sameStationShape, stationSaveFields } from "@/lib/ai/station-design";
import { printsPowerToughness, withSupertypeWord } from "@/lib/cards/card-display";
import { isStationFrame } from "@/lib/cards/station-frame";
import { stationPtChoiceOf } from "@/lib/creator/station-rows";
import { getCardCapacity } from "@/lib/cards/capacity";
import { describeCapacity, remainingCapacity } from "@/lib/billing/capacity-copy";
import {
  AI_FAILURE_COPY,
  aiFailureMessage,
  classifyProviderError,
  designFailureKind,
  type AiFailureKind,
} from "@/lib/ai/failure";
import { DesignNotUsableError, designFreshly } from "@/lib/ai/design-variety";
import { recentAiTitles } from "@/lib/ai/recent-designs";

// ---------------------------------------------------------------------------
// AI generation jobs — the batch pipeline behind deck generation, deck
// remixes and the single-card / per-field flows (the set kind was removed
// with the sets feature on 2026-09-22).
//
// A job is a persisted plan the CLIENT advances one HTTP step at a time
// (there is no queue/worker in this stack; see migration 0059):
//
//   PLAN  (create*Job): one design call for every card (single batch =
//         cross-card cohesion), then the target deck is created/loaded and
//         the job row written with one step per card (+ cover / guide).
//   STEP  (runNextJobStep): create one card (private → no bake) and paint
//         its art. Steps are retry-safe: a step that already created its
//         card only redoes the art.
//
// Credits: 1 per card, spent as each card step completes (same
// "generate_deck" ledger reason as the legacy route). Free when billing is
// disabled.
// ---------------------------------------------------------------------------

/** AI-generated cards credit the GENERATING user as the artist (owner
 *  decision, 2026-07-11) — the art is painted for them, and a blank credit
 *  rendered "Art: Unknown" on every AI card. React-cached profile read, so
 *  batch steps don't pay an extra query each. */
async function aiArtistCredit(): Promise<string | undefined> {
  const profile = await getCurrentProfile();
  const name =
    profile?.display_name?.trim() || profile?.username?.trim() || "";
  return name ? name.slice(0, 120) : undefined;
}

type JobStepStatus = "pending" | "running" | "done" | "failed";
type JobStepErrorCode = "CARD_CAPACITY" | "INSUFFICIENT_CREDITS";

export type JobStep = {
  key: string;
  label: string;
  status: JobStepStatus;
  /** Set once the step's card row exists — retries then skip creation. */
  card_id?: string;
  error?: string;
  /** Set when the failure is a PLAN LIMIT rather than a hiccup — the client
   *  stops the run and opens the matching upgrade prompt instead of
   *  retrying into the same wall (the saved-card cap or an empty balance). */
  error_code?: JobStepErrorCode | null;
  /** Stamped by claim_job_step when the step flips to "running"; a claim
   *  older than 5 minutes is treated as dead and may be reclaimed. */
  claimed_at?: string | null;
  /** The ledger ref of the charge attempt that COMPLETED this step
   *  ("spend:{jobId}:{stepKey}:{uuid}"), stamped on a charged "done".
   *  patch_job_step settles that ledger row (credit_ledger.settled_at,
   *  migration 0106) in the same transaction as the done-write; the
   *  reconcile-credits cron refunds any aged UNSETTLED spend (crashed
   *  attempt, superseded duplicate) without reading job rows. Null when the
   *  winning attempt didn't charge (admin / billing off). */
  spend_ref?: string | null;
  /** card_fill only: the generated fields, poured into the open creator
   *  form by the client (nothing is inserted into `cards`). */
  fill?: CardFillResult | null;
  /** How many times this step has run. Each run sends a DIFFERENT art
   *  prompt (lib/ai/art-prompt-safety.ts) — the moderation filter refuses
   *  the same prompt every time, so a plain retry could never succeed. */
  attempts?: number | null;
  /** The credits this step reserves when it runs, where that isn't one: a
   *  deck remix of a double-faced printing (TODO 5.4, owner Q4: two
   *  pictures, two credits). The client's cost projections read it; absent
   *  = one (every older job). */
  credits?: number;
  /** Why a FAILED step failed, as one of the user-facing kinds
   *  (lib/ai/failure.ts) — the client words its message from it. Null on a
   *  step that succeeded (a retry clears it). */
  failure?: AiFailureKind | null;
  /** The credits a FAILED attempt returned to the user (withCreditedStep's
   *  refund) — 0 when nothing was taken (admin, billing off, a reserve that
   *  never landed). The client says "your credit was returned" only from
   *  this, never by assumption. */
  refunded?: number | null;
  /** A failed attempt's refund that didn't land in-process: the reconcile
   *  sweep returns it (same idempotency key — never twice). */
  refund_pending?: boolean | null;
};

export type GenerationJobRow = {
  id: string;
  owner_id: string;
  kind: "deck" | "deck_remix" | "card" | "card_remix" | "card_fill";
  /** "done" = every step succeeded; "done_with_errors" = finished with a mix
   *  of successes and failures (retryable); "failed" = nothing succeeded. */
  status: "generating" | "done" | "done_with_errors" | "failed" | "cancelled";
  request: Record<string, unknown>;
  plan:
    | DeckJobPlan
    | DeckRemixJobPlan
    | CardJobPlan
    | CardRemixJobPlan
    | CardFillJobPlan
    | null;
  steps: JobStep[];
  deck_id: string | null;
  error: string | null;
};

/** Single-card job (migration 0061): the card text is designed at plan time
 *  (fast), the one step creates + paints it. Replaced the synchronous
 *  /api/ai/random-card request, which ran 60–90s and got cut + re-run at the
 *  infra layer (double charge, client-side "failure"; observed 2026-07-11). */
type CardJobPlan = {
  card: DesignedCard;
  style: string | null;
  /** Resolved after text generation (depends on final colors); null = the
   *  creator's era default for the type. */
  frame_template: string | null;
  /** Deck-aware design: the step adds the finished card to this deck. */
  deck_id?: string | null;
};

/** RETIRED 2026-09-16 (owner decision): the image-to-image "Remix with AI"
 *  job. The kind stays in the union so historical rows still list; no new
 *  jobs of this kind are created and a leftover pending step fails cleanly. */
type CardRemixJobPlan = {
  card_id: string;
  style: string;
  theme: string | null;
};

/** Per-field generation INTO the open creator (migration 0089): the wanted
 *  fields are designed at plan time around the user's pinned values; the
 *  one step paints the art when it was wanted and hands everything back on
 *  the step (`JobStep.fill`). No card row is ever created by this kind. */
type CardFillJobPlan = {
  want: CardFillField[];
  fields: CardFillResult;
  art_prompt: string;
  style: string | null;
  /** Resolved when the card type was generated (create only). */
  frame_template: string | null;
  /** The face the art is painted for (TODO 4.48b), set only on a fill that
   *  wants the art: the frame — the one this plan resolved when the TYPE is
   *  generated, else the creator's current frame (`artFrame`) — with the
   *  card's colours and type words as the fill leaves them. Only the
   *  picture's shape reads it; absent on every plan made before it. */
  art_face?: {
    template: string | null;
    color_identity: string[];
    card_type: string | null;
    supertype: string | null;
    cost: string | null;
  };
  /** Deck-aware design (Pro): the client links the card to this deck. */
  deck_id: string | null;
  /** Art direction appended to the art prompt (the dialog's style preset,
   *  the frame's look). Absent when there is none, and on older plans. */
  art_brief?: string;
};


type DeckJobPlan = {
  deck_title: string;
  strategy: string;
  theme: string;
  style: string | null;
  /** The deck's own format — add-mode inherits it, so any of the twelve. */
  format: string;
  cards: DesignedCard[];
  /** Parallel to cards: skeleton role + deck_cards quantity. */
  roles: string[];
  quantities: number[];
};

type DeckRemixPlanEntry = {
  board: string;
  quantity: number;
  name: string;
  /** Custom-card source (image-to-image restyle allowed). */
  card_id: string | null;
  /** Real-card source — mechanics come from Scryfall oracle data; art is
   *  generated FRESH from a text description (never from the scan). */
  scryfall_id: string | null;
  /** The credits the step reserves (TODO 5.4): 2 for a double-faced
   *  printing landing on its bodies — both faces painted (owner Q4) —
   *  decided at plan time (lib/ai/remix-estimate.ts) so the estimate, the
   *  pre-check and the reserve agree; absent = 1 (every older plan). A
   *  one-credit entry is remixed ONE-FACED whatever its printing. */
  credits?: number;
};

type DeckRemixJobPlan = {
  deck_title: string;
  style: string;
  theme: string | null;
  entries: DeckRemixPlanEntry[];
  /** Entries beyond the caller's batch cap, reported in the UI. */
  skipped: number;
};



const COVER_STEP_KEY = "cover";
/** Free "how to play" guide written after the cards (deck jobs only). */
const GUIDE_STEP_KEY = "guide";





export async function getGenerationJob(
  jobId: string,
): Promise<GenerationJobRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_generation_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  return (data as unknown as GenerationJobRow) ?? null;
}

export type RunStepResult =
  | {
      ok: true;
      job: GenerationJobRow;
      /** True when nothing was claimable because another request is mid-run
       *  on the wanted step — the client should poll, not re-execute. */
      inFlight?: boolean;
    }
  | { ok: false; error: string };

/**
 * Execute one step of a job: the given `stepKey`, or the first pending step.
 * The step is CLAIMED atomically first (pending → running, migration 0066),
 * so concurrent requests — parallel workers, a retry racing a still-running
 * attempt, a second tab — can never execute the same step twice. Persists
 * the outcome via patch_job_step. Card creation is retry-safe (a step whose
 * card exists only redoes the art).
 */
export async function runNextJobStep(
  jobId: string,
  stepKey?: string,
): Promise<RunStepResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to continue generation." };

  // Ownership gate through the user's OWN session (RLS: owners read only
  // their jobs). Everything after this writes with the service role, so
  // this read is what keeps one user from stepping another user's job.
  const owned = await getGenerationJob(jobId);
  if (!owned || owned.owner_id !== user.id) {
    return { ok: false, error: "Job not found." };
  }

  const claim = await claimJobStep(jobId, stepKey);
  if (!claim.ok) return claim;
  const job = claim.job;
  if (!claim.stepKey) {
    // Nothing claimable: the job is finished/cancelled, the wanted step is
    // done, or it's running in another request (report that so the client
    // polls instead of counting a failure).
    // Only a live job can have a step legitimately mid-run elsewhere — a
    // cancelled job's leftover "running" marker must not send the client
    // into a poll loop that can never resolve.
    const live = job.status === "generating";
    const wanted = stepKey
      ? job.steps.find((step) => step.key === stepKey)
      : undefined;
    const inFlight =
      live &&
      (stepKey
        ? wanted?.status === "running"
        : job.steps.some((step) => step.status === "running"));
    return { ok: true, job, inFlight: inFlight || undefined };
  }

  const step = job.steps.find((s) => s.key === claim.stepKey)!;
  const stepIndex = Number(step.key.split(":")[1]);

  // From here the step is OURS ("running") — every exit path below must go
  // through patchJobStep so it can't be left stranded mid-claim. Executor
  // throws are converted to a failed step for the same reason (credits are
  // refunded inside the executors before anything rethrows).
  let result: JobStep;
  try {
    result = await executeJobStep(user.id, job, step, stepIndex);
  } catch (error) {
    // The internal text goes to the log, never to the user (it used to be
    // the step's error verbatim). Any credit was refunded inside the
    // executor's withCreditedStep before the throw reached here, which
    // records what it returned on the error (refunded / refund_pending) so
    // the user is told the truth about it.
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[ai:step] job ${jobId} step ${step.key} threw: ${detail.slice(0, 300)}`);
    const outcome = (error && typeof error === "object" ? error : {}) as {
      refunded?: number;
      refund_pending?: boolean;
    };
    result = {
      ...step,
      status: "failed",
      error: AI_FAILURE_COPY.step_failed,
      failure: "step_failed",
      spend_ref: null,
      refunded: outcome.refunded ?? null,
      refund_pending: outcome.refund_pending ?? null,
    };
  }
  if (result.status === "failed") {
    console.warn(
      `[ai:step] job ${jobId} (${job.kind}) step ${step.key} failed: ${result.failure ?? result.error_code ?? "unclassified"}${
        result.refunded ? `, refunded ${result.refunded}` : ""
      }`,
    );
  }
  return patchJobStep(jobId, result);
}

async function executeJobStep(
  userId: string,
  job: GenerationJobRow,
  step: JobStep,
  stepIndex: number,
): Promise<JobStep> {
  // Card jobs have no deck target — the plan is the whole contract.
  const isCardKind =
    job.kind === "card" || job.kind === "card_remix" || job.kind === "card_fill";
  if (!job.plan || (!isCardKind && !job.deck_id)) {
    return { ...step, status: "failed", error: "Job has no plan — recreate it." };
  }

  if (step.key === COVER_STEP_KEY) {
    return runCoverStep(userId, job, step);
  }
  if (step.key === GUIDE_STEP_KEY) {
    return runGuideStep(job, step);
  }
  switch (job.kind) {
    case "deck": {
      const plan = job.plan as DeckJobPlan;
      const card = plan.cards[stepIndex];
      return card
        ? runDeckCardStep(userId, job, step, plan, stepIndex)
        : { ...step, status: "failed", error: "Missing card plan." };
    }
    case "deck_remix": {
      const plan = job.plan as DeckRemixJobPlan;
      const entry = plan.entries[stepIndex];
      return entry
        ? runDeckRemixStep(userId, job, step, plan, entry)
        : { ...step, status: "failed", error: "Missing entry plan." };
    }
    case "card":
      return runSingleCardStep(userId, job.id, step, job.plan as CardJobPlan);
    case "card_remix":
      return {
        ...step,
        status: "failed",
        error:
          "AI remix has been retired — open the card and use Remix, then Generate with AI.",
      };
    case "card_fill":
      return runCardFillStep(userId, job.id, step, job.plan as CardFillJobPlan);
    default:
      return { ...step, status: "failed", error: "Unknown job kind." };
  }
}

/** Atomically claim a step (pending/stale-running → running) via the
 *  row-locking claim_job_step RPC (migration 0066). Returns the freshly
 *  written job plus the claimed key, or stepKey null when nothing was
 *  claimable (finished job, done step, or a live run elsewhere). */
async function claimJobStep(
  jobId: string,
  stepKey?: string,
): Promise<
  | { ok: true; job: GenerationJobRow; stepKey: string | null }
  | { ok: false; error: string }
> {
  // Service role: job rows are no longer owner-writable (migration 0073) —
  // ownership is checked by the caller BEFORE this runs (runNextJobStep
  // reads the job through the user's RLS-scoped session first).
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_job_step", {
    p_job_id: jobId,
    p_step_key: stepKey ?? null,
  });
  if (error || !data) {
    return { ok: false, error: "Job not found." };
  }
  const payload = data as unknown as {
    job: GenerationJobRow;
    step_key: string | null;
  };
  if (!payload.job) {
    return { ok: false, error: "Job not found." };
  }
  return { ok: true, job: payload.job, stepKey: payload.step_key };
}


type GeneratedCardStepConfig = {
  /** credit_ledger reason for this step's 1-credit charge. */
  reason: string;
  /** card_ai_calls label logged before the paint half. */
  artLogAction: AiActionLabel;
  card: DesignedCard;
  artPrompt: string;
  /** Style line for the safe fallback prompt (attempt 3+). */
  style?: string | null;
  /** Flow-specific createCardAction fields layered over the shared mapping
   *  (frame lock, deck linkage, supertype overrides). Validated by the
   *  action's zod schema like every other create. */
  createExtras?: Record<string, unknown>;
  /** Runs once, right after the card row first exists (e.g. pointing the
   *  deck entry at the right board/quantity). Never re-runs on a repaint. */
  afterCreate?: (cardId: string) => Promise<void>;
};

/**
 * THE card step — shared by single-card and deck generation so the
 * pipeline can't drift between flows (it had: three copies with different
 * refund coverage). Charge → create private card → paint + publish, with the
 * credit wrapper refunding any failed attempt. A retry of a step whose card
 * exists (card_id memo) skips creation and only redoes the art.
 */
async function runGeneratedCardStep(
  userId: string,
  jobId: string,
  step: JobStep,
  config: GeneratedCardStepConfig,
): Promise<JobStep> {
  // A step that still has to CREATE its card needs a free slot. Check before
  // reserving a credit: at the cap every remaining step would fail the same
  // way, and the client stops the run on this code instead of churning
  // reserve → fail → refund for each one.
  if (!step.card_id) {
    const capacity = await getCardCapacity();
    if (capacity && remainingCapacity(capacity) === 0) {
      return {
        ...step,
        status: "failed",
        error: describeCapacity(capacity, 1)?.message ?? "Your saved-card limit is full.",
        error_code: "CARD_CAPACITY",
        spend_ref: null,
      };
    }
  }
  return withCreditedStep(userId, jobId, 1, config.reason, step, async () => {
    const card = config.card;
    let cardId = step.card_id;

    if (!cardId) {
      const gameSystemId = await activeGameSystemId();
      if (!gameSystemId) {
        return { ...step, status: "failed", error: "No game system configured." };
      }

      // A card that lands on a STATION frame (TODO 4.27a, PR 3) saves as the
      // creator saves a new one: the canonical text beside its rows
      // (`face_content.station`), the power / toughness on the tier the
      // text plates. Null for every other card — the payload is then what
      // it always was (stationSaveFields; a Spacecraft with no tier never
      // lands there: resolveGeneratedFrame).
      const extras = config.createExtras ?? {};
      const station = stationSaveFields({
        template: (extras.frame_style as { template?: string } | undefined)?.template,
        rulesText: card.rules_text,
        hasPt: printsPowerToughness({
          cardType: card.card_type,
          supertype: (extras.supertype as string | undefined) ?? card.supertype,
          subtypes: card.subtypes,
          power: card.power,
          toughness: card.toughness,
        }),
      });
      const result = await createCardAction(
        {
          title: card.title,
          game_system_id: gameSystemId,
          cost: card.cost ?? undefined,
          color_identity: card.color_identity,
          supertype: card.supertype ?? undefined,
          card_type: card.card_type,
          subtypes: card.subtypes,
          // A token prints a black set symbol, never a rarity: a NEW token
          // saves as common whatever the designer said (owner decision
          // 2026-09-29, TODO 3b.15) — the creator's rule. The token kind
          // hides the rarity chips, so a token saved rare here could never
          // be set back in the creator.
          rarity: card.card_type === "token" ? "common" : card.rarity,
          rules_text: card.rules_text ?? undefined,
          ...(station ?? {}),
          flavor_text: card.flavor_text ?? undefined,
          power: card.power ?? undefined,
          toughness: card.toughness ?? undefined,
          loyalty: card.loyalty ?? undefined,
          defense: card.defense ?? undefined,
          visibility: "private",
          artist_credit: await aiArtistCredit(),
          ...config.createExtras,
        },
        { redirectAfterCreate: false },
      );
      if (!result.ok) {
        return {
          ...step,
          status: "failed",
          error: createFailureMessage(result),
          failure: "save_failed",
          // The DB trigger (migration 0104) can still say no when parallel
          // steps race for the last slot — same code, same client handling.
          error_code: result.reason === "capacity" ? "CARD_CAPACITY" : undefined,
        };
      }
      cardId = result.cardId;
      await config.afterCreate?.(cardId);
    }

    // The picture's shape: the window of the frame the card is ON (TODO
    // 4.48b) — the one it was just created with, or, on a retry of a step
    // whose card exists, the one it was saved with.
    const shape = await generatedCardArtShape(
      step.card_id ? cardId : null,
      generatedCardArtFace(card, config.createExtras),
    );
    await logAiCall(userId, config.artLogAction);
    // Every run rewords the art prompt (moderation refuses identical text),
    // and a refusal walks straight to the next rung inside this step.
    const attempt = (step.attempts ?? 0) + 1;
    const published = await paintAndPublishCard(
      cardId,
      artPromptLadder(attempt, config.artPrompt, fallbackInputsFor(card, config.style)),
      shape,
    );
    if (!published.ok) {
      return {
        ...step,
        status: "failed",
        card_id: cardId,
        attempts: attempt,
        error: published.error,
        failure: published.failure,
      };
    }
    return { ...step, status: "done", card_id: cardId, attempts: attempt, error: undefined };
  });
}

/** The face a generated card is CREATED as, for its picture's shape: the
 *  designed card with the flow's create-time frame and supertype (no
 *  template = the default frame, as the card then draws). */
function generatedCardArtFace(card: DesignedCard, extras?: Record<string, unknown>): ArtFace {
  const frameStyle = extras?.frame_style as { template?: unknown } | undefined;
  const supertype = extras?.supertype;
  return {
    template: typeof frameStyle?.template === "string" ? frameStyle.template : null,
    colorIdentity: card.color_identity,
    cardType: card.card_type,
    supertype: typeof supertype === "string" ? supertype : card.supertype,
    cost: card.cost,
  };
}

/** The shape a generated card's picture is painted in (TODO 4.48b). A
 *  retried step whose card already exists reads the card back: the frame it
 *  was SAVED on is the window (a deck card's frame is resolved only by the
 *  attempt that created it). A row that can't be read paints for `created`. */
async function generatedCardArtShape(existingCardId: string | null, created: ArtFace): Promise<ArtShape> {
  if (!existingCardId) return artShapeForFace(created);
  const supabase = await createClient();
  const { data } = await supabase
    .from("cards")
    .select("frame_style, color_identity, card_type, supertype, cost")
    .eq("id", existingCardId)
    .maybeSingle();
  const row = data as
    | {
        frame_style?: { template?: unknown } | null;
        color_identity?: string[] | null;
        card_type?: string | null;
        supertype?: string | null;
        cost?: string | null;
      }
    | null;
  if (!row || typeof row.card_type !== "string") return artShapeForFace(created);
  return artShapeForFace({
    template: typeof row.frame_style?.template === "string" ? row.frame_style.template : null,
    colorIdentity: row.color_identity ?? null,
    cardType: row.card_type,
    supertype: row.supertype ?? null,
    cost: row.cost ?? null,
  });
}

/** What the safe fallback prompt may use: only the card's identity. */
function fallbackInputsFor(card: DesignedCard, style?: string | null): FallbackArtInputs {
  return {
    title: card.title,
    typeLine: [card.supertype, card.card_type, card.subtypes?.length ? `— ${card.subtypes.join(" ")}` : null]
      .filter(Boolean)
      .join(" "),
    colors: card.color_identity,
    style: style ?? null,
  };
}

// ---------------------------------------------------------------------------
// Single-card generation (the "Generate a card with AI" dialog)
// ---------------------------------------------------------------------------

export type CreateCardJobInput = {
  theme?: string;
  style?: string;
  cardType?: CardType;
  /** "random" or a specific published frame for the chosen type. */
  frame?: "random" | FrameTemplate;
  rarity?: Rarity;
  /** Pro: design the card FOR this deck (owner's) — the deck is analyzed
   *  and briefed to the designer, and the finished card is added to it. */
  deckId?: string;
};

type OwnedDeckContext = {
  deck: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    format: string;
    cover_url: string | null;
    deck_type: string | null;
    bracket: number | null;
  };
  items: Awaited<ReturnType<typeof listDeckCards>>;
  context: {
    title: string;
    description: string | null;
    hasCommander: boolean;
    cards: { name: string; type_line: string | null; rules_text: string | null }[];
  };
};

/** The caller's deck + its cards in the shape the designers read. Null when
 *  the deck doesn't exist or isn't theirs (RLS hides other users' private
 *  decks; public ones are rejected by the owner check). Shared with the
 *  card-ideas route. */
export async function loadOwnedDeckContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  deckId: string,
  userId: string,
): Promise<OwnedDeckContext | null> {
  const { data } = await supabase
    .from("decks")
    .select("id, slug, title, description, format, cover_url, owner_id, deck_type, bracket")
    .eq("id", deckId)
    .maybeSingle();
  if (!data || data.owner_id !== userId) return null;
  const items = await listDeckCards(data.id);
  return {
    deck: data,
    items,
    context: {
      title: data.title,
      description: data.description,
      hasCommander: items.some((item) => item.entry.board === "commander"),
      cards: items.map((item) => ({
        name: item.card?.title ?? item.entry.name,
        type_line:
          item.entry.type_line ??
          (item.card
            ? [item.card.supertype, item.card.card_type, ...(item.card.subtypes ?? [])]
                .filter(Boolean)
                .join(" ")
            : null),
        rules_text: item.card?.rules_text ?? null,
      })),
    },
  };
}

export type CreateCardJobResult =
  | { ok: true; job: GenerationJobRow }
  /** `code`: a station fill whose empty tier came back empty (no job,
   *  nothing charged), or the kind of a plan-time design failure
   *  (lib/ai/failure.ts) — nothing is reserved at plan time, so its message
   *  always says no credits were used. */
  | { ok: false; error: string; code?: "STATION_TIER_UNFILLED" | AiFailureKind };

/** A plan-time design failure: its kind, logged with the raw detail
 *  (server only), and the user's sentence. Nothing was reserved. */
/** The face a designed card resolves its frame by. */
function designedFace(card: DesignedCard) {
  return {
    cardType: card.card_type,
    supertype: card.supertype,
    subtypes: card.subtypes,
    title: card.title,
    rulesText: card.rules_text,
    flavorText: card.flavor_text,
    power: card.power,
    toughness: card.toughness,
  };
}

/** The plan route runs at 300 s: a redesign (a repeated title, a type with
 *  no frame) is made only when the first design took under this — the
 *  second call, the frame resolve and the insert then still fit. */
const PLAN_REDESIGN_MAX_FIRST_MS = 100_000;
const planRedesignFits = (firstMs: number) => firstMs < PLAN_REDESIGN_MAX_FIRST_MS;

function planDesignFailure(
  error: unknown,
  label: string,
): { ok: false; error: string; code: AiFailureKind } {
  const detail = error instanceof Error ? error.message : String(error);
  const unreadable =
    (error instanceof Error && error.name === "AiOutputError") ||
    (error instanceof Error && error.name === "AI_NoObjectGeneratedError");
  const code: AiFailureKind = error instanceof DesignNotUsableError
    ? "type_unavailable"
    : unreadable
      ? "design_unreadable"
      : designFailureKind(classifyProviderError(detail));
  console.error(`[ai:design] ${label} plan failed (${code}): ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
  return { ok: false, error: aiFailureMessage(code), code };
}

/** PLAN a single-card job: one fast text call designs the card; the art +
 *  save happen in the job's one step so no HTTP request runs long. */
export async function createCardGenerationJob(
  input: CreateCardJobInput,
): Promise<CreateCardJobResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to generate a card." };

  // Deck-aware design (Pro): brief the designer with the deck's colors,
  // curve, type mix and card list so the card fills a real gap, and remember
  // the deck so the step adds the card to it. Gated here as well as in the
  // route — this function is the only path that reads someone's deck.
  let deckContext: OwnedDeckContext | null = null;
  let deckBrief: ReturnType<typeof buildDeckBrief> | null = null;
  if (input.deckId) {
    await requireTier("pro");
    deckContext = await loadOwnedDeckContext(await createClient(), input.deckId, user.id);
    if (!deckContext) return { ok: false, error: "Deck not found or not yours." };
    deckBrief = buildDeckBrief({
      title: deckContext.deck.title,
      description: deckContext.deck.description,
      format: deckContext.deck.format,
      cards: deckContext.context.cards,
      analytics: computeDeckAnalytics(deckContext.items),
    });
  }

  // When the user locked a specific frame, steer generation toward a color
  // that frame actually has published art for (same logic as the legacy
  // random-card route). A deck brief's dominant color steers the same way
  // when the frame is left random.
  const verifiedKeys = new Set(await getVerifiedFrameKeys());
  let colorHint: ColorIdentity | undefined = deckBrief?.colorHint;
  if (input.frame && input.frame !== "random" && input.cardType) {
    const hints = colorHintsForFrame(input.cardType, input.frame, verifiedKeys);
    if (hints.length > 0) {
      colorHint = hints[Math.floor(Math.random() * hints.length)];
    }
  }

  await logAiCall(user.id, "generate_random_card");
  // Never the same card twice (2026-10-28): a fresh spark per design and the
  // user's recent AI titles named as off-limits; a repeat title is designed
  // again once, here, before anything is reserved (lib/ai/design-variety.ts).
  const recent = await recentAiTitles(user.id);
  const avoidTypes = typesWithoutPublishedFrame(verifiedKeys);
  let card: DesignedCard;
  try {
    card = await designFreshly(
      recent,
      (variety) =>
        generateRandomCard({
          theme: input.theme,
          style: input.style,
          cardType: input.cardType,
          rarity: input.rarity,
          colorHint,
          context: deckBrief?.context,
          variety,
          avoidTypes,
        }),
      (designed) => designed.title,
      {
        // A type the user didn't ask for that has no published frame in the
        // design's own colour (the designer was told to avoid the types
        // with none at all) is designed again, never saved.
        acceptable: (designed) =>
          Boolean(input.cardType) ||
          designHasPublishedFrame(
            { cardType: designed.card_type, colorIdentity: designed.color_identity, face: designedFace(designed) },
            verifiedKeys,
          ),
        secondFits: planRedesignFits,
      },
    );
  } catch (error) {
    // Plan time: no job row, nothing reserved — nothing to refund.
    return planDesignFailure(error, "card");
  }

  const frameTemplate = resolveGeneratedFrame({
    cardType: card.card_type,
    requested: input.frame,
    colorIdentity: card.color_identity,
    verifiedKeys,
    face: designedFace(card),
  });

  const plan: CardJobPlan = {
    card,
    style: input.style?.trim() || null,
    frame_template: frameTemplate ?? null,
    deck_id: deckContext?.deck.id ?? null,
  };
  const steps: JobStep[] = [
    { key: "card:0", label: card.title, status: "pending" },
  ];

  const supabase = await createClient();
  const { data: jobRow, error: insertError } = await supabase
    .from("ai_generation_jobs")
    .insert({
      owner_id: user.id,
      kind: "card",
      status: "generating",
      deck_id: deckContext?.deck.id ?? null,
      request: {
        theme: input.theme ?? null,
        style: input.style ?? null,
        card_type: input.cardType ?? null,
        rarity: input.rarity ?? null,
        deck_id: deckContext?.deck.id ?? null,
      },
      plan: plan as unknown as Json,
      steps: steps as unknown as Json,
    })
    .select("*")
    .single();
  if (insertError || !jobRow) {
    return { ok: false, error: "Couldn't persist the generation job." };
  }
  return { ok: true, job: jobRow as unknown as GenerationJobRow };
}

// ---------------------------------------------------------------------------
// Per-field fill (the creator's "Generate with AI" dialog, migration 0089)
// ---------------------------------------------------------------------------

export type CreateCardFillJobInput = {
  want: CardFillField[];
  locked: CardFillLocked;
  steer: CardFillSteer;
  theme?: string;
  style?: string;
  /** Create only, with card_type wanted: "random" or a specific frame. */
  frame?: "random" | FrameTemplate;
  /** The creator's CURRENT frame (a known template, validated by the
   *  route), for a fill that keeps the card type: the art is painted in its
   *  window's shape (TODO 4.48b). Read for nothing else — the fill never
   *  sets a frame from it. */
  artFrame?: FrameTemplate;
  /** Pro: brief the designer with this deck. */
  deckId?: string;
  /** The creator this fill belongs to — see app/api/ai/card-fill. */
  scope?: string;
  /** The AI dialog (its PR 1 redesign) names the KIND it asked for —
   *  "surprise" or one of AI_DESIGN_KINDS. Set, the fill is designed
   *  frame-first: a frame picked by name gets the frame brief and is kept
   *  or the fill is refused (never a random draw), and a free design never
   *  comes back as a kind the dialog can't make (a battle). Absent (an
   *  older client), the fill is what it always was. */
  designKind?: AiDesignKind | "surprise";
  /** The theme / style were assembled from the dialog's presets
   *  (lib/ai/presets.ts assemblePrompt): what the painter reads. */
  assembled?: { artStyle?: string; styleArt: string };
};

/** PLAN a fill job: design the wanted fields around the pinned ones (fast
 *  text call); the step paints the art if it was wanted. Same 1-credit
 *  price whatever was ticked — charged by the step, refunded on failure.
 *  A station card's fill whose empty tier came back empty never becomes a
 *  job (STATION_TIER_UNFILLED): nothing is charged. */
export async function createCardFillJob(
  input: CreateCardFillJobInput,
): Promise<CreateCardJobResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to generate with AI." };

  let deckContext: OwnedDeckContext | null = null;
  let deckBrief: ReturnType<typeof buildDeckBrief> | null = null;
  if (input.deckId) {
    await requireTier("pro");
    deckContext = await loadOwnedDeckContext(await createClient(), input.deckId, user.id);
    if (!deckContext) return { ok: false, error: "Deck not found or not yours." };
    deckBrief = buildDeckBrief({
      title: deckContext.deck.title,
      description: deckContext.deck.description,
      format: deckContext.deck.format,
      cards: deckContext.context.cards,
      analytics: computeDeckAnalytics(deckContext.items),
    });
  }

  const verifiedKeys = new Set(await getVerifiedFrameKeys());
  const wantsType = input.want.includes("card_type");
  const wantsColors = input.want.includes("color_identity");
  // Frame-first (the AI dialog's redesign): a kind and a frame picked by
  // name. The design is made FOR the frame and kept on it, or refused.
  const pickedFrame: FrameTemplate | null =
    input.designKind && wantsType && input.steer.card_type && input.frame && input.frame !== "random"
      ? input.frame
      : null;
  let colorHint: ColorIdentity | undefined = deckBrief?.colorHint;
  if (wantsType && input.frame && input.frame !== "random" && input.steer.card_type) {
    const hints = colorHintsForFrame(input.steer.card_type, input.frame, verifiedKeys);
    // A colour the maker keeps (Colors not ticked) is the card's: the frame
    // was offered only where it is published in it.
    if (hints.length > 0 && !(pickedFrame && !wantsColors)) {
      colorHint = hints[Math.floor(Math.random() * hints.length)];
    }
  }
  const brief = pickedFrame
    ? frameBrief(
        pickedFrame,
        input.steer.card_type!,
        wantsColors ? frameColorKeysOf(input.steer.card_type!, pickedFrame, verifiedKeys) : undefined,
      )
    : undefined;

  await logAiCall(user.id, "fill_card");
  // Never the same card twice (2026-10-28) — see createCardGenerationJob.
  // Only a fill that WRITES the title is checked against the recent titles
  // (a kept title is the maker's); the spark rides every fill.
  const recent = await recentAiTitles(user.id);
  const avoidTypes =
    wantsType && !input.steer.card_type
      ? input.designKind
        ? // The dialog's Surprise me: never a kind it can't make (a battle).
          [...new Set([...typesWithoutPublishedFrame(verifiedKeys), ...FREE_DESIGN_TYPES.filter((type) => !isAiDesignKind(type))])]
        : typesWithoutPublishedFrame(verifiedKeys)
      : [];
  // The design as the card it becomes: the designed fields over the pinned.
  const faceOf = (fields: CardFillResult) => ({
    cardType: fields.card_type ?? input.locked.card_type,
    supertype: fields.supertype !== undefined ? fields.supertype : input.locked.supertype,
    subtypes: fields.subtypes ?? input.locked.subtypes,
    title: fields.title ?? input.locked.title,
    rulesText: fields.rules_text ?? input.locked.rules_text,
    flavorText: fields.flavor_text ?? input.locked.flavor_text,
    power: fields.power !== undefined ? fields.power : input.locked.power,
    toughness: fields.toughness !== undefined ? fields.toughness : input.locked.toughness,
  });
  const fitOf = (fields: CardFillResult) =>
    frameFitOf({
      template: pickedFrame!,
      cardType: fields.card_type ?? input.steer.card_type!,
      colorIdentity: fields.color_identity ?? input.locked.color_identity ?? [],
      verifiedKeys,
      face: { ...faceOf(fields), cardType: fields.card_type ?? input.steer.card_type! },
    });
  type DesignedFill = Awaited<ReturnType<typeof designCardFill>>;
  let designed: DesignedFill;
  try {
    designed = await designFreshly(
      recent,
      (variety) =>
        designCardFill({
          want: input.want,
          locked: input.locked,
          steer: input.steer,
          theme: input.theme,
          style: input.style,
          context: deckBrief?.context,
          colorHint,
          variety,
          avoidTypes,
          ...(brief ? { frameBrief: brief } : {}),
          ...(input.assembled ? { assembled: true } : {}),
        }),
      (result) => (input.want.includes("title") ? result.fields.title : null),
      {
        ...(pickedFrame
          ? {
              // Frame-first: the frame picked, in its own shape (a token
              // height, a walker box, a textless frame as picked) — else
              // redone once; a design its own words carry onto a dress of
              // the frame (print's rule: a Vehicle, an Enchantment
              // Creature's Nyx) is kept when neither answer is the frame
              // itself; one the frame can't dress at all is refused, before
              // any charge.
              acceptable: (result: DesignedFill) => fitOf(result.fields).exact,
              fallbackAcceptable: (result: DesignedFill) => fitOf(result.fields).frame !== null,
            }
          : {
              // A generated type must land on a published frame in the
              // card's colour (the generated one, else the pinned one).
              acceptable: (result: DesignedFill) =>
                !result.fields.card_type ||
                Boolean(input.steer.card_type) ||
                designHasPublishedFrame(
                  {
                    cardType: result.fields.card_type,
                    colorIdentity: result.fields.color_identity ?? input.locked.color_identity ?? [],
                    face: { ...faceOf(result.fields), cardType: result.fields.card_type },
                  },
                  verifiedKeys,
                ),
            }),
        secondFits: planRedesignFits,
      },
    );
  } catch (error) {
    // A station card's empty tier came back empty from the model AND the
    // judge: refused here, at PLAN time — no job row, no step, so no credit
    // is reserved, settled or refunded, and the form is left as it was.
    if (error instanceof StationGapUnfilledError) {
      return { ok: false, error: error.message, code: error.code };
    }
    // Two designs that the frame picked can't dress: refused, nothing
    // reserved (the same plan-time refusal as an unavailable type).
    if (pickedFrame && error instanceof DesignNotUsableError) {
      console.warn(`[ai:design] card_fill didn't fit ${pickedFrame} twice`);
      return { ok: false, error: aiFailureMessage("frame_unfit"), code: "frame_unfit" };
    }
    return planDesignFailure(error, "card_fill");
  }

  // A generated card type needs a frame that can wear it (create only —
  // revise never asks for the type). Colors: generated ones, else pinned.
  const frameTemplate = pickedFrame
    ? fitOf(designed.fields).frame
    : wantsType && designed.fields.card_type
      ? resolveGeneratedFrame({
          cardType: designed.fields.card_type,
          requested: input.frame ?? "random",
          colorIdentity:
            designed.fields.color_identity ??
            input.locked.color_identity ??
            [],
          verifiedKeys,
          face: {
            cardType: designed.fields.card_type,
            supertype:
              designed.fields.supertype !== undefined
                ? designed.fields.supertype
                : input.locked.supertype,
            subtypes: designed.fields.subtypes ?? input.locked.subtypes,
            title: designed.fields.title ?? input.locked.title,
            rulesText: designed.fields.rules_text ?? input.locked.rules_text,
            flavorText: designed.fields.flavor_text ?? input.locked.flavor_text,
            power: designed.fields.power !== undefined ? designed.fields.power : input.locked.power,
            toughness: designed.fields.toughness !== undefined ? designed.fields.toughness : input.locked.toughness,
          },
        })
      : null;

  const plan: CardFillJobPlan = {
    want: input.want,
    fields: designed.fields,
    art_prompt: designed.art_prompt,
    style: (input.assembled ? input.assembled.artStyle : input.style)?.trim() || null,
    frame_template: frameTemplate ?? null,
    // The art's window (TODO 4.48b): the frame this fill picked with the
    // type, else the creator's own — the card as it stands once filled.
    ...(input.want.includes("art")
      ? {
          art_face: {
            template: wantsType ? (frameTemplate ?? null) : (input.artFrame ?? null),
            color_identity: designed.fields.color_identity ?? input.locked.color_identity ?? [],
            card_type: designed.fields.card_type ?? input.locked.card_type ?? null,
            supertype:
              (designed.fields.supertype !== undefined ? designed.fields.supertype : input.locked.supertype) ?? null,
            cost: (designed.fields.cost !== undefined ? designed.fields.cost : input.locked.cost) ?? null,
          },
        }
      : {}),
    deck_id: deckContext?.deck.id ?? null,
  };
  // The art direction (the dialog's style preset, then the frame's own
  // look — lib/ai/frame-art-brief.ts): stored only when there is some.
  if (input.want.includes("art")) {
    const artBrief = [
      input.assembled?.styleArt ?? "",
      frameArtBrief(plan.art_face?.template ?? null),
    ]
      .filter(Boolean)
      .join(" ");
    if (artBrief) plan.art_brief = artBrief;
  }
  const steps: JobStep[] = [
    {
      key: "fill:0",
      label: designed.fields.title ?? input.locked.title ?? "Your card",
      status: "pending",
    },
  ];

  const supabase = await createClient();
  const { data: jobRow, error: insertError } = await supabase
    .from("ai_generation_jobs")
    .insert({
      owner_id: user.id,
      kind: "card_fill",
      status: "generating",
      deck_id: deckContext?.deck.id ?? null,
      request: {
        want: input.want,
        theme: input.theme ?? null,
        style: input.style ?? null,
        deck_id: deckContext?.deck.id ?? null,
        scope: input.scope ?? "create",
        claimed_at: null,
      },
      plan: plan as unknown as Json,
      steps: steps as unknown as Json,
    })
    .select("*")
    .single();
  if (insertError || !jobRow) {
    return { ok: false, error: "Couldn't persist the generation job." };
  }
  return { ok: true, job: jobRow as unknown as GenerationJobRow };
}

/** The fill job's single step: paint the art when it was wanted, then hand
 *  every generated field back on the step. One credit either way. */
async function runCardFillStep(
  userId: string,
  jobId: string,
  step: JobStep,
  plan: CardFillJobPlan,
): Promise<JobStep> {
  if (step.fill) {
    return { ...step, status: "done", error: undefined };
  }
  return withCreditedStep(userId, jobId, 1, "fill_card", step, async () => {
    const fill: CardFillResult = {
      ...plan.fields,
      frame_template: plan.frame_template,
      deck_id: plan.deck_id,
    };
    const attempt = (step.attempts ?? 0) + 1;
    if (plan.want.includes("art")) {
      const style = plan.style?.trim()
        ? ` Rendered strictly in ${plan.style.trim()} style.`
        : "";
      const direction = plan.art_brief?.trim() ? ` ${plan.art_brief.trim()}` : "";
      await logAiCall(userId, "generate_random_art");
      const image = await generateImageWithFallbacks(
        artPromptLadder(
          attempt,
          `${plan.art_prompt}${style}${direction} NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.`,
          {
            title: plan.fields.title ?? step.label,
            typeLine: plan.fields.card_type ?? null,
            colors: plan.fields.color_identity ?? null,
            style: plan.style,
          },
        ),
        cardFillArtShape(plan),
      );
      if (!image.ok) {
        return { ...step, status: "failed", attempts: attempt, error: image.error, failure: image.failure };
      }
      const persisted = await persistGeneratedArt(image.bytes, image.contentType);
      if (!persisted.ok) {
        return {
          ...step,
          status: "failed",
          attempts: attempt,
          error: AI_FAILURE_COPY.art_store,
          failure: "art_store",
        };
      }
      fill.art_url = persisted.publicUrl;
      fill.artist_credit = await aiArtistCredit();
    }
    return { ...step, status: "done", fill, attempts: attempt, error: undefined };
  });
}

/** The shape a fill's picture is painted in (TODO 4.48b): the plan's
 *  `art_face` — a plan made before it paints for the frame it resolved and
 *  the fields it wrote (the default frame when it resolved none). */
function cardFillArtShape(plan: CardFillJobPlan): ArtShape {
  const face = plan.art_face;
  if (face) {
    return artShapeForFace({
      template: face.template,
      colorIdentity: face.color_identity,
      cardType: face.card_type,
      supertype: face.supertype,
      cost: face.cost,
    });
  }
  return artShapeForFace({
    template: plan.frame_template,
    colorIdentity: plan.fields.color_identity ?? null,
    cardType: plan.fields.card_type ?? null,
    supertype: plan.fields.supertype ?? null,
    cost: plan.fields.cost ?? null,
  });
}

/** The card job's single step — the shared card step with the single-card
 *  ledger reason and the user's locked frame. */
async function runSingleCardStep(
  userId: string,
  jobId: string,
  step: JobStep,
  plan: CardJobPlan,
): Promise<JobStep> {
  const style = plan.style?.trim()
    ? ` Rendered strictly in ${plan.style.trim()} style.`
    : "";
  return runGeneratedCardStep(userId, jobId, step, {
    reason: "generate_random_card",
    artLogAction: "generate_random_art",
    card: plan.card,
    style: plan.style,
    artPrompt: `${plan.card.art_prompt}${style} NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.`,
    createExtras: {
      frame_style: plan.frame_template
        ? { template: plan.frame_template }
        : undefined,
      // Designed for a deck → the same create-time linkage the Publish
      // panel's deck picker uses (createCardAction → deck_cards, main ×1).
      deck_id: plan.deck_id ?? undefined,
    },
  });
}

// Remix steps chain identity (30s, lib/ai/remix.ts) + source-art fetch +
// restyle + a t2i fallback inside the step route's 180s budget. These
// per-leg caps keep the worst-case sum (~160s) under the platform kill —
// a single generous cap does not compose across two image calls.
const SOURCE_ART_FETCH_TIMEOUT_MS = 10_000;
const REMIX_IMAGE_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Deck generation
// ---------------------------------------------------------------------------

export type CreateDeckJobInput = {
  theme: string;
  style?: string;
  format: AiDeckFormat;
  size: number;
  /** Generate ADDITIONAL cards into this existing deck (must be owned).
   *  The plan reads the deck's current cards so new designs synergize —
   *  a 100-card read is a few thousand prompt tokens (~pennies). */
  deckId?: string;
  /** Tribe/archetype key (lib/decks/deck-types.ts) the deck is built around. */
  deckType?: string;
  /** Commander power bracket 1–5. */
  bracket?: number;
};

export type CreateDeckJobResult =
  | { ok: true; job: GenerationJobRow; deckSlug: string }
  | { ok: false; error: string };

export async function createDeckGenerationJob(
  input: CreateDeckJobInput,
): Promise<CreateDeckJobResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to generate decks." };

  const supabase = await createClient();

  // ---- Add-to-existing mode: load the deck + its cards for synergy ----
  let existingDeck: OwnedDeckContext["deck"] | null = null;
  let existingContext: OwnedDeckContext["context"] | undefined;
  if (input.deckId) {
    const owned = await loadOwnedDeckContext(supabase, input.deckId, user.id);
    if (!owned) return { ok: false, error: "Deck not found or not yours." };
    existingDeck = owned.deck;
    existingContext = owned.context;
  }

  let planResult;
  try {
    planResult = await generateDeckPlan({
      theme: input.theme,
      style: input.style,
      format: (existingDeck?.format as DeckFormat) ?? input.format,
      size: input.size,
      existing: existingContext,
      deckType: deckTypeByKey(input.deckType ?? existingDeck?.deck_type ?? null),
      bracket: input.bracket ?? existingDeck?.bracket ?? null,
    });
  } catch (error) {
    const failed = planDesignFailure(error, "deck");
    return { ok: false, error: failed.error };
  }

  let deckId = existingDeck?.id;
  let deckSlug = existingDeck?.slug;
  if (!deckId) {
    // AI-generated decks ship PUBLIC by default (owner decision, 2026-07-10).
    const created = await createDeckAction(
      {
        title: planResult.concept.deck_title,
        description: planResult.concept.deck_description,
        format: input.format,
        visibility: "public",
        deck_type: input.deckType ?? null,
        bracket: input.format === "commander" ? (input.bracket ?? null) : null,
      },
      { redirectAfterCreate: false },
    );
    if (!created.ok) return { ok: false, error: "Couldn't create the deck." };
    deckId = created.deckId;
    deckSlug = created.slug;
  }

  const plan: DeckJobPlan = {
    deck_title: existingDeck?.title ?? planResult.concept.deck_title,
    strategy: planResult.concept.strategy,
    theme: input.theme.trim() || "designer's choice",
    style: input.style?.trim() || null,
    format: (existingDeck?.format as DeckFormat) ?? input.format,
    cards: planResult.cards,
    roles: planResult.slots.map((slot) => slot.role),
    quantities: planResult.slots.map((slot) => slot.quantity),
  };
  const steps: JobStep[] = planResult.cards.map((card, index) => ({
    key: `card:${index}`,
    label: card.title,
    status: "pending" as const,
  }));
  // New decks always get a cover; add-mode only when the deck has none.
  if (!existingDeck || !existingDeck.cover_url) {
    steps.push({ key: COVER_STEP_KEY, label: "Deck cover", status: "pending" });
  }
  // The free how-to-play guide, written once every card is in.
  steps.push({ key: GUIDE_STEP_KEY, label: "How to play guide", status: "pending" });

  const { data: jobRow, error: insertError } = await supabase
    .from("ai_generation_jobs")
    .insert({
      owner_id: user.id,
      kind: "deck",
      status: "generating",
      request: {
        theme: input.theme,
        style: input.style ?? null,
        format: plan.format,
        size: input.size,
        deck_id: deckId,
        deck_slug: deckSlug,
        added_to_existing: Boolean(existingDeck),
      },
      plan: plan as unknown as Json,
      steps: steps as unknown as Json,
      deck_id: deckId,
    })
    .select("*")
    .single();
  if (insertError || !jobRow) {
    return { ok: false, error: "Couldn't persist the generation job." };
  }
  return {
    ok: true,
    job: jobRow as unknown as GenerationJobRow,
    deckSlug: deckSlug ?? "",
  };
}

/** Theme/style the deck was originally generated with, for prefilling the
 *  "generate more cards" panel so additions stay stylistically consistent.
 *  Null when the deck has no AI-generation history. */
export async function getDeckAiSeed(
  deckId: string,
): Promise<{ theme: string | null; style: string | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_generation_jobs")
    .select("request, kind, created_at")
    .eq("deck_id", deckId)
    .in("kind", ["deck", "deck_remix"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const request = (data.request ?? {}) as { theme?: unknown; style?: unknown };
  return {
    theme: typeof request.theme === "string" && request.theme ? request.theme : null,
    style: typeof request.style === "string" && request.style ? request.style : null,
  };
}

/** getDeckAiSeed for many decks in one query — the creator's deck picker
 *  prefills theme/style from whichever AI job last touched each deck. */
export async function getDeckAiSeeds(
  deckIds: string[],
): Promise<Map<string, { theme: string | null; style: string | null }>> {
  const out = new Map<string, { theme: string | null; style: string | null }>();
  if (deckIds.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_generation_jobs")
    .select("deck_id, request, created_at")
    .in("deck_id", deckIds)
    .in("kind", ["deck", "deck_remix", "card"])
    .order("created_at", { ascending: false })
    .limit(deckIds.length * 5);
  for (const row of data ?? []) {
    if (!row.deck_id || out.has(row.deck_id)) continue;
    const request = (row.request ?? {}) as { theme?: unknown; style?: unknown };
    const theme = typeof request.theme === "string" && request.theme ? request.theme : null;
    const style = typeof request.style === "string" && request.style ? request.style : null;
    if (theme || style) out.set(row.deck_id, { theme, style });
  }
  return out;
}

export type CreateDeckRemixJobInput = {
  deckId: string;
  style: string;
  theme?: string;
  /** Max entries to remix this generation (batch cap). */
  limit: number;
  /** The jobs route's estimate (lib/ai/remix-estimate.ts): the credits each
   *  entry reserves, by deck_cards id — 2 for a double-faced printing that
   *  lands on its bodies (TODO 5.4). An entry it doesn't name costs 1 and is
   *  remixed one-faced. */
  creditsByEntry?: Readonly<Record<string, number>>;
};

export async function createDeckRemixJob(
  input: CreateDeckRemixJobInput,
): Promise<CreateDeckJobResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to remix decks." };

  const supabase = await createClient();
  const { data: deck } = await supabase
    .from("decks")
    .select("id, title, description, format, owner_id")
    .eq("id", input.deckId)
    .maybeSingle();
  if (!deck || deck.owner_id !== user.id) {
    return { ok: false, error: "Deck not found or not yours." };
  }

  const items = await listDeckCards(deck.id);
  // Emblems are not remixed (owner 2026-10-13): the user's own are left
  // out before the batch cap — the estimate's own filter — and a printed
  // one is what the estimate priced 0. No step, no charge; the new deck
  // has no emblem.
  const { remixable, ownEmblems } = remixableDeckItems(items);
  const capped = remixable.slice(0, input.limit);
  const taken = capped.filter((item) => input.creditsByEntry?.[item.entry.id] !== 0);
  if (taken.length === 0) {
    return {
      ok: false,
      error:
        ownEmblems > 0 || capped.length > 0
          ? "Nothing to remix — emblems aren't remixed."
          : "Nothing to remix — the deck has no resolved cards yet.",
    };
  }
  const skipped = remixable.length - capped.length;

  // Remix copies ship PUBLIC too — same posture as generated decks.
  const created = await createDeckAction(
    {
      title: `${deck.title} (AI remix)`.slice(0, 120),
      description: deck.description ?? undefined,
      format: deck.format,
      visibility: "public",
    },
    { redirectAfterCreate: false },
  );
  if (!created.ok) return { ok: false, error: "Couldn't create the remix deck." };

  const plan: DeckRemixJobPlan = {
    deck_title: deck.title,
    style: input.style.trim(),
    theme: input.theme?.trim() || null,
    entries: taken.map((item) => {
      const credits = input.creditsByEntry?.[item.entry.id];
      return {
        board: item.entry.board,
        quantity: item.entry.quantity,
        name: item.entry.name,
        card_id: item.entry.card_id,
        scryfall_id: item.entry.scryfall_id,
        // A double-faced printing's two pictures (TODO 5.4): only what the
        // estimate priced; everything else is one credit, one face.
        ...(credits !== undefined && credits > 1 ? { credits } : {}),
      };
    }),
    skipped,
  };
  const steps: JobStep[] = plan.entries.map((entry, index) => ({
    key: `remix:${index}`,
    label: entry.name,
    status: "pending" as const,
    ...(entry.credits !== undefined && entry.credits > 1 ? { credits: entry.credits } : {}),
  }));
  steps.push({ key: COVER_STEP_KEY, label: "Deck cover", status: "pending" });
  // Same free guide step as a generated deck — pushed BEFORE the insert (it
  // used to land after, into the discarded local array, so remix decks never
  // got a "How to play" guide).
  steps.push({ key: GUIDE_STEP_KEY, label: "How to play guide", status: "pending" });

  const { data: jobRow, error: insertError } = await supabase
    .from("ai_generation_jobs")
    .insert({
      owner_id: user.id,
      kind: "deck_remix",
      status: "generating",
      request: {
        source_deck_id: deck.id,
        style: input.style,
        theme: input.theme ?? null,
        deck_id: created.deckId,
        deck_slug: created.slug,
        skipped,
      },
      plan: plan as unknown as Json,
      steps: steps as unknown as Json,
      deck_id: created.deckId,
    })
    .select("*")
    .single();
  if (insertError || !jobRow) {
    return { ok: false, error: "Couldn't persist the remix job." };
  }
  return {
    ok: true,
    job: jobRow as unknown as GenerationJobRow,
    deckSlug: created.slug,
  };
}


/**
 * Paint a card's art and PUBLISH it in one updateCardAction call — through
 * the action (never a raw table update) so validation runs and the Satori
 * bake fires for the now-public card. Cards are created private, then go
 * public together with their art; a failed image leaves a private draft
 * the retry re-paints. AI output defaults to public (owner decision,
 * 2026-07-10).
 */
async function paintAndPublishCard(
  cardId: string,
  prompts: readonly string[],
  shape: ArtShape,
): Promise<{ ok: true } | { ok: false; error: string; failure: AiFailureKind }> {
  // Painted in the shape of the card's own art window (TODO 4.48b).
  const image = await generateImageWithFallbacks(prompts, shape);
  if (!image.ok) return { ok: false, error: image.error, failure: image.failure };

  const persisted = await persistGeneratedArt(image.bytes, image.contentType);
  if (!persisted.ok) return { ok: false, error: AI_FAILURE_COPY.art_store, failure: "art_store" };

  const updated = await updateCardAction(cardId, {
    art_url: persisted.publicUrl,
    // The automatic fit (TODO 3b.18): the picture fills the frame's window,
    // centred — whatever frame the plan picked.
    art_position: fitArtToWindow(),
    visibility: "public",
  });
  if (!updated.ok) {
    const detail =
      updated.formError ??
      Object.values(updated.fieldErrors ?? {})[0] ??
      "Couldn't attach the art.";
    return { ok: false, error: detail, failure: "save_failed" };
  }
  return { ok: true };
}

function createFailureMessage(result: Extract<CreateCardResult, { ok: false }>): string {
  return (
    result.formError ??
    Object.values(result.fieldErrors ?? {})[0] ??
    "Card creation failed."
  );
}

/** Point the freshly-membered deck entry at the right board/quantity (the
 *  create flow always inserts board=main ×1). */
async function setDeckEntryDetails(
  deckId: string,
  cardId: string,
  board: string,
  quantity: number,
): Promise<void> {
  if (board === "main" && quantity === 1) return;
  const supabase = await createClient();
  await supabase
    .from("deck_cards")
    .update({ board, quantity })
    .eq("deck_id", deckId)
    .eq("card_id", cardId);
}

function deckArtPrompt(plan: DeckJobPlan, card: DesignedCard): string {
  const style = plan.style?.trim()
    ? `Rendered strictly in ${plan.style.trim()} style.`
    : "Painterly high-fantasy illustration style.";
  return [
    `Fantasy trading-card illustration for the deck "${plan.deck_title}".`,
    style,
    "One cohesive deck: consistent rendering technique, palette, and lighting across all cards.",
    card.art_prompt,
    "NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.",
  ].join(" ");
}

/** One card of a DECK job — the shared card step linked into the deck, with
 *  the commander slot forced Legendary and pointed at the right board. */
async function runDeckCardStep(
  userId: string,
  job: GenerationJobRow,
  step: JobStep,
  plan: DeckJobPlan,
  cardIndex: number,
): Promise<JobStep> {
  const card = plan.cards[cardIndex];
  // Commander slot: force the Legendary supertype the frame renders — added
  // to whatever words the design gave it (a "Snow" commander was saved
  // non-legendary when only an EMPTY supertype got the word).
  const isCommander = plan.roles[cardIndex] === "commander";
  const supertype = isCommander
    ? withSupertypeWord(card.supertype, "Legendary")
    : card.supertype ?? undefined;
  // The card's FRAME (owner 2026-10-14): before, a deck card saved none and
  // every one drew the default creature frame — a land, an artifact too.
  // It lands as a single generated card lands (resolveGeneratedFrame, the
  // same verified set and dresses), asked for its type's M15 standard
  // (deckCardFrameRequest). Resolved here, not at plan time, so the stored
  // plan is what it was; a card already created (a retried step) is never
  // re-framed. Where that frame (or its dress) isn't published in the
  // card's colour, no template — the default frame, as before — never a
  // random other era or showcase (owner 2026-10-14). A saga, a snow card and
  // a token follow their own looks where verified (resolveDeckCardFrame:
  // the saga frame, the snow frames, a new token's full-art design).
  const frameTemplate = step.card_id
    ? null
    : resolveDeckCardFrame({
        cardType: card.card_type,
        colorIdentity: card.color_identity,
        verifiedKeys: new Set(await getVerifiedFrameKeys()),
        face: {
          cardType: card.card_type,
          supertype,
          subtypes: card.subtypes,
          title: card.title,
          rulesText: card.rules_text,
          flavorText: card.flavor_text,
          power: card.power,
          toughness: card.toughness,
        },
      });
  return runGeneratedCardStep(userId, job.id, step, {
    reason: "generate_deck",
    artLogAction: "generate_deck_cards",
    card,
    artPrompt: deckArtPrompt(plan, card),
    style: plan.style,
    createExtras: {
      supertype,
      deck_id: job.deck_id ?? undefined,
      frame_style: frameTemplate ? { template: frameTemplate } : undefined,
    },
    afterCreate: async (cardId) => {
      if (job.deck_id) {
        await setDeckEntryDetails(
          job.deck_id,
          cardId,
          isCommander ? "commander" : "main",
          plan.quantities[cardIndex] ?? 1,
        );
      }
    },
  });
}

/** The step error of a remix whose renamed text no longer has its source's
 *  tiers (a station card: Spacecraft, Planets). */
export const REMIX_STATION_SHAPE_LOST =
  "The new name changed this card's tiers — retry this card.";

async function runDeckRemixStep(
  userId: string,
  job: GenerationJobRow,
  step: JobStep,
  plan: DeckRemixJobPlan,
  entry: DeckRemixPlanEntry,
): Promise<JobStep> {
  // Retry after a partial failure: the card exists, only art might be
  // missing — runDeckRemixStep regenerates nothing that already succeeded.
  if (step.card_id) {
    return { ...step, status: "done", error: undefined };
  }

  // An EMBLEM is not remixed (owner 2026-10-13). A new plan has no step for
  // one; an older plan's step is refused here — before the reserve, so no
  // ledger row is written, and before any AI call.
  if (entry.card_id && isEmblemRemixSource(await getCardById(entry.card_id))) {
    return { ...step, status: "failed", error: REMIX_EMBLEM_LEFT_OUT, spend_ref: null };
  }

  // A failed remix step carries no card_id, so its retry reruns the whole
  // pipeline; the credit wrapper refunds every failed attempt. A
  // double-faced entry reserves its two credits (the plan's, TODO 5.4) —
  // one charge, one ledger ref, settled with the step (migration 0106).
  return withCreditedStep(userId, job.id, remixEntryCredits(entry), "generate_deck", step, () =>
    executeDeckRemixStep(userId, job, step, plan, entry),
  );
}

/** The credits a remix plan entry reserves: its priced amount, else one. */
function remixEntryCredits(entry: Pick<DeckRemixPlanEntry, "credits">): number {
  return entry.credits !== undefined && entry.credits > 1 ? entry.credits : 1;
}

async function executeDeckRemixStep(
  userId: string,
  job: GenerationJobRow,
  step: JobStep,
  plan: DeckRemixJobPlan,
  entry: DeckRemixPlanEntry,
): Promise<JobStep> {
  // ---- Source mechanics ----
  type Mechanics = {
    title: string;
    cost?: string;
    card_type?: string;
    supertype?: string;
    subtypes: string[];
    rarity?: string;
    color_identity?: string[];
    rules_text?: string;
    flavor_text?: string;
    power?: string;
    toughness?: string;
    loyalty?: string;
    defense?: string;
    parent_card_id?: string;
    source_scryfall_id?: string;
    frame_template?: string;
    /** The crown / two-colour switches: a Scryfall entry's printing's
     *  (importedAnatomy); an own card's EXPLICIT ones (storedAnatomyOf — the
     *  creator's remix keeps them too), so a parent switched off stays off.
     *  A switch nobody set gets the new-card default (createCardAction). */
    anatomy?: FrameAnatomyStyle;
    /** A layout frame's second half (TODO 1.22) or a double-faced body's
     *  back face — a Scryfall entry's printing's, or an own card's where
     *  its frame is kept (ownCardRemixFrame). */
    back_face?: CardBackFace;
    /** Where the card saves instead when it saves with text and its frame
     *  draws none (TODO 1.24, remixSavedFrame): a printing's registry
     *  stand-in; an own token's 2014–19 arch, else `null` for an own card
     *  = the default landing (no template), as it landed before its frame
     *  was kept (ownCardTextStandIn); absent = none, the landing stands. */
    text_stand_in?: FrameTemplate | null;
    /** A pinned tall-box printing on the arch's tall box (TODO 4.55): the
     *  remix keeps the printed height (remixSavedFrame). */
    printed_height?: true;
    /** An own STATION card's "power / toughness on this tier" choice where
     *  its rows say more than its text (stationPtChoiceOf) — the remix
     *  keeps the plate where its maker put it (TODO 4.27a, PR 3). */
    station_pt_tier?: number | null;
    art_url?: string | null;
  };
  let mechanics: Mechanics;

  if (entry.card_id) {
    const source = await getCardById(entry.card_id);
    if (!source) {
      return { ...step, status: "failed", error: "Source card is gone." };
    }
    // The source's frame travels (owner 2026-10-13) where the save's own
    // gates pass it — published in the card's colour, right for the kind,
    // a double-faced body with its back's body verified too — else the
    // card lands as before (no template). ownCardRemixFrame is what the
    // estimate priced the entry with; a one-credit entry stays one-faced.
    const doubleFacedPlan = remixEntryCredits(entry) >= DFC_REMIX_CREDITS;
    const ownVerifiedKeys = new Set(await getVerifiedFrameKeys());
    const kept = ownCardRemixFrame(source, ownVerifiedKeys, {
      singleFace: !doubleFacedPlan,
    });
    // Two credits were reserved for both faces: bodies withdrawn since are
    // refused rather than charged two for one picture (refunded).
    if (doubleFacedPlan && remixCreditsOf(kept) < DFC_REMIX_CREDITS) {
      return { ...step, status: "failed", error: REMIX_DFC_FRAMES_GONE };
    }
    mechanics = {
      title: source.title,
      cost: source.cost ?? undefined,
      card_type: source.card_type ?? undefined,
      supertype: source.supertype ?? undefined,
      subtypes: source.subtypes ?? [],
      rarity: source.rarity ?? undefined,
      color_identity: source.color_identity,
      rules_text: ownCardRulesText(source),
      flavor_text: source.flavor_text ?? undefined,
      power: source.power ?? undefined,
      toughness: source.toughness ?? undefined,
      loyalty: source.loyalty ?? undefined,
      defense: source.defense ?? undefined,
      parent_card_id: source.id,
      art_url: source.art_url,
      // (Each part in its own colour OFF where a part's colour isn't
      // verified on the kept frame — TODO 4.26, M1.)
      anatomy: kept.part_color_off ? { ...storedAnatomyOf(source.frame_style), partColor: false } : storedAnatomyOf(source.frame_style),
      frame_template: kept.frame_template,
      back_face: kept.back_face,
      text_stand_in: ownCardTextStandIn(source, ownVerifiedKeys),
      ...(isStationFrame(kept.frame_template)
        ? { station_pt_tier: stationPtChoiceOf(source.rules_text, source.face_content) }
        : {}),
    };
  } else if (entry.scryfall_id) {
    const scry = await getScryfallCardById(entry.scryfall_id);
    if (!scry) {
      return { ...step, status: "failed", error: "Couldn't resolve the printing." };
    }
    // The frame resolves like the creator import (TODO 1.22): the
    // printing's frame when it is published in the card's colour, else its
    // card type's standard; a layout kind on its layout template with the
    // printed card type. Nothing published in the colour fails the step
    // plainly, before any credit-costing art is generated. A double-faced
    // printing keeps its back face only when the plan priced it (two
    // credits, TODO 5.4); a one-credit entry is remixed one-faced.
    const doubleFacedPlan = remixEntryCredits(entry) >= DFC_REMIX_CREDITS;
    const resolved = scryfallRemixMechanics(
      // Oracle's own rules (TODO 6.2): the remix renames them itself.
      mapScryfallToFormPatch(scry, { oracleRules: true }),
      entry.name,
      new Set(await getVerifiedFrameKeys()),
      { singleFace: !doubleFacedPlan },
    );
    if (!resolved.ok) {
      return { ...step, status: "failed", error: resolved.error };
    }
    // A printed emblem an older plan still carries (a new plan leaves it
    // out): refused before any AI call — the wrapper hands the credit back.
    if (isEmblemRemixSource(resolved.mechanics)) {
      return { ...step, status: "failed", error: REMIX_EMBLEM_LEFT_OUT };
    }
    // The plan reserved two credits for both faces: a landing that lost
    // its bodies since (a tick withdrawn) is refused rather than charged
    // two for one picture — the wrapper refunds it.
    if (doubleFacedPlan && remixCreditsOf(resolved.mechanics) < DFC_REMIX_CREDITS) {
      return { ...step, status: "failed", error: REMIX_DFC_FRAMES_GONE };
    }
    mechanics = {
      ...resolved.mechanics,
      // Real-card art is NEVER restyled — we don't touch the scan. Fresh
      // art is generated from the identity's text description instead.
      art_url: null,
    };
  } else {
    return { ...step, status: "failed", error: "Entry has no source card." };
  }

  // ---- New identity (mechanics untouched) ----
  // A two-part layout card is renamed on BOTH halves in the same call
  // (owner decision B3, 2026-09-29): the second half rides along only when
  // the landed frame paints it (scryfallRemixMechanics).
  let identity;
  try {
    identity = await generateRemixIdentity({
      card: {
        title: mechanics.title,
        cost: mechanics.cost ?? null,
        card_type: (mechanics.card_type ?? "creature") as never,
        supertype: mechanics.supertype ?? null,
        subtypes: mechanics.subtypes,
        rules_text: mechanics.rules_text ?? null,
        flavor_text: mechanics.flavor_text ?? null,
        power: mechanics.power ?? null,
        toughness: mechanics.toughness ?? null,
      },
      secondHalf: mechanics.back_face
        ? {
            layout: remixSecondHalfLayout(mechanics.frame_template),
            face: mechanics.back_face,
          }
        : null,
      style: plan.style,
      theme: plan.theme ?? undefined,
    });
  } catch (error) {
    // The identity call's raw error goes to the log; the step says what
    // kind of failure it was (lib/ai/failure.ts).
    const failed = planDesignFailure(error, `deck_remix step ${step.key}`);
    return { ...step, status: "failed", error: AI_FAILURE_COPY[failed.code], failure: failed.code };
  }
  // The new names on the card: the rules text follows them (no source name
  // left on a renamed card), and a second half without a new name fails
  // here — before the art is paid for.
  const named = applyRemixNames(mechanics, identity);
  if (!named.ok) {
    return { ...step, status: "failed", error: named.error };
  }

  // An own card's kept frame is judged again on the card as it SAVES: the
  // kind gate reads the name (a basic-only frame: "Wastes" renamed is no
  // basic land), so a frame the new name no longer fits falls back to the
  // default landing here — never a refused save after the art. Only a
  // one-faced frame can be refused by a name.
  if (
    entry.card_id &&
    mechanics.frame_template &&
    !mechanics.back_face &&
    frameKindGateError(
      mechanics.frame_template,
      cardFieldsFace({
        card_type: mechanics.card_type,
        supertype: mechanics.supertype,
        subtypes: mechanics.subtypes,
        title: named.title,
        rules_text: named.rules_text,
      }),
    ) !== null
  ) {
    mechanics = { ...mechanics, frame_template: undefined };
  }

  // A remix that lands on a STATION frame (TODO 4.27a, PR 3) keeps its
  // source's tiers: the rules are copied, only the card's names in them
  // change. A new name that made or unmade a tier line (an own card whose
  // title is a tier's number: "9" in "9+ | Flying") fails the step HERE —
  // before the art is paid for, like every other naming refusal — and the
  // wrapper refunds it. (The landing is final as far as the station frame
  // goes: remixSavedFrame below only ever moves a token or a textless
  // frame.)
  if (isStationFrame(mechanics.frame_template) && !sameStationShape(mechanics.rules_text, named.rules_text)) {
    return { ...step, status: "failed", error: REMIX_STATION_SHAPE_LOST };
  }

  // ---- The frames the card SAVES on, decided BEFORE any art (owner Round
  //      78): the front's (remixSavedFrame) and a double-sided token's back
  //      under it — a back that can't follow a stand-in keeps the pair on
  //      its landing; one that can't be saved at all fails the step here,
  //      refunded, never after two pictures are paid for. ----
  // The printing's frame followed its PRINTED text; the remix saves the AI's
  // flavour, so a token's text box follows the text it saves with (TODO 4.49
  // (b), owner decision 5) — the creator's and the other AI jobs' rule.
  // And no remix saves a text on a frame that draws none (TODO 1.24): a
  // `textless` landing gives way to its stand-in when the card saves with
  // rules or flavour text, and stands when it saves with none
  // (remixSavedFrame — one rule for a printing and an own card).
  const savedFrames = mechanics.frame_template
    ? remixSavedFrames({
        standIn: mechanics.text_stand_in,
        printedHeight: mechanics.printed_height === true,
        template: mechanics.frame_template as FrameTemplate,
        cardType: mechanics.card_type as CardType | undefined,
        supertype: mechanics.supertype,
        subtypes: mechanics.subtypes,
        rulesText: named.rules_text,
        flavorText: identity.flavor_text,
        power: mechanics.power,
        toughness: mechanics.toughness,
        colorIdentity: (mechanics.color_identity ?? ["colorless"]) as ColorIdentity[],
        verifiedKeys: new Set(await getVerifiedFrameKeys()),
        back: named.back_face ?? null,
      })
    : ({ ok: true, template: undefined } as const);
  if (!savedFrames.ok) {
    return { ...step, status: "failed", error: REMIX_DFC_FRAMES_GONE };
  }
  const frameTemplate = savedFrames.template;
  // The fresh pictures' shapes (TODO 4.48b): the windows of the frames the
  // card SAVES on, decided just above — the front's, and a double-faced
  // back's own body (else the front's). The restyle keeps its source's.
  const frontArtFace: ArtFace = {
    template: frameTemplate ?? null,
    colorIdentity: mechanics.color_identity ?? ["colorless"],
    cardType: mechanics.card_type ?? null,
    supertype: mechanics.supertype ?? null,
    cost: mechanics.cost ?? null,
    style: mechanics.anatomy ?? null,
  };

  // ---- Art (REQUIRED — a remix is the art; failures fail the step so the
  //      user can retry, rather than silently shipping the old artwork) ----
  await logAiCall(userId, "remix_art");
  let artUrl: string | undefined;
  let artError: string | null = null;
  if (mechanics.art_url && isAllowedServerImageFetchUrl(mechanics.art_url)) {
    try {
      const sourceResponse = await fetch(mechanics.art_url, {
        signal: AbortSignal.timeout(SOURCE_ART_FETCH_TIMEOUT_MS),
      });
      if (sourceResponse.ok) {
        const contentType =
          sourceResponse.headers.get("content-type") ?? "image/png";
        const restyled = await restyleImage({
          source: new Uint8Array(await sourceResponse.arrayBuffer()),
          sourceContentType: contentType,
          prompt: `Re-render this artwork in ${plan.style} style. ${identity.art_instruction}`,
          timeoutMs: REMIX_IMAGE_TIMEOUT_MS,
        });
        if (restyled.ok) {
          const persisted = await persistGeneratedArt(
            restyled.bytes,
            restyled.contentType,
          );
          if (persisted.ok) artUrl = persisted.publicUrl;
          else artError = AI_FAILURE_COPY.art_store;
        } else {
          artError = restyled.error;
        }
      }
    } catch {
      // fall through to fresh generation below
    }
  }
  if (!artUrl) {
    const generated = await generatePlainImage(
      `${identity.art_instruction} Style: ${plan.style}.`,
      artShapeForFace(frontArtFace),
      { timeoutMs: REMIX_IMAGE_TIMEOUT_MS },
    );
    if (generated.ok) {
      const persisted = await persistGeneratedArt(
        generated.bytes,
        generated.contentType,
      );
      if (persisted.ok) artUrl = persisted.publicUrl;
      else artError = AI_FAILURE_COPY.art_store;
    } else {
      artError = generated.error;
    }
  }
  if (!artUrl) {
    return {
      ...step,
      status: "failed",
      error: artError ?? "Art generation failed — retry this card.",
    };
  }

  // ---- The back face's own picture (TODO 5.4, owner Q4: two credits) ----
  // A double-faced landing paints its back from the identity's second
  // instruction; a back without art would save private (the gate's
  // both-arts rule), so a failed second picture fails the step — and the
  // wrapper refunds both credits.
  let backArtUrl: string | undefined;
  // (…and a double-sided token's back — TODO 5.5 (c) — the same.)
  if (named.back_face && mechanics.frame_template && templateTakesBackBody(mechanics.frame_template)) {
    const instruction = identity.second_art_instruction?.trim() || identity.art_instruction;
    const generated = await generatePlainImage(
      `${instruction} Style: ${plan.style}.`,
      artShapeForBackFace(frontArtFace, named.back_face),
      { timeoutMs: REMIX_IMAGE_TIMEOUT_MS },
    );
    if (generated.ok) {
      const persisted = await persistGeneratedArt(generated.bytes, generated.contentType);
      if (persisted.ok) backArtUrl = persisted.publicUrl;
      else artError = AI_FAILURE_COPY.art_store;
    } else {
      artError = generated.error;
    }
    if (!backArtUrl) {
      return {
        ...step,
        status: "failed",
        error: artError ?? "The back face's art generation failed — retry this card.",
      };
    }
  }

  // ---- Create the remixed custom card, linked into the new deck ----
  // (Its frames were decided before the art: remixSavedFrames above.)
  // A remix that lands on a STATION frame (TODO 4.27a, PR 3) keeps its
  // source's tiers — the rules are copied, only the card's names in them
  // change — and saves them as the creator saves a new card: the canonical
  // text beside `face_content.station`, the P/T on the tier the text plates,
  // or on the tier the maker of an own card chose. (A new name that made or
  // unmade a tier line failed the step above, before the art.) Null off the
  // frame: the payload is unchanged.
  const station = stationSaveFields({
    template: frameTemplate,
    rulesText: named.rules_text,
    hasPt: printsPowerToughness({
      cardType: mechanics.card_type as CardType | undefined,
      supertype: mechanics.supertype,
      subtypes: mechanics.subtypes,
      power: mechanics.power,
      toughness: mechanics.toughness,
    }),
    ptTier: mechanics.station_pt_tier,
  });
  const gameSystemId = await activeGameSystemId();
  if (!gameSystemId) {
    return { ...step, status: "failed", error: "No game system configured." };
  }
  const result = await createCardAction(
    {
      title: named.title,
      game_system_id: gameSystemId,
      cost: mechanics.cost,
      color_identity: (mechanics.color_identity ?? ["colorless"]) as never,
      supertype: mechanics.supertype,
      card_type: mechanics.card_type as never,
      subtypes: mechanics.subtypes,
      rarity: mechanics.rarity as never,
      rules_text: named.rules_text,
      ...(station ?? {}),
      flavor_text: identity.flavor_text ?? undefined,
      power: mechanics.power,
      toughness: mechanics.toughness,
      loyalty: mechanics.loyalty,
      defense: mechanics.defense,
      art_url: artUrl,
      // The printing's own crown / two-colour switches (importedAnatomy), or
      // an own card's explicit ones — with its template where the frame is
      // kept (ownCardRemixFrame), else none: the default frame, as before;
      // createCardAction stamps the new-card default for a switch nobody set
      // and keeps only what the frame draws.
      frame_style: frameTemplate
        ? { template: frameTemplate, ...mechanics.anatomy }
        : mechanics.anatomy && Object.keys(mechanics.anatomy).length > 0
          ? { ...mechanics.anatomy }
          : undefined,
      // A double-faced back carries its own picture (above); a two-part
      // layout's half has none (the frame paints it from its text).
      back_face: named.back_face
        ? { ...named.back_face, ...(backArtUrl ? { art_url: backArtUrl } : {}) }
        : named.back_face,
      parent_card_id: mechanics.parent_card_id,
      source_scryfall_id: mechanics.source_scryfall_id,
      // Art is guaranteed above; remixed cards ship public like the deck.
      visibility: "public",
      artist_credit: await aiArtistCredit(),
      deck_id: job.deck_id ?? undefined,
    },
    { redirectAfterCreate: false },
  );
  if (!result.ok) {
    return { ...step, status: "failed", error: createFailureMessage(result) };
  }

  if (job.deck_id) {
    await setDeckEntryDetails(
      job.deck_id,
      result.cardId,
      entry.board,
      entry.quantity,
    );
  }

  return {
    ...step,
    status: "done",
    card_id: result.cardId,
    label: named.back_face
      ? `${named.title} // ${named.back_face.title}`
      : named.title,
    error: undefined,
  };
}

/** The single active game system every AI-generated card is created under.
 *  Null when none is configured — callers must fail the step, not create. */
async function activeGameSystemId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("game_systems")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/** Wide key-art prompt for the deck cover tile. */
function coverPrompt(job: GenerationJobRow): { prompt: string; aspect: ImageAspect } {
  let title = "the collection";
  let subject = "";
  let style: string | null = null;
  if (job.kind === "deck") {
    const plan = job.plan as DeckJobPlan;
    title = plan.deck_title;
    subject = `${plan.theme}. ${plan.strategy}`;
    style = plan.style;
  } else {
    const plan = job.plan as DeckRemixJobPlan;
    title = plan.deck_title;
    subject = plan.theme ?? "the deck's world, re-imagined";
    style = plan.style;
  }
  const styleLine = style?.trim()
    ? `Rendered strictly in ${style.trim()} style.`
    : "Painterly high-fantasy illustration style.";
  return {
    // Every deck-cover surface is a 16:9 box (lib/decks/cover.ts), so the
    // cover is generated "wide" and needs no crop.
    aspect: "wide",
    prompt: [
      `Wide cinematic key art for a trading-card collection called "${title}".`,
      subject.slice(0, 400),
      styleLine,
      "Epic establishing-shot composition, 16:9, with the focal point near the center of the frame and nothing important touching the edges.",
      "NO frame, NO borders, NO logo, NO text or lettering anywhere in the image.",
    ].join(" "),
  };
}

/** Generate + attach the deck cover image. The cover is FREE (owner
 *  decision, 2026-09-15): no credit is reserved or charged for it — only
 *  the cards cost credits. Deck covers are normalised to the 16:9 standard
 *  (lib/decks/cover.ts) before upload so every surface shows the same image. */
async function runCoverStep(
  userId: string,
  job: GenerationJobRow,
  step: JobStep,
): Promise<JobStep> {
  await logAiCall(userId, "generate_deck_cards");
  {
    const { prompt, aspect } = coverPrompt(job);
    const image = await generateImageWithFallbacks([prompt, softenArtPrompt(prompt)], aspect);
    if (!image.ok) {
      return { ...step, status: "failed", error: image.error, failure: image.failure };
    }
    let bytes: Uint8Array = image.bytes;
    let contentType = image.contentType;
    try {
      const normalized = await normalizeDeckCover(image.bytes);
      bytes = normalized.bytes;
      contentType = normalized.contentType;
    } catch (err) {
      console.warn(`[cover] normalise failed for job ${job.id}:`, err instanceof Error ? err.message : err);
    }
    const persisted = await persistGeneratedArt(bytes, contentType);
    if (!persisted.ok) {
      return { ...step, status: "failed", error: AI_FAILURE_COPY.art_store, failure: "art_store" };
    }

    if (job.deck_id) {
      const updated = await updateDeckAction(job.deck_id, {
        cover_url: persisted.publicUrl,
        // Already 16:9 — a centred focal point means zero crop everywhere.
        cover_position: { focalX: 0.5, focalY: 0.5 },
      });
      if (!updated.ok) {
        return { ...step, status: "failed", error: "Couldn't attach the deck cover." };
      }
      return { ...step, status: "done", error: undefined };
    }
    return { ...step, status: "failed", error: "Job has no deck to cover." };
  }
}

/** The free guide step: reads the finished deck and stores its primer.
 *  Never charged; a failure is retryable like any other step. */
async function runGuideStep(job: GenerationJobRow, step: JobStep): Promise<JobStep> {
  if (!job.deck_id) return { ...step, status: "failed", error: "Job has no deck to describe." };
  const result = await buildAndStoreDeckGuide(job.deck_id, "generation");
  if (!result.ok) return { ...step, status: "failed", error: result.error };
  return { ...step, status: "done", error: undefined };
}


/** Atomically merge ONE step's result into the job's steps array and recompute
 *  the job status, via the row-locking patch_job_step RPC (migration 0065).
 *  Safe under parallel step requests — each patches a distinct step key on the
 *  freshly-committed value instead of writing the whole array last-write-wins. */
async function patchJobStep(
  jobId: string,
  step: JobStep,
): Promise<RunStepResult> {
  // Service role (see claimJobStep): the step's done-write is what settles
  // its charge (patch_job_step → settle_spend, migration 0106), so it must
  // be written by the server, never by a client-controlled row update.
  const supabase = createAdminClient();
  // Normalize optional fields to null so the jsonb merge CLEARS a prior value
  // (e.g. a failed→done retry must drop the old error) — JSON drops `undefined`.
  const patch = {
    key: step.key,
    label: step.label,
    status: step.status,
    card_id: step.card_id ?? null,
    error: step.error ?? null,
    error_code: step.error_code ?? null,
    // Which charge attempt completed the step — patch_job_step settles it
    // atomically with this write. null clears a stale ref from a prior
    // attempt (and settles nothing).
    spend_ref: step.spend_ref ?? null,
    // card_fill: the generated fields ride on the step (the plan is never
    // sent to the client). null keeps the key explicit for other kinds.
    fill: step.fill ?? null,
    attempts: step.attempts ?? null,
    // Why a failed attempt failed and what its credit did (lib/ai/failure.ts)
    // — null on a done step, so a retry that succeeds clears them.
    failure: step.status === "failed" ? (step.failure ?? null) : null,
    refunded: step.status === "failed" ? (step.refunded ?? null) : null,
    refund_pending: step.status === "failed" ? (step.refund_pending ?? null) : null,
    // The step is no longer running — drop the claim stamp.
    claimed_at: null,
  };
  // The work (credit spend, card insert, image) is already committed by the
  // time we get here — losing this write means a stale reclaim would re-run
  // the whole step. The patch is a cheap row-locked RPC, so retry it a couple
  // of times before giving up rather than strand a finished step "running".
  let lastDetail: string | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
    const { data, error } = await supabase.rpc("patch_job_step", {
      p_job_id: jobId,
      p_step_key: step.key,
      p_patch: patch,
    });
    if (!error && data) {
      return { ok: true, job: data as unknown as GenerationJobRow };
    }
    lastDetail = error?.message ?? "no row returned";
  }
  // Loud: the step's work is committed but its result isn't recorded — a
  // stale reclaim will re-run it, so this needs to be findable in logs.
  console.error(
    `[ai-jobs] patch_job_step failed after 3 attempts (job ${jobId}, step ${step.key}, status ${step.status}): ${lastDetail}`,
  );
  return { ok: false, error: "Couldn't persist step progress." };
}

/** The deck's latest finished job that still has failed steps — powers the
 *  owner's "Regenerate N cards" bar on the deck page. Owner-scoped (RLS). */
/** A deck's job that is still generating (open steps) — what the deck page
 *  shows as live progress and offers to resume after a reload. */
export async function getActiveDeckJob(
  deckId: string,
): Promise<{ jobId: string; done: number; total: number } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_generation_jobs")
    .select("id, status, steps")
    .eq("deck_id", deckId)
    .in("kind", ["deck", "deck_remix"])
    .eq("status", "generating")
    .gt("updated_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const steps = (data.steps ?? []) as JobStep[];
  if (!steps.some((s) => s.status === "pending" || s.status === "running")) return null;
  return {
    jobId: data.id,
    done: steps.filter((s) => s.status === "done" || s.status === "failed").length,
    total: steps.length,
  };
}

export async function getLatestFailedDeckJob(
  deckId: string,
): Promise<{ jobId: string; failedCount: number; failedLabels: string[] } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_generation_jobs")
    .select("id, status, steps")
    .eq("deck_id", deckId)
    .in("kind", ["deck", "deck_remix"])
    .in("status", ["done_with_errors", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const steps = (data.steps ?? []) as JobStep[];
  const failed = steps.filter((s) => s.status === "failed");
  if (failed.length === 0) return null;
  return { jobId: data.id, failedCount: failed.length, failedLabels: failed.map((s) => s.label) };
}
