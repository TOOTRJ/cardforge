import "server-only";

import type { Json } from "@/types/supabase";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  createCardAction,
  updateCardAction,
  type CreateCardResult,
} from "@/lib/cards/actions";
import { getCardById } from "@/lib/cards/queries";
import { createSetAction, updateSetAction } from "@/lib/sets/actions";
import { createDeckAction, updateDeckAction } from "@/lib/decks/actions";
import { listDeckCards } from "@/lib/decks/queries";
import { generateSet } from "@/lib/ai/set-gen";
import {
  generateDeckPlan,
  type AiDeckFormat,
} from "@/lib/ai/deck-design";
import { generateRemixIdentity } from "@/lib/ai/remix";
import {
  generatePlainImage,
  restyleImage,
  type ImageAspect,
} from "@/lib/ai/image-gen";
import { persistGeneratedArt } from "@/lib/ai/random-art";
import { logAiCall, spendCredits } from "@/lib/ai/rate-limit";
import type { DesignedCard } from "@/lib/ai/card-design";
import { getCardById as getScryfallCardById } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";

// ---------------------------------------------------------------------------
// AI generation jobs — the batch pipeline behind "generate a whole set"
// (decks reuse the same table/step machinery in the deck PR).
//
// A job is a persisted plan the CLIENT advances one HTTP step at a time
// (there is no queue/worker in this stack; see migration 0059):
//
//   PLAN  (createSetGenerationJob): one concept call + ONE batched text
//         call for every card (single batch = cross-card cohesion), then
//         the target set is created/loaded and the job row written with
//         one step per card + an icon step.
//   STEP  (runNextJobStep): create one card (private → no bake) and paint
//         its art, or paint the set icon. Steps are retry-safe: a step that
//         already created its card only redoes the art.
//
// Credits: 1 per card, spent as each card step completes (same
// "generate_deck" ledger reason as the legacy route). Free when billing is
// disabled.
// ---------------------------------------------------------------------------

export type JobStepStatus = "pending" | "done" | "failed";

export type JobStep = {
  key: string;
  label: string;
  status: JobStepStatus;
  /** Set once the step's card row exists — retries then skip creation. */
  card_id?: string;
  error?: string;
};

export type GenerationJobRow = {
  id: string;
  owner_id: string;
  kind: "set" | "deck" | "deck_remix";
  status: "generating" | "done" | "failed" | "cancelled";
  request: Record<string, unknown>;
  plan: SetJobPlan | DeckJobPlan | DeckRemixJobPlan | null;
  steps: JobStep[];
  set_id: string | null;
  deck_id: string | null;
  error: string | null;
};

export type SetJobPlan = {
  set_title: string;
  set_description: string;
  theme: string;
  style: string | null;
  cards: DesignedCard[];
};

export type DeckJobPlan = {
  deck_title: string;
  strategy: string;
  theme: string;
  style: string | null;
  format: AiDeckFormat;
  cards: DesignedCard[];
  /** Parallel to cards: skeleton role + deck_cards quantity. */
  roles: string[];
  quantities: number[];
};

export type DeckRemixPlanEntry = {
  board: string;
  quantity: number;
  name: string;
  /** Custom-card source (image-to-image restyle allowed). */
  card_id: string | null;
  /** Real-card source — mechanics come from Scryfall oracle data; art is
   *  generated FRESH from a text description (never from the scan). */
  scryfall_id: string | null;
};

export type DeckRemixJobPlan = {
  deck_title: string;
  style: string;
  theme: string | null;
  entries: DeckRemixPlanEntry[];
  /** Entries beyond the caller's batch cap, reported in the UI. */
  skipped: number;
};

export type CreateSetJobInput = {
  theme: string;
  style?: string;
  size: number;
  /** Generate INTO this set (must be owned) instead of creating a new one. */
  setId?: string;
};

export type CreateSetJobResult =
  | { ok: true; job: GenerationJobRow; setSlug: string }
  | { ok: false; error: string };

const ICON_STEP_KEY = "icon";
const COVER_STEP_KEY = "cover";

