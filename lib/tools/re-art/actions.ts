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
import type { GenerationJobView, JobStep } from "@/lib/ai/generation-jobs";
import { updateCardAction } from "@/lib/cards/actions";
import { fitArtToWindow } from "@/lib/cards/art-fit";
import { isUuid } from "@/lib/ids";
import type { CardBackFace } from "@/types/card";
import type { Json } from "@/types/supabase";
import { checkToolAccess } from "@/lib/tools/queries";
import type { ToolAccessPath } from "@/lib/tools/access";
import { recordToolEventLater, type ToolEventProps } from "@/lib/tools/events";
import { toolHref, toolReasonOfCode } from "@/lib/tools/catalog";
import {
  REART_DEFAULT_VISIBILITY,
  REART_CARD_WORDS_MAX,
  REART_DEFAULT_METHOD,
  REART_DEFAULT_MODEL,
  REART_IP_NEEDS_CONFIRMATION,
  REART_IP_TOO_MANY,
  REART_MODEL_NOT_YOURS,
  REART_TOOL_SLUG,
  canPickReartModel,
  cleanReartCardWords,
  reartRunMode,
  reartWordsSaySomething,
  reartRunSchema,
  reartStepKey,
  reartStyleProblem,
  reartStyleSchema,
  withBackArt,
  type NormalReartStyle,
  type ReartCardWords,
  type ReartCost,
} from "@/lib/tools/re-art/model";
import {
  discardReartArtIfUnused,
  getOwnedDeck,
  planLines,
  planReartRun,
  readDeckStyleAdmin,
  readPaintedCards,
  saveCardWords,
  saveDeckStyle,
  styleLicenceCheck,
  writePaintedCard,
  type ReartPlanLine,
} from "@/lib/tools/re-art/server";
import type { ReartJobPlan } from "@/lib/tools/re-art/step";

// ---------------------------------------------------------------------------
// Re-art deck's server actions. Every one starts with the tool's gate.
//
//   * SAVE STYLE keeps the deck's style (0191 deck_art_styles; a changed
//     style moves its version on — a new look). The style is the tool's
//     template or the maker's OWN prompt (0209).
//   * SAVE A CARD'S WORDS keeps (or removes) one card's own words for its
//     picture (0209 deck_reart_prompts). Nothing is painted or charged.
//   * PLAN reads the deck once (the `deck_import` quota for its real cards'
//     Scryfall run, as Bulk Customize's prepare) and prices the run: the
//     studio's confirm shows it BEFORE anything is charged.
//   * START plans again (`deck_import_commit`) and decides: the saved-card
//     limit for the real cards it makes, the credits, one run of a deck at a
//     time, then the style and the job row (kind 'deck_reart').
//   * PUT THE OLD ART BACK edits one of the maker's own cards back to the
//     picture it had before Re-art painted it.
//
// Each records what it did after the response (recordToolEventLater —
// counts, choices and codes only, never a deck's or a card's name or the
// style's words): the action's name when it worked, `<name>_failed` with a
// `reason` code when it didn't. A run's own outcome (painted, failed,
// credits spent, why it stopped) is the studio's `run_finished`.
// ---------------------------------------------------------------------------

const NO_ACCESS = "Re-art deck isn't open to you.";

/** One line in the tool's log (lib/tools/events.ts): never awaited, never
 *  able to fail the action. */
function track(access: { userId: string; via: ToolAccessPath | null }, event: string, props?: ToolEventProps): void {
  recordToolEventLater({ slug: REART_TOOL_SLUG, userId: access.userId, event, access: access.via, props });
}

/** A refusal's code for the log: the action's own `code` (one vocabulary
 *  across the tools: lib/tools/catalog.ts toolReasonOfCode), else the
 *  branch's. */
function reasonOf(failure: { code?: string }, fallback: string): string {
  return failure.code ? toolReasonOfCode(failure.code) : fallback;
}

/** What a run is, for the log — the studio's own reading
 *  (lib/tools/re-art/model.ts reartRunMode): a sample, named cards, or the
 *  deck. An empty list of cards names none. */
function runMode(run: { sample?: boolean; entryIds?: string[] }): "sample" | "cards" | "deck" {
  return reartRunMode({ sample: run.sample === true, reroll: Boolean(run.entryIds?.length) && !run.sample });
}

export type ReartFailure = {
  ok: false;
  error: string;
  code?: "CARD_CAPACITY" | "INSUFFICIENT_CREDITS" | "RATE_LIMITED" | "BUSY";
  retryAfterSeconds?: number;
};

