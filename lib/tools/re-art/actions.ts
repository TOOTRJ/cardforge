"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getCardCapacity } from "@/lib/cards/capacity";
import { describeCapacity, remainingCapacity, type CardCapacity } from "@/lib/billing/capacity-copy";
import { isBillingEnabled } from "@/lib/billing/flags";
import { DECK_CARDS_DAILY_LIMIT, checkDailyActionLimit, getFreshCreditBalance } from "@/lib/ai/rate-limit";
import { isGatewayConfigured } from "@/lib/ai/provider";
import { OWNER_JOB_COLUMNS } from "@/lib/ai/job-privacy";
import { discardGeneratedArt } from "@/lib/ai/random-art";
import type { GenerationJobView, JobStep } from "@/lib/ai/generation-jobs";
import { updateCardAction } from "@/lib/cards/actions";
import { fitArtToWindow } from "@/lib/cards/art-fit";
import { isUuid } from "@/lib/ids";
import type { CardBackFace } from "@/types/card";
import type { Json } from "@/types/supabase";
import { checkToolAccess } from "@/lib/tools/queries";
import { recordToolEvent } from "@/lib/tools/events";
import { toolHref } from "@/lib/tools/catalog";
import {
  REART_TOOL_SLUG,
  reartRunSchema,
  reartStepKey,
  reartStyleProblem,
  reartStyleSchema,
  type ReartCost,
  type ReartStyle,
} from "@/lib/tools/re-art/model";
import {
  getOwnedDeck,
  planLines,
  planReartRun,
  readPaintedCards,
  saveDeckStyle,
  writePaintedCard,
  type ReartPlanLine,
} from "@/lib/tools/re-art/server";
import type { ReartJobPlan } from "@/lib/tools/re-art/step";

// ---------------------------------------------------------------------------
// Re-art deck's server actions. Every one starts with the tool's gate.
//
//   * SAVE STYLE keeps the deck's style (0191 deck_art_styles; a changed
//     style moves its version on — a new look).
//   * PLAN reads the deck once (the `deck_import` quota for its real cards'
//     Scryfall run, as Bulk Customize's prepare) and prices the run: the
//     studio's confirm shows it BEFORE anything is charged.
//   * START plans again (`deck_import_commit`) and decides: the saved-card
//     limit for the real cards it makes, the credits, one run of a deck at a
//     time, then the style and the job row (kind 'deck_reart').
//   * PUT THE OLD ART BACK edits one of the maker's own cards back to the
//     picture it had before Re-art painted it.
// ---------------------------------------------------------------------------

const NO_ACCESS = "Re-art deck isn't open to you.";

export type ReartFailure = {
  ok: false;
  error: string;
  code?: "CARD_CAPACITY" | "INSUFFICIENT_CREDITS" | "RATE_LIMITED" | "BUSY";
  retryAfterSeconds?: number;
};