// Shared art direction so a batch renders as ONE set, not N unrelated
// commissions. The per-card prompt appends the card's own scene.
function artPrompt(plan: SetJobPlan, card: DesignedCard): string {
  const style = plan.style?.trim()
    ? `Rendered strictly in ${plan.style.trim()} style.`
    : "Painterly high-fantasy illustration style.";
  return [
    `Fantasy trading-card illustration for the set "${plan.set_title}".`,
    style,
    "One cohesive set: consistent rendering technique, palette, and lighting across all cards.",
    card.art_prompt,
    "NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.",
  ].join(" ");
}

function iconPrompt(plan: SetJobPlan): string {
  const style = plan.style?.trim() ? ` with a hint of ${plan.style.trim()} styling` : "";
  return [
    `A single flat emblem representing the trading-card set "${plan.set_title}" (${plan.theme})${style}.`,
    "Bold simple silhouette readable at 16 pixels, one dark color on a plain white background, centered, generous margin.",
    "No text, no letters, no frame, no gradients.",
  ].join(" ");
}

export async function createSetGenerationJob(
  input: CreateSetJobInput,
): Promise<CreateSetJobResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to generate sets." };

  const supabase = await createClient();

  // Resolve or create the target set.
  let existingSet: { id: string; slug: string; title: string; description: string | null; icon_url: string | null; icon_code: string | null; cover_url: string | null } | null = null;
  if (input.setId) {
    const { data } = await supabase
      .from("card_sets")
      .select("id, slug, title, description, icon_url, icon_code, cover_url, owner_id")
      .eq("id", input.setId)
      .maybeSingle();
    if (!data || data.owner_id !== user.id) {
      return { ok: false, error: "Set not found or not yours." };
    }
    existingSet = data;
  }

  // ---- PLAN: concept + all card text in one cohesive batch ----
  let generated;
  try {
    generated = await generateSet({
      theme: input.theme,
      style: input.style,
      size: input.size,
      existingSet: existingSet
        ? { title: existingSet.title, description: existingSet.description }
        : undefined,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Generation failed.";
    return { ok: false, error: `AI set planning failed: ${detail}` };
  }

  let setId = existingSet?.id;
  let setSlug = existingSet?.slug;
  if (!setId) {
    // AI-generated sets ship PUBLIC by default (owner decision, 2026-07-10);
    // every card still lands as the user's own and can be unpublished.
    const created = await createSetAction(
      {
        title: generated.set_title,
        description: generated.set_description,
        visibility: "public",
      },
      { redirectAfterCreate: false },
    );
    if (!created.ok) return { ok: false, error: "Couldn't create the set." };
    setId = created.setId;
    setSlug = created.slug;
  }

  const plan: SetJobPlan = {
    set_title: existingSet?.title ?? generated.set_title,
    set_description: generated.set_description,
    theme: input.theme.trim() || "designer's choice",
    style: input.style?.trim() || null,
    cards: generated.cards,
  };

  const steps: JobStep[] = generated.cards.map((card, index) => ({
    key: `card:${index}`,
    label: card.title,
    status: "pending" as const,
  }));
  // Only generate icon/cover when the set doesn't already have them.
  if (!existingSet?.icon_url && !existingSet?.icon_code) {
    steps.push({ key: ICON_STEP_KEY, label: "Set icon", status: "pending" });
  }
  if (!existingSet?.cover_url) {
    steps.push({ key: COVER_STEP_KEY, label: "Set cover", status: "pending" });
  }

  const { data: jobRow, error: insertError } = await supabase
    .from("ai_generation_jobs")
    .insert({
      owner_id: user.id,
      kind: "set",
      status: "generating",
      request: {
        theme: input.theme,
        style: input.style ?? null,
        size: input.size,
        set_id: setId,
        set_slug: setSlug,
      },
      // Typed shapes → the table's jsonb columns.
      plan: plan as unknown as Json,
      steps: steps as unknown as Json,
      set_id: setId,
    })
    .select("*")
    .single();
  if (insertError || !jobRow) {
    return { ok: false, error: "Couldn't persist the generation job." };
  }

  return {
    ok: true,
    job: jobRow as unknown as GenerationJobRow,
    setSlug: setSlug ?? "",
  };
}

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
  | { ok: true; job: GenerationJobRow }
  | { ok: false; error: string };

/**
 * Execute one step of a set job: the given `stepKey`, or the first
 * pending/failed step. Persists the step outcome and flips the job to
 * "done" when nothing is left. Card creation is retry-safe (a step whose
 * card exists only redoes the art).
 */
export async function runNextJobStep(
  jobId: string,
  stepKey?: string,
): Promise<RunStepResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to continue generation." };

  const job = await getGenerationJob(jobId);
  if (!job) return { ok: false, error: "Job not found." };
  if (job.status !== "generating") {
    return { ok: true, job };
  }
  if (!job.plan || (!job.set_id && !job.deck_id)) {
    return { ok: false, error: "Job has no plan — recreate it." };
  }

  const steps = [...job.steps];
  const index = stepKey
    ? steps.findIndex((step) => step.key === stepKey)
    : steps.findIndex((step) => step.status === "pending");
  if (index === -1) {
    return finalizeJob(jobId, steps);
  }
  const step = steps[index];
  const stepIndex = Number(step.key.split(":")[1]);

  if (step.key === COVER_STEP_KEY) {
    steps[index] = await runCoverStep(user.id, job, step);
  } else {
    switch (job.kind) {
      case "set": {
        if (step.key === ICON_STEP_KEY) {
          steps[index] = await runIconStep(user.id, job, step);
        } else {
          const card = (job.plan as SetJobPlan).cards[stepIndex];
          steps[index] = card
            ? await runCardStep(user.id, job, step, card)
            : { ...step, status: "failed", error: "Missing card plan." };
        }
        break;
      }
      case "deck": {
        const plan = job.plan as DeckJobPlan;
        const card = plan.cards[stepIndex];
        steps[index] = card
          ? await runDeckCardStep(user.id, job, step, plan, stepIndex)
          : { ...step, status: "failed", error: "Missing card plan." };
        break;
      }
      case "deck_remix": {
        const plan = job.plan as DeckRemixJobPlan;
        const entry = plan.entries[stepIndex];
        steps[index] = entry
          ? await runDeckRemixStep(user.id, job, step, plan, entry)
          : { ...step, status: "failed", error: "Missing entry plan." };
        break;
      }
    }
  }

  return persistSteps(jobId, steps);
}