export async function saveReartStyleAction(
  deckId: unknown,
  styleInput: unknown,
  /** `attested`: the maker ticked the sentence about the licensed property
   *  the style names (reartIpStatement) — needed, and recorded, only when
   *  the deck doesn't name that property yet. */
  options: { attested?: unknown } = {},
): Promise<{ ok: true; style: NormalReartStyle; version: number } | ReartFailure> {
  const access = await checkToolAccess(REART_TOOL_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const style = reartStyleSchema.safeParse(styleInput);
  if (typeof deckId !== "string" || !style.success) return { ok: false, error: "That style couldn't be read." };
  const problem = reartStyleProblem(style.data);
  if (problem) return { ok: false, error: problem };
  const deck = await getOwnedDeck(access.userId, deckId);
  if (!deck) return { ok: false, error: "That deck isn't one of yours." };
  const attested = options?.attested === true;
  // A property the deck doesn't name yet waits for the confirmation; a
  // reference picture is one of the maker's own.
  const before = await readDeckStyleAdmin(access.userId, deck.id);
  const licence = await styleLicenceCheck(access.userId, before?.ipName, style.data, attested);
  if (licence) {
    track(access, "save_style_failed", {
      reason: licence === REART_IP_NEEDS_CONFIRMATION ? "not_confirmed" : licence === REART_IP_TOO_MANY ? "rate_limited" : "reference_not_own",
    });
    return { ok: false, error: licence };
  }
  const saved = await saveDeckStyle(access.userId, deck.id, style.data, { attested });
  if (!saved) {
    track(access, "save_style_failed", { reason: "not_saved" });
    return { ok: false, error: "Couldn't save the style — try again." };
  }
  // Never the words (nor the property's name): how the prompt is made, how
  // long it is, and whether the deck names a property or holds a reference
  // picture.
  track(access, "save_style", {
    preset: saved.preset,
    theme_chars: saved.theme.length,
    mode: saved.mode,
    prompt_chars: saved.prompt.length,
    version: saved.version,
    licensed: Boolean(saved.ipName),
    reference: Boolean(saved.referenceUrl),
  });
  revalidatePath(toolHref(REART_TOOL_SLUG));
  const { version, ...savedStyle } = saved;
  return { ok: true, style: savedStyle, version };
}

/**
 * One card's own words for its picture — its subject in the deck's look, or
 * (`only`) its whole prompt — by deck ENTRY (a real card's entry has no card
 * of the maker's until a run makes one). Empty words remove them. Nothing is
 * painted or charged: a card already painted is painted with them when it is
 * re-rolled.
 */
export async function saveReartCardWordsAction(
  deckId: unknown,
  entryId: unknown,
  input: unknown,
): Promise<{ ok: true; words: ReartCardWords | null } | ReartFailure> {
  const access = await checkToolAccess(REART_TOOL_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const raw = (input ?? {}) as { text?: unknown; only?: unknown };
  if (
    typeof deckId !== "string" ||
    typeof entryId !== "string" ||
    !isUuid(deckId) ||
    !isUuid(entryId) ||
    typeof raw.text !== "string" ||
    raw.text.length > REART_CARD_WORDS_MAX * 2
  ) {
    return { ok: false, error: "Those words couldn't be read." };
  }
  const deck = await getOwnedDeck(access.userId, deckId);
  if (!deck) return { ok: false, error: "That deck isn't one of yours." };
  // The entry, from the caller's own deck (the database holds the row to it
  // too: 0209's trigger).
  const supabase = await createClient();
  const { data: entry } = await supabase.from("deck_cards").select("id").eq("id", entryId).eq("deck_id", deck.id).maybeSingle();
  if (!entry) return { ok: false, error: "That card is no longer in this deck." };
  const text = cleanReartCardWords(raw.text);
  // Words that say nothing (a lone ".") are no picture's subject, and
  // would be painted and paid for.
  if (text && !reartWordsSaySomething(text)) {
    return { ok: false, error: "Write what the picture shows, or leave it empty to remove the words." };
  }
  const words: ReartCardWords | null = text ? { text, only: raw.only === true } : null;
  if (!(await saveCardWords(access.userId, deck.id, entry.id, words))) {
    track(access, "save_card_words_failed", { reason: "not_saved" });
    return { ok: false, error: "Couldn't save the words — try again." };
  }
  // Never the words: their length and what they stand for.
  if (words) track(access, "save_card_words", { chars: words.text.length, only: words.only });
  else track(access, "remove_card_words");
  revalidatePath(toolHref(REART_TOOL_SLUG));
  return { ok: true, words };
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
  if (!plan.ok) {
    track(access, "plan_failed", { reason: reasonOf(plan, "plan_refused"), mode: runMode(parsed.data) });
    return plan;
  }
  const [capacity, balance] = await Promise.all([getCardCapacity(), getFreshCreditBalance()]);
  const lines = planLines(plan);
  const cost = costOf(lines, capacity);
  // The confirm as the maker sees it: what the run would paint and cost, and
  // whether a plan limit stands in its way.
  track(access, "plan", {
    mode: runMode(parsed.data),
    cards: cost.cards,
    makes: cost.makes,
    credits: cost.credits,
    skipped: plan.skipped.length,
    in_style: plan.inStyle,
    style_changed: plan.styleChanged,
    over_capacity: cost.slotsLeftAfter !== null && cost.slotsLeftAfter < 0,
    short_of_credits: balance !== null && cost.credits > balance,
  });
  return {
    ok: true,
    lines,
    skipped: plan.skipped,
    inStyle: plan.inStyle,
    styleChanged: plan.styleChanged,
    cost,
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
  const failed = (reason: string, props: ToolEventProps = {}) =>
    track(access, "start_failed", { reason, mode: runMode(parsed.data), ...props });
  // Naming the model — or what a picture starts from — is for admins and
  // testers (the studio shows them both): anyone else's run that names one
  // is refused, never painted another way behind their back.
  if (
    ((parsed.data.model ?? REART_DEFAULT_MODEL) !== REART_DEFAULT_MODEL ||
      (parsed.data.method ?? REART_DEFAULT_METHOD) !== REART_DEFAULT_METHOD) &&
    !canPickReartModel(access)
  ) {
    failed("model_not_allowed");
    return { ok: false, error: REART_MODEL_NOT_YOURS };
  }
  if (!isGatewayConfigured()) {
    failed("ai_unavailable");
    return { ok: false, error: "AI art isn't available right now — try again later." };
  }

  const plan = await planReartRun(access.userId, parsed.data, "deck_import_commit");
  if (!plan.ok) {
    failed(reasonOf(plan, "plan_refused"));
    return plan;
  }
  if (plan.entries.length === 0) {
    failed(plan.inStyle > 0 ? "all_in_style" : "nothing_to_paint");
    return {
      ok: false,
      error:
        plan.skipped.length === 0
          ? plan.inStyle > 0
            ? "Every card of this run is in the deck's style already."
            : "None of these cards can be re-arted."
          : plan.inStyle > 0 || plan.skipped.length > 1
            ? "No card of this run is waiting to be painted."
            : plan.skipped[0].reason,
    };
  }

  // The real cards it makes must fit the saved-card limit (the database
  // holds the cap at each insert too, and a step stops the run on it).
  const makes = plan.entries.filter((entry) => entry.kind === "printing").length;
  if (makes > 0) {
    const capacity = await getCardCapacity();
    const room = capacity ? remainingCapacity(capacity) : null;
    if (room !== null && makes > room) {
      failed("capacity", { cards: plan.entries.length, makes });
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
    if (!daily.ok) {
      failed("daily_limit", { cards: plan.entries.length, makes });
      return { ok: false, error: daily.message, code: "RATE_LIMITED", retryAfterSeconds: daily.retryAfterSeconds };
    }
  } else {
    const balance = await getFreshCreditBalance();
    if (balance !== null && balance < credits) {
      failed("insufficient_credits", { cards: plan.entries.length, makes, credits });
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
    failed("busy");
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

  // The style the run paints in becomes the deck's (a property it names
  // for the first time: with the maker's confirmation, recorded — the plan
  // above refused a run without it).
  const saved = await saveDeckStyle(access.userId, plan.deck.id, plan.style, { attested: parsed.data.attested === true });
  if (!saved) {
    failed("style_not_saved");
    return { ok: false, error: "Couldn't save the deck's style — try again." };
  }

  const jobPlan: ReartJobPlan = {
    deck_id: plan.deck.id,
    style: {
      preset: saved.preset,
      theme: saved.theme,
      mode: saved.mode,
      prompt: saved.prompt,
      version: saved.version,
      // The property the deck names and its reference picture (0214): named
      // only by a style that holds one — every other plan is what it was.
      ...(saved.ipName ? { ipName: saved.ipName } : {}),
      ...(saved.referenceUrl ? { referenceUrl: saved.referenceUrl } : {}),
    },
    visibility: parsed.data.visibility ?? REART_DEFAULT_VISIBILITY,
    model: parsed.data.model ?? REART_DEFAULT_MODEL,
    method: parsed.data.method ?? REART_DEFAULT_METHOD,
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
        // The model the run names (a code from the tool's own list): the
        // studio says it in the run's outcome. And what its pictures start
        // from.
        model: jobPlan.model,
        method: jobPlan.method,
        // Whether the deck named a licensed property or painted with a
        // reference picture (never the name or the address).
        ...(saved.ipName ? { licensed: true } : {}),
        ...(saved.referenceUrl ? { reference: true } : {}),
      },
      plan: jobPlan as unknown as Json,
      steps: steps as unknown as Json,
      deck_id: null,
    })
    .select(OWNER_JOB_COLUMNS)
    .single();
  if (error?.code === "23505") {
    // 0191's one-live-run-per-deck index: another start won the race.
    failed("busy");
    return { ok: false, code: "BUSY", error: "Another run of this deck has just started — wait for it, then try again." };
  }
  if (error || !jobRow) {
    console.error("[re-art] job insert failed:", error?.message);
    failed("job_not_saved");
    return { ok: false, error: "Couldn't start the run — try again." };
  }

  // Named cards that aren't a sample: a FIRST paint of them is `paint_one`,
  // a card Re-art has painted on this deck before is a `reroll` (the job's
  // own `request.reroll` says only "named cards", and is left as it is).
  const firstPaint = reroll && plan.entries.every((entry) => !entry.paintedBefore);
  track(access, parsed.data.sample ? "start_sample" : reroll ? (firstPaint ? "paint_one" : "reroll") : "start", {
    cards: plan.entries.length,
    makes,
    credits,
    skipped: plan.skipped.length,
    in_style: plan.inStyle,
    scope: parsed.data.scope ?? "all",
    preset: saved.preset,
    // How the prompts are made (0209): the template or the maker's own
    // prompt, and how many of the cards have words of their own.
    mode: saved.mode,
    own_words: plan.entries.filter((entry) => entry.ownWords).length,
    // Which model the run names (0211) — a code from the tool's own list.
    model: jobPlan.model,
    style_changed: plan.styleChanged,
    visibility: jobPlan.visibility,
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
    track(access, "restore_failed", { reason: "no_earlier_art" });
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
    track(access, "restore_failed", { reason: "art_changed" });
    return { ok: false, error: "This card has other art now — change it in the card's editor." };
  }
  const back = (card.back_face ?? null) as CardBackFace | null;
  const restoreBack = Boolean(back && painted.backArtUrl && back.art_url === painted.backArtUrl);
  const result = await updateCardAction(card.id, {
    art_url: painted.previousArtUrl,
    art_position: painted.previousArtPosition ?? fitArtToWindow(),
    artist_credit: painted.previousArtistCredit ?? null,
    ...(restoreBack && back
      ? {
          back_face: withBackArt(
            back,
            painted.previousBackArtUrl,
            (painted.previousBackArtPosition ?? fitArtToWindow()) as Json,
            painted.previousBackArtistCredit,
          ),
        }
      : {}),
  });
  if (!result.ok) {
    track(access, "restore_failed", { reason: "save_failed" });
    return { ok: false, error: result.formError ?? Object.values(result.fieldErrors ?? {})[0] ?? "Couldn't put the old art back." };
  }
  // The painted pictures go once nothing else of the maker's shows them (a
  // remix of this card shares its art file); the row says "kept its own
  // art" in this style (a full run leaves it alone, a re-roll paints it).
  await discardReartArtIfUnused(access.userId, painted.artUrl);
  if (restoreBack && painted.backArtUrl) await discardReartArtIfUnused(access.userId, painted.backArtUrl);
  await writePaintedCard(access.userId, deck.id, null, {
    cardId: card.id,
    entryId: painted.entryId,
    styleVersion: painted.styleVersion,
    artUrl: null,
    backArtUrl: null,
    imageModel: null,
    method: null,
    made: false,
    previousArtUrl: null,
    previousArtPosition: null,
    previousBackArtUrl: null,
    previousBackArtPosition: null,
    previousArtistCredit: null,
    previousBackArtistCredit: null,
  });
  track(access, "restore", { faces: restoreBack ? 2 : 1 });
  revalidatePath(toolHref(REART_TOOL_SLUG));
  return { ok: true };
}
