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
  resolveGeneratedFrame,
} from "@/lib/creator/frame-random";
import type {
  CardType,
  ColorIdentity,
  FrameTemplate,
  Rarity,
} from "@/types/card";
import type { DesignedCard } from "@/lib/ai/card-design";
import { getCardById as getScryfallCardById } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import type { DeckFormat } from "@/types/deck";
import { withCreditedStep } from "@/lib/ai/credited-step";
import { getCardCapacity } from "@/lib/cards/capacity";
import { describeCapacity, remainingCapacity } from "@/lib/billing/capacity-copy";

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
  /** Deck-aware design (Pro): the client links the card to this deck. */
  deck_id: string | null;
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
    const detail =
      error instanceof Error ? error.message : "Generation step crashed.";
    result = { ...step, status: "failed", error: detail };
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

      const result = await createCardAction(
        {
          title: card.title,
          game_system_id: gameSystemId,
          cost: card.cost ?? undefined,
          color_identity: card.color_identity,
          supertype: card.supertype ?? undefined,
          card_type: card.card_type,
          subtypes: card.subtypes,
          rarity: card.rarity,
          rules_text: card.rules_text ?? undefined,
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
          // The DB trigger (migration 0104) can still say no when parallel
          // steps race for the last slot — same code, same client handling.
          error_code: result.reason === "capacity" ? "CARD_CAPACITY" : undefined,
        };
      }
      cardId = result.cardId;
      await config.afterCreate?.(cardId);
    }

    await logAiCall(userId, config.artLogAction);
    // Every run rewords the art prompt (moderation refuses identical text),
    // and a refusal walks straight to the next rung inside this step.
    const attempt = (step.attempts ?? 0) + 1;
    const published = await paintAndPublishCard(
      cardId,
      artPromptLadder(attempt, config.artPrompt, fallbackInputsFor(card, config.style)),
    );
    if (!published.ok) {
      return { ...step, status: "failed", card_id: cardId, attempts: attempt, error: published.error };
    }
    return { ...step, status: "done", card_id: cardId, attempts: attempt, error: undefined };
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
  | { ok: false; error: string };

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
  let card: DesignedCard;
  try {
    card = await generateRandomCard({
      theme: input.theme,
      style: input.style,
      cardType: input.cardType,
      rarity: input.rarity,
      colorHint,
      context: deckBrief?.context,
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Card generation failed.";
    return { ok: false, error: `AI card design failed: ${detail}` };
  }

  const frameTemplate = resolveGeneratedFrame({
    cardType: card.card_type,
    requested: input.frame,
    colorIdentity: card.color_identity,
    verifiedKeys,
    face: {
      cardType: card.card_type,
      supertype: card.supertype,
      subtypes: card.subtypes,
      title: card.title,
      rulesText: card.rules_text,
    },
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
  /** Pro: brief the designer with this deck. */
  deckId?: string;
  /** The creator this fill belongs to — see app/api/ai/card-fill. */
  scope?: string;
};

/** PLAN a fill job: design the wanted fields around the pinned ones (fast
 *  text call); the step paints the art if it was wanted. Same 1-credit
 *  price whatever was ticked — charged by the step, refunded on failure. */
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
  let colorHint: ColorIdentity | undefined = deckBrief?.colorHint;
  if (wantsType && input.frame && input.frame !== "random" && input.steer.card_type) {
    const hints = colorHintsForFrame(input.steer.card_type, input.frame, verifiedKeys);
    if (hints.length > 0) {
      colorHint = hints[Math.floor(Math.random() * hints.length)];
    }
  }

  await logAiCall(user.id, "fill_card");
  let designed: Awaited<ReturnType<typeof designCardFill>>;
  try {
    designed = await designCardFill({
      want: input.want,
      locked: input.locked,
      steer: input.steer,
      theme: input.theme,
      style: input.style,
      context: deckBrief?.context,
      colorHint,
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Card generation failed.";
    return { ok: false, error: `AI card design failed: ${detail}` };
  }

  // A generated card type needs a frame that can wear it (create only —
  // revise never asks for the type). Colors: generated ones, else pinned.
  const frameTemplate =
    wantsType && designed.fields.card_type
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
          },
        })
      : null;

  const plan: CardFillJobPlan = {
    want: input.want,
    fields: designed.fields,
    art_prompt: designed.art_prompt,
    style: input.style?.trim() || null,
    frame_template: frameTemplate ?? null,
    deck_id: deckContext?.deck.id ?? null,
  };
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
      await logAiCall(userId, "generate_random_art");
      const image = await generateImageWithFallbacks(
        artPromptLadder(
          attempt,
          `${plan.art_prompt}${style} NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.`,
          {
            title: plan.fields.title ?? step.label,
            typeLine: plan.fields.card_type ?? null,
            colors: plan.fields.color_identity ?? null,
            style: plan.style,
          },
        ),
        "card",
      );
      if (!image.ok) return { ...step, status: "failed", attempts: attempt, error: image.error };
      const persisted = await persistGeneratedArt(image.bytes, image.contentType);
      if (!persisted.ok) {
        return { ...step, status: "failed", error: persisted.error };
      }
      fill.art_url = persisted.publicUrl;
      fill.artist_credit = await aiArtistCredit();
    }
    return { ...step, status: "done", fill, attempts: attempt, error: undefined };
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
    const detail = error instanceof Error ? error.message : "Generation failed.";
    return { ok: false, error: `AI deck planning failed: ${detail}` };
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
  const remixable = items.filter(
    (item) => item.entry.card_id || item.entry.scryfall_id,
  );
  if (remixable.length === 0) {
    return {
      ok: false,
      error: "Nothing to remix — the deck has no resolved cards yet.",
    };
  }
  const taken = remixable.slice(0, input.limit);
  const skipped = remixable.length - taken.length;

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
    entries: taken.map((item) => ({
      board: item.entry.board,
      quantity: item.entry.quantity,
      name: item.entry.name,
      card_id: item.entry.card_id,
      scryfall_id: item.entry.scryfall_id,
    })),
    skipped,
  };
  const steps: JobStep[] = plan.entries.map((entry, index) => ({
    key: `remix:${index}`,
    label: entry.name,
    status: "pending" as const,
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  // "card" aspect matches the frame's art window — no manual repositioning.
  const image = await generateImageWithFallbacks(prompts, "card");
  if (!image.ok) return { ok: false, error: image.error };

  const persisted = await persistGeneratedArt(image.bytes, image.contentType);
  if (!persisted.ok) return { ok: false, error: persisted.error };

  const updated = await updateCardAction(cardId, {
    art_url: persisted.publicUrl,
    art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    visibility: "public",
  });
  if (!updated.ok) {
    const detail =
      updated.formError ??
      Object.values(updated.fieldErrors ?? {})[0] ??
      "Couldn't attach the art.";
    return { ok: false, error: detail };
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
  // Commander slot: force the Legendary supertype the frame renders.
  const isCommander = plan.roles[cardIndex] === "commander";
  return runGeneratedCardStep(userId, job.id, step, {
    reason: "generate_deck",
    artLogAction: "generate_deck_cards",
    card,
    artPrompt: deckArtPrompt(plan, card),
    style: plan.style,
    createExtras: {
      supertype: isCommander
        ? card.supertype || "Legendary"
        : card.supertype ?? undefined,
      deck_id: job.deck_id ?? undefined,
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

  // A failed remix step carries no card_id, so its retry reruns the whole
  // pipeline; the credit wrapper refunds every failed attempt.
  return withCreditedStep(userId, job.id, 1, "generate_deck", step, () =>
    executeDeckRemixStep(userId, job, step, plan, entry),
  );
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
    art_url?: string | null;
  };
  let mechanics: Mechanics;

  if (entry.card_id) {
    const source = await getCardById(entry.card_id);
    if (!source) {
      return { ...step, status: "failed", error: "Source card is gone." };
    }
    mechanics = {
      title: source.title,
      cost: source.cost ?? undefined,
      card_type: source.card_type ?? undefined,
      supertype: source.supertype ?? undefined,
      subtypes: source.subtypes ?? [],
      rarity: source.rarity ?? undefined,
      color_identity: source.color_identity,
      rules_text: source.rules_text ?? undefined,
      flavor_text: source.flavor_text ?? undefined,
      power: source.power ?? undefined,
      toughness: source.toughness ?? undefined,
      loyalty: source.loyalty ?? undefined,
      defense: source.defense ?? undefined,
      parent_card_id: source.id,
      art_url: source.art_url,
    };
  } else if (entry.scryfall_id) {
    const scry = await getScryfallCardById(entry.scryfall_id);
    if (!scry) {
      return { ...step, status: "failed", error: "Couldn't resolve the printing." };
    }
    const patch = mapScryfallToFormPatch(scry);
    mechanics = {
      title: patch.title ?? entry.name,
      cost: patch.cost,
      card_type: patch.card_type,
      supertype: patch.supertype,
      subtypes: (patch.subtypes_text ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      rarity: patch.rarity,
      color_identity: patch.color_identity,
      rules_text: patch.rules_text,
      flavor_text: patch.flavor_text,
      power: patch.power,
      toughness: patch.toughness,
      loyalty: patch.loyalty,
      defense: patch.defense,
      source_scryfall_id: patch.source_scryfall_id,
      frame_template: patch.frame_template,
      // Real-card art is NEVER restyled — we don't touch the scan. Fresh
      // art is generated from the identity's text description instead.
      art_url: null,
    };
  } else {
    return { ...step, status: "failed", error: "Entry has no source card." };
  }

  // ---- New identity (mechanics untouched) ----
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
      style: plan.style,
      theme: plan.theme ?? undefined,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Remix failed.";
    return { ...step, status: "failed", error: detail };
  }

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
          else artError = persisted.error;
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
      "card",
      { timeoutMs: REMIX_IMAGE_TIMEOUT_MS },
    );
    if (generated.ok) {
      const persisted = await persistGeneratedArt(
        generated.bytes,
        generated.contentType,
      );
      if (persisted.ok) artUrl = persisted.publicUrl;
      else artError = persisted.error;
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

  // ---- Create the remixed custom card, linked into the new deck ----
  const gameSystemId = await activeGameSystemId();
  if (!gameSystemId) {
    return { ...step, status: "failed", error: "No game system configured." };
  }
  const result = await createCardAction(
    {
      title: identity.title,
      game_system_id: gameSystemId,
      cost: mechanics.cost,
      color_identity: (mechanics.color_identity ?? ["colorless"]) as never,
      supertype: mechanics.supertype,
      card_type: mechanics.card_type as never,
      subtypes: mechanics.subtypes,
      rarity: mechanics.rarity as never,
      rules_text: mechanics.rules_text,
      flavor_text: identity.flavor_text ?? undefined,
      power: mechanics.power,
      toughness: mechanics.toughness,
      loyalty: mechanics.loyalty,
      defense: mechanics.defense,
      art_url: artUrl,
      frame_style: mechanics.frame_template
        ? { template: mechanics.frame_template }
        : undefined,
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
    label: identity.title,
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
      return { ...step, status: "failed", error: image.error };
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
      return { ...step, status: "failed", error: persisted.error };
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
