import "server-only";

import type { Json } from "@/types/supabase";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createCardAction } from "@/lib/cards/actions";
import { createSetAction, updateSetAction } from "@/lib/sets/actions";
import { generateSet } from "@/lib/ai/set-gen";
import { generatePlainImage } from "@/lib/ai/image-gen";
import { persistGeneratedArt } from "@/lib/ai/random-art";
import { logAiCall, spendCredits } from "@/lib/ai/rate-limit";
import type { DesignedCard } from "@/lib/ai/card-design";

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
  plan: SetJobPlan | null;
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
  let existingSet: { id: string; slug: string; title: string; description: string | null; icon_url: string | null; icon_code: string | null } | null = null;
  if (input.setId) {
    const { data } = await supabase
      .from("card_sets")
      .select("id, slug, title, description, icon_url, icon_code, owner_id")
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
    const created = await createSetAction(
      {
        title: generated.set_title,
        description: generated.set_description,
        visibility: "private",
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
  // Only generate an icon when the set doesn't already have one.
  if (!existingSet?.icon_url && !existingSet?.icon_code) {
    steps.push({ key: ICON_STEP_KEY, label: "Set icon", status: "pending" });
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
  if (job.kind !== "set") {
    return { ok: false, error: "Unsupported job kind for this endpoint." };
  }
  if (job.status !== "generating") {
    return { ok: true, job };
  }
  if (!job.plan || !job.set_id) {
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

  if (step.key === ICON_STEP_KEY) {
    steps[index] = await runIconStep(user.id, job, step);
  } else {
    const cardIndex = Number(step.key.split(":")[1]);
    const card = job.plan.cards[cardIndex];
    if (!card) {
      steps[index] = { ...step, status: "failed", error: "Missing card plan." };
    } else {
      steps[index] = await runCardStep(user.id, job, step, card);
    }
  }

  return persistSteps(jobId, steps);
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

  // ---- Art (the expensive half; retried independently of creation) ----
  await logAiCall(userId, "generate_deck_cards");
  const image = await generatePlainImage(artPrompt(job.plan as SetJobPlan, card));
  if (!image.ok) {
    return { ...step, status: "failed", card_id: cardId, error: image.error };
  }
  const persisted = await persistGeneratedArt(image.bytes, image.contentType);
  if (!persisted.ok) {
    return { ...step, status: "failed", card_id: cardId, error: persisted.error };
  }

  const { error: updateError } = await supabase
    .from("cards")
    .update({
      art_url: persisted.publicUrl,
      art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    })
    .eq("id", cardId)
    .eq("owner_id", userId);
  if (updateError) {
    return { ...step, status: "failed", card_id: cardId, error: updateError.message };
  }

  return { ...step, status: "done", card_id: cardId, error: undefined };
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