// ---------------------------------------------------------------------------
// Deck generation
// ---------------------------------------------------------------------------

export type CreateDeckJobInput = {
  theme: string;
  style?: string;
  format: AiDeckFormat;
  size: number;
};

export type CreateDeckJobResult =
  | { ok: true; job: GenerationJobRow; deckSlug: string }
  | { ok: false; error: string };

export async function createDeckGenerationJob(
  input: CreateDeckJobInput,
): Promise<CreateDeckJobResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to generate decks." };

  let planResult;
  try {
    planResult = await generateDeckPlan(input);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Generation failed.";
    return { ok: false, error: `AI deck planning failed: ${detail}` };
  }

  // AI-generated decks ship PUBLIC by default (owner decision, 2026-07-10).
  const created = await createDeckAction(
    {
      title: planResult.concept.deck_title,
      description: planResult.concept.deck_description,
      format: input.format,
      visibility: "public",
    },
    { redirectAfterCreate: false },
  );
  if (!created.ok) return { ok: false, error: "Couldn't create the deck." };

  const plan: DeckJobPlan = {
    deck_title: planResult.concept.deck_title,
    strategy: planResult.concept.strategy,
    theme: input.theme.trim() || "designer's choice",
    style: input.style?.trim() || null,
    format: input.format,
    cards: planResult.cards,
    roles: planResult.slots.map((slot) => slot.role),
    quantities: planResult.slots.map((slot) => slot.quantity),
  };
  const steps: JobStep[] = planResult.cards.map((card, index) => ({
    key: `card:${index}`,
    label: card.title,
    status: "pending" as const,
  }));
  steps.push({ key: COVER_STEP_KEY, label: "Deck cover", status: "pending" });

  const supabase = await createClient();
  const { data: jobRow, error: insertError } = await supabase
    .from("ai_generation_jobs")
    .insert({
      owner_id: user.id,
      kind: "deck",
      status: "generating",
      request: {
        theme: input.theme,
        style: input.style ?? null,
        format: input.format,
        size: input.size,
        deck_id: created.deckId,
        deck_slug: created.slug,
      },
      plan: plan as unknown as Json,
      steps: steps as unknown as Json,
      deck_id: created.deckId,
    })
    .select("*")
    .single();
  if (insertError || !jobRow) {
    return { ok: false, error: "Couldn't persist the generation job." };
  }
  return {
    ok: true,
    job: jobRow as unknown as GenerationJobRow,
    deckSlug: created.slug,
  };
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