export async function saveReartStyleAction(
  deckId: unknown,
  styleInput: unknown,
): Promise<{ ok: true; style: ReartStyle; version: number } | ReartFailure> {
  const access = await checkToolAccess(REART_TOOL_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const style = reartStyleSchema.safeParse(styleInput);
  if (typeof deckId !== "string" || !style.success) return { ok: false, error: "That style couldn't be read." };
  const problem = reartStyleProblem(style.data);
  if (problem) return { ok: false, error: problem };
  const deck = await getOwnedDeck(access.userId, deckId);
  if (!deck) return { ok: false, error: "That deck isn't one of yours." };
  const saved = await saveDeckStyle(access.userId, deck.id, style.data);
  if (!saved) return { ok: false, error: "Couldn't save the style — try again." };
  await recordToolEvent({
    slug: REART_TOOL_SLUG,
    userId: access.userId,
    event: "save_style",
    access: access.via,
    props: { preset: saved.preset, theme_chars: saved.theme.length, version: saved.version },
  });
  revalidatePath(toolHref(REART_TOOL_SLUG));
  return { ok: true, style: { preset: saved.preset, theme: saved.theme }, version: saved.version };
}

export type ReartPlanned = {
  ok: true;
  lines: ReartPlanLine[];
  skipped: Array<{ name: string; reason: string }>;
  inStyle: number;
  styleChanged: boolean;
  cost: ReartCost;
  capacity: CardCapacity | null;
  /** The live balance, or null where credits aren't charged. */
  balance: number | null;
  aiAvailable: boolean;
};

function costOf(lines: ReartPlanLine[], capacity: CardCapacity | null): ReartCost {
  const makes = lines.filter((line) => line.kind === "printing").length;
  const room = capacity ? remainingCapacity(capacity) : null;
  return {
    cards: lines.length,
    makes,
    credits: lines.reduce((sum, line) => sum + line.credits, 0),
    slotsLeftAfter: room === null ? null : room - makes,
  };
}

export async function planReartAction(input: unknown): Promise<ReartPlanned | ReartFailure> {
  const access = await checkToolAccess(REART_TOOL_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = reartRunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That run couldn't be read — reload the page." };
  const plan = await planReartRun(access.userId, parsed.data, "deck_import");
  if (!plan.ok) return plan;
  const [capacity, balance] = await Promise.all([getCardCapacity(), getFreshCreditBalance()]);
  const lines = planLines(plan);
  return {
    ok: true,
    lines,
    skipped: plan.skipped,
    inStyle: plan.inStyle,
    styleChanged: plan.styleChanged,
    cost: costOf(lines, capacity),
    capacity,
    balance,
    aiAvailable: isGatewayConfigured(),
  };
}

export type ReartStarted = {
  ok: true;
  job: GenerationJobView;
  skipped: Array<{ name: string; reason: string }>;
  credits: number;
  version: number;
};

/** How long a claimed step counts as painting (claim_job_step's stale window). */
const STEP_LIVE_MS = 5 * 60_000;

export async function startReartAction(input: unknown): Promise<ReartStarted | ReartFailure> {
  const access = await checkToolAccess(REART_TOOL_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = reartRunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That run couldn't be read — reload the page." };
  if (!isGatewayConfigured()) return { ok: false, error: "AI art isn't available right now — try again later." };

  const plan = await planReartRun(access.userId, parsed.data, "deck_import_commit");
  if (!plan.ok) return plan;
  if (plan.entries.length === 0) {
    return {
      ok: false,
      error:
        plan.inStyle > 0
          ? "Every card of this run is in the deck's style already."
          : (plan.skipped[0]?.reason ?? "None of these cards can be re-arted."),
    };
  }

  // The real cards it makes must fit the saved-card limit (the database
  // holds the cap at each insert too, and a step stops the run on it).
  const makes = plan.entries.filter((entry) => entry.kind === "printing").length;
  if (makes > 0) {
    const capacity = await getCardCapacity();
    const room = capacity ? remainingCapacity(capacity) : null;
    if (room !== null && makes > room) {
      return {
        ok: false,
        code: "CARD_CAPACITY",
        error: describeCapacity(capacity, makes)?.message ?? "This run needs more card slots than your plan has left.",
      };
    }
  }

  // The credits, priced here; each step reserves its own and is refunded if
  // it fails.
  const credits = plan.entries.reduce((sum, entry) => sum + entry.credits, 0);
  if (!isBillingEnabled()) {
    const daily = await checkDailyActionLimit(access.userId, "deck_reart_art", DECK_CARDS_DAILY_LIMIT, "AI pictures");
    if (!daily.ok) return { ok: false, error: daily.message, code: "RATE_LIMITED", retryAfterSeconds: daily.retryAfterSeconds };
  } else {
    const balance = await getFreshCreditBalance();
    if (balance !== null && balance < credits) {
      return {
        ok: false,
        code: "INSUFFICIENT_CREDITS",
        error: `This run costs ${credits} credit${credits === 1 ? "" : "s"} and you have ${balance}.`,
      };
    }
  }

  // One run of a deck at a time: a run still painting a card (another tab)
  // is waited for; an older run that stopped is closed, so no card is
  // painted by two runs.
  const supabase = await createClient();
  const { data: open } = await supabase
    .from("ai_generation_jobs")
    .select("id, steps")
    .eq("owner_id", access.userId)
    .eq("kind", "deck_reart")
    .eq("status", "generating")
    .filter("request->>deck_id", "eq", plan.deck.id);
  const now = Date.now();
  const live = (open ?? []).some((row) =>
    (Array.isArray(row.steps) ? (row.steps as Array<{ status?: unknown; claimed_at?: unknown }>) : []).some(
      (step) =>
        step?.status === "running" &&
        typeof step.claimed_at === "string" &&
        now - new Date(step.claimed_at).getTime() < STEP_LIVE_MS,
    ),
  );
  if (live) {
    return { ok: false, code: "BUSY", error: "Another run of this deck is still painting a card — wait for it, then try again." };
  }
  if ((open ?? []).length > 0 && isAdminConfigured()) {
    await createAdminClient()
      .from("ai_generation_jobs")
      .update({ status: "cancelled" })
      .in(
        "id",
        (open ?? []).map((row) => row.id),
      )
      .eq("owner_id", access.userId);
  }

  // The style the run paints in becomes the deck's.
  const saved = await saveDeckStyle(access.userId, plan.deck.id, plan.style);
  if (!saved) return { ok: false, error: "Couldn't save the deck's style — try again." };

  const jobPlan: ReartJobPlan = {
    deck_id: plan.deck.id,
    style: { preset: saved.preset, theme: saved.theme, version: saved.version },
    visibility: parsed.data.visibility ?? "public",
    entries: plan.entries.map((entry) => ({
      entry_id: entry.entryId,
      name: entry.name,
      kind: entry.kind,
      credits: entry.credits,
      repaint: entry.repaint,
    })),
  };
  const steps: JobStep[] = plan.entries.map((entry, index) => ({
    key: reartStepKey(index),
    label: entry.name,
    status: "pending" as const,
    ...(entry.credits > 1 ? { credits: entry.credits } : {}),
  }));
  const reroll = Boolean(parsed.data.entryIds) && !parsed.data.sample;
  const { data: jobRow, error } = await supabase
    .from("ai_generation_jobs")
    .insert({
      owner_id: access.userId,
      kind: "deck_reart",
      status: "generating",
      request: {
        tool: REART_TOOL_SLUG,
        deck_id: plan.deck.id,
        cards: plan.entries.length,
        makes,
        credits,
        sample: parsed.data.sample === true,
        reroll,
        style_version: saved.version,
      },
      plan: jobPlan as unknown as Json,
      steps: steps as unknown as Json,
      deck_id: null,
    })
    .select(OWNER_JOB_COLUMNS)
    .single();
  if (error || !jobRow) {
    console.error("[re-art] job insert failed:", error?.message);
    return { ok: false, error: "Couldn't start the run — try again." };
  }

  await recordToolEvent({
    slug: REART_TOOL_SLUG,
    userId: access.userId,
    event: parsed.data.sample ? "start_sample" : reroll ? "reroll" : "start",
    access: access.via,
    props: {
      cards: plan.entries.length,
      makes,
      credits,
      skipped: plan.skipped.length,
      in_style: plan.inStyle,
      scope: parsed.data.scope ?? "all",
      preset: saved.preset,
      style_changed: plan.styleChanged,
      visibility: jobPlan.visibility,
    },
  });
  return { ok: true, job: jobRow as unknown as GenerationJobView, skipped: plan.skipped, credits, version: saved.version };
}

/**
 * "Put the old art back": one of the maker's own cards, edited back to the
 * picture it had before Re-art first painted it (its art and fit alone, as
 * the paint edited them). The card stays in the run's style as far as a run
 * is concerned — it is shown "kept its own art", and a re-roll paints it
 * again.
 */
export async function restoreReartArtAction(deckId: unknown, cardId: unknown): Promise<{ ok: true } | ReartFailure> {
  const access = await checkToolAccess(REART_TOOL_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  if (typeof deckId !== "string" || typeof cardId !== "string" || !isUuid(deckId) || !isUuid(cardId)) {
    return { ok: false, error: "That card couldn't be read." };
  }
  const deck = await getOwnedDeck(access.userId, deckId);
  if (!deck) return { ok: false, error: "That deck isn't one of yours." };
  const painted = (await readPaintedCards(deck.id)).get(cardId);
  if (!painted || painted.made || !painted.previousArtUrl || !painted.artUrl) {
    return { ok: false, error: "There's no earlier art to put back on this card." };
  }
  const supabase = await createClient();
  const { data: card } = await supabase
    .from("cards")
    .select("id, owner_id, art_url, back_face")
    .eq("id", cardId)
    .maybeSingle();
  if (!card || card.owner_id !== access.userId) return { ok: false, error: "That card isn't one of yours." };
  if (card.art_url !== painted.artUrl) {
    return { ok: false, error: "This card has other art now — change it in the card's editor." };
  }
  const back = (card.back_face ?? null) as CardBackFace | null;
  const restoreBack = Boolean(back && painted.backArtUrl && back.art_url === painted.backArtUrl);
  const result = await updateCardAction(card.id, {
    art_url: painted.previousArtUrl,
    art_position: painted.previousArtPosition ?? fitArtToWindow(),
    ...(restoreBack && back
      ? {
          back_face: {
            ...back,
            art_url: painted.previousBackArtUrl ?? null,
            art_position: painted.previousBackArtPosition ?? fitArtToWindow(),
          },
        }
      : {}),
  });
  if (!result.ok) {
    return { ok: false, error: result.formError ?? Object.values(result.fieldErrors ?? {})[0] ?? "Couldn't put the old art back." };
  }
  // The painted pictures no card holds any more go; the row says "kept its
  // own art" in this style (a full run leaves it alone, a re-roll paints it).
  await discardGeneratedArt(access.userId, painted.artUrl);
  if (restoreBack && painted.backArtUrl) await discardGeneratedArt(access.userId, painted.backArtUrl);
  await writePaintedCard(access.userId, deck.id, null, {
    cardId: card.id,
    styleVersion: painted.styleVersion,
    artUrl: null,
    backArtUrl: null,
    made: false,
    previousArtUrl: null,
    previousArtPosition: null,
    previousBackArtUrl: null,
    previousBackArtPosition: null,
  });
  await recordToolEvent({ slug: REART_TOOL_SLUG, userId: access.userId, event: "restore", access: access.via });
  revalidatePath(toolHref(REART_TOOL_SLUG));
  return { ok: true };
}