async function runCardStep(
  userId: string,
  job: GenerationJobRow,
  step: JobStep,
  card: DesignedCard,
): Promise<JobStep> {
  const supabase = await createClient();
  let cardId = step.card_id;

  if (!cardId) {
    // Resolve the active game system (same lookup as the legacy route).
    const { data: gameSystem } = await supabase
      .from("game_systems")
      .select("id")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!gameSystem) {
      return { ...step, status: "failed", error: "No game system configured." };
    }

    const result = await createCardAction(
      {
        title: card.title,
        game_system_id: gameSystem.id,
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
        primary_set_id: job.set_id ?? undefined,
      },
      { redirectAfterCreate: false },
    );
    if (!result.ok) {
      const detail =
        result.formError ??
        Object.values(result.fieldErrors ?? {})[0] ??
        "Card creation failed.";
      return { ...step, status: "failed", error: detail };
    }
    cardId = result.cardId;

    // Meter the card (free when billing is off; ledger reason matches the
    // legacy set flow).
    await spendCredits(1, "generate_deck");
  }

  // ---- Art + publish (the expensive half; retried independently) ----
  await logAiCall(userId, "generate_deck_cards");
  const published = await paintAndPublishCard(
    cardId,
    artPrompt(job.plan as SetJobPlan, card),
  );
  if (!published.ok) {
    return { ...step, status: "failed", card_id: cardId, error: published.error };
  }
  return { ...step, status: "done", card_id: cardId, error: undefined };
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
  prompt: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const image = await generatePlainImage(prompt);
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

async function runDeckCardStep(
  userId: string,
  job: GenerationJobRow,
  step: JobStep,
  plan: DeckJobPlan,
  cardIndex: number,
): Promise<JobStep> {
  const card = plan.cards[cardIndex];
  const supabase = await createClient();
  let cardId = step.card_id;

  if (!cardId) {
    const { data: gameSystem } = await supabase
      .from("game_systems")
      .select("id")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!gameSystem) {
      return { ...step, status: "failed", error: "No game system configured." };
    }

    // Commander slot: force the Legendary supertype the frame renders.
    const isCommander = plan.roles[cardIndex] === "commander";
    const result = await createCardAction(
      {
        title: card.title,
        game_system_id: gameSystem.id,
        cost: card.cost ?? undefined,
        color_identity: card.color_identity,
        supertype: isCommander ? card.supertype || "Legendary" : card.supertype ?? undefined,
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
        deck_id: job.deck_id ?? undefined,
      },
      { redirectAfterCreate: false },
    );
    if (!result.ok) {
      return { ...step, status: "failed", error: createFailureMessage(result) };
    }
    cardId = result.cardId;

    if (job.deck_id) {
      await setDeckEntryDetails(
        job.deck_id,
        cardId,
        isCommander ? "commander" : "main",
        plan.quantities[cardIndex] ?? 1,
      );
    }
    await spendCredits(1, "generate_deck");
  }

  await logAiCall(userId, "generate_deck_cards");
  const published = await paintAndPublishCard(cardId, deckArtPrompt(plan, card));
  if (!published.ok) {
    return { ...step, status: "failed", card_id: cardId, error: published.error };
  }
  return { ...step, status: "done", card_id: cardId, error: undefined };
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
  if (mechanics.art_url) {
    try {
      const sourceResponse = await fetch(mechanics.art_url);
      if (sourceResponse.ok) {
        const contentType =
          sourceResponse.headers.get("content-type") ?? "image/png";
        const restyled = await restyleImage({
          source: new Uint8Array(await sourceResponse.arrayBuffer()),
          sourceContentType: contentType,
          prompt: `Re-render this artwork in ${plan.style} style. ${identity.art_instruction}`,
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
  const result = await createCardAction(
    {
      title: identity.title,
      game_system_id: await activeGameSystemId(),
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
  await spendCredits(1, "generate_deck");

  return {
    ...step,
    status: "done",
    card_id: result.cardId,
    label: identity.title,
    error: undefined,
  };
}

async function activeGameSystemId(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("game_systems")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? "";
}

/** Wide key-art prompt for the set/deck cover tile. */
function coverPrompt(job: GenerationJobRow): { prompt: string; aspect: ImageAspect } {
  let title = "the collection";
  let subject = "";
  let style: string | null = null;
  if (job.kind === "set") {
    const plan = job.plan as SetJobPlan;
    title = plan.set_title;
    subject = `${plan.theme}. ${plan.set_description}`;
    style = plan.style;
  } else if (job.kind === "deck") {
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
    aspect: "wide",
    prompt: [
      `Wide cinematic key art for a trading-card collection called "${title}".`,
      subject.slice(0, 400),
      styleLine,
      "Epic establishing-shot composition with a clear focal point that survives cropping.",
      "NO frame, NO borders, NO logo, NO text or lettering anywhere in the image.",
    ].join(" "),
  };
}

/** Generate + attach the set/deck cover image. */
async function runCoverStep(
  userId: string,
  job: GenerationJobRow,
  step: JobStep,
): Promise<JobStep> {
  await logAiCall(userId, job.kind === "set" ? "generate_deck" : "generate_deck_cards");
  const { prompt, aspect } = coverPrompt(job);
  const image = await generatePlainImage(prompt, aspect);
  if (!image.ok) {
    return { ...step, status: "failed", error: image.error };
  }
  const persisted = await persistGeneratedArt(image.bytes, image.contentType);
  if (!persisted.ok) {
    return { ...step, status: "failed", error: persisted.error };
  }

  if (job.kind === "set" && job.set_id) {
    const updated = await updateSetAction(job.set_id, {
      cover_url: persisted.publicUrl,
    });
    if (!updated.ok) {
      return { ...step, status: "failed", error: "Couldn't attach the set cover." };
    }
    return { ...step, status: "done", error: undefined };
  }
  if (job.deck_id) {
    const updated = await updateDeckAction(job.deck_id, {
      cover_url: persisted.publicUrl,
    });
    if (!updated.ok) {
      return { ...step, status: "failed", error: "Couldn't attach the deck cover." };
    }
    return { ...step, status: "done", error: undefined };
  }
  return { ...step, status: "failed", error: "Job has no set or deck to cover." };
}

async function runIconStep(
  userId: string,
  job: GenerationJobRow,
  step: JobStep,
): Promise<JobStep> {
  await logAiCall(userId, "generate_set_icon");
  const image = await generatePlainImage(iconPrompt(job.plan as SetJobPlan));
  if (!image.ok) {
    return { ...step, status: "failed", error: image.error };
  }
  const persisted = await persistGeneratedArt(image.bytes, image.contentType);
  if (!persisted.ok) {
    return { ...step, status: "failed", error: persisted.error };
  }
  const updated = await updateSetAction(job.set_id!, {
    icon_url: persisted.publicUrl,
  });
  if (!updated.ok) {
    return { ...step, status: "failed", error: "Couldn't attach the set icon." };
  }
  return { ...step, status: "done", error: undefined };
}

async function persistSteps(
  jobId: string,
  steps: JobStep[],
): Promise<RunStepResult> {
  const pendingLeft = steps.some((step) => step.status === "pending");
  const anyDone = steps.some((step) => step.status === "done");
  const status = pendingLeft ? "generating" : anyDone ? "done" : "failed";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_generation_jobs")
    .update({ steps: steps as unknown as Json, status })
    .eq("id", jobId)
    .select("*")
    .single();
  if (error || !data) {
    return { ok: false, error: "Couldn't persist step progress." };
  }
  return { ok: true, job: data as unknown as GenerationJobRow };
}

async function finalizeJob(
  jobId: string,
  steps: JobStep[],
): Promise<RunStepResult> {
  return persistSteps(jobId, steps);
}
