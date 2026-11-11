"use server";

import { createClient } from "@/lib/supabase/server";
import { checkScryfallRateLimit, logScryfallCall } from "@/lib/scryfall/rate-limit";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getCardCapacity } from "@/lib/cards/capacity";
import { describeCapacity, remainingCapacity, type CardCapacity } from "@/lib/billing/capacity-copy";
import { isBillingEnabled } from "@/lib/billing/flags";
import { DECK_CARDS_DAILY_LIMIT, checkDailyActionLimit, getFreshCreditBalance } from "@/lib/ai/rate-limit";
import { isGatewayConfigured } from "@/lib/ai/provider";
import { OWNER_JOB_COLUMNS } from "@/lib/ai/job-privacy";
import type { GenerationJobView, JobStep } from "@/lib/ai/generation-jobs";
import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import type { Json } from "@/types/supabase";
import { checkToolAccess } from "@/lib/tools/queries";
import { recordToolEventLater } from "@/lib/tools/events";
import {
  BULK_CUSTOMIZE_TOOL_SLUG,
  BULK_EXACT_COPY_CODE,
  BULK_EXACT_COPY_REASON,
  bulkChoicesSchema,
  bulkSourcesSchema,
  choicesChangeSomething,
  type BulkSource,
} from "@/lib/tools/bulk-customize/model";
import { planCustomizedCard } from "@/lib/tools/bulk-customize/planner";
import {
  fetchBulkPrintings,
  importPatchOf,
  printingThumbOf,
  resolveBulkSources,
  type SkippedBulkSource,
} from "@/lib/tools/bulk-customize/server";
import { bulkStepKey, type BulkCustomizeJobPlan } from "@/lib/tools/bulk-customize/step";

// ---------------------------------------------------------------------------
// Bulk Customize's two server actions. PREPARE reads the selection once —
// the caller's own rows, then ONE Scryfall /cards/collection run (the
// `deck_import` quota: a run, as a decklist's resolve) — and hands the
// dialog each card's import, so the dialog plans and prices every change of
// a choice in the browser with the same pure planner (no call per click).
// START does it all again on the server (the `deck_import_commit` quota, as
// a decklist's commit after its resolve) and is the one that decides: the
// exact-copy refusal, the saved-card limit, the credits, then the job row.
// Both start with the tool's gate, and both record how they ended after the
// response (`recordToolEventLater`, never awaited): `prepare` / `start` with
// their counts, or `prepare_failed` / `start_failed` with a `reason` code —
// never a card's name.
// ---------------------------------------------------------------------------

const NO_ACCESS = "Bulk Customize isn't open to you.";

type Access = NonNullable<Awaited<ReturnType<typeof checkToolAccess>>>;

/** One tool event of the viewer the gate let in, after the response. */
function record(access: Access, event: string, props: Record<string, string | number | boolean | null>): void {
  recordToolEventLater({ slug: BULK_CUSTOMIZE_TOOL_SLUG, userId: access.userId, event, access: access.via, props });
}

/** How many of a selection come from each door (a deck's entries, the
 *  collection, the tool page's search). */
function sourceCounts(sources: readonly BulkSource[]) {
  const count = (kind: BulkSource["kind"]) => sources.filter((source) => source.kind === kind).length;
  return { from_deck: count("deck_entry"), from_collection: count("collection"), from_search: count("scryfall") };
}

export type BulkPreparedCard = {
  key: string;
  source: BulkSource;
  name: string;
  setName: string | null;
  collectorNumber: string | null;
  thumbUrl: string | null;
  /** The creator's import of the printing (mapped + finalized). */
  patch: ScryfallImportPatch;
  scryfallSet: string | null;
};

export type BulkPrepared = {
  ok: true;
  cards: BulkPreparedCard[];
  skipped: SkippedBulkSource[];
  verifiedKeys: string[];
  removeWatermark: boolean;
  capacity: CardCapacity | null;
  /** The live balance, or null where credits aren't charged (billing off,
   *  admins). */
  credits: number | null;
  /** AI art can be painted on this deployment (the AI Gateway). */
  aiAvailable: boolean;
};

export type BulkFailure = {
  ok: false;
  error: string;
  code?: "EXACT_COPY" | "CARD_CAPACITY" | "INSUFFICIENT_CREDITS" | "RATE_LIMITED";
  retryAfterSeconds?: number;
};

export async function prepareBulkCustomizeAction(sourcesInput: unknown): Promise<BulkPrepared | BulkFailure> {
  const access = await checkToolAccess(BULK_CUSTOMIZE_TOOL_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = bulkSourcesSchema.safeParse(sourcesInput);
  if (!parsed.success) {
    record(access, "prepare_failed", { reason: "invalid" });
    return { ok: false, error: "Pick between 1 and 100 real cards." };
  }
  const from = sourceCounts(parsed.data);

  const { resolved, skipped } = await resolveBulkSources(access.userId, parsed.data);
  let cards: BulkPreparedCard[] = [];
  if (resolved.length > 0) {
    const limit = await checkScryfallRateLimit(access.userId, "deck_import");
    if (!limit.ok) {
      record(access, "prepare_failed", { reason: "rate_limited", cards: resolved.length, ...from });
      return { ok: false, error: limit.message, code: "RATE_LIMITED", retryAfterSeconds: limit.retryAfterSeconds };
    }
    await logScryfallCall(access.userId, "deck_import");
    const printings = await fetchBulkPrintings(resolved.map((source) => source.scryfallId));
    if (!printings) {
      record(access, "prepare_failed", { reason: "scryfall_unavailable", cards: resolved.length, ...from });
      return { ok: false, error: "Scryfall didn't answer — try again in a moment." };
    }
    const verifiedKeys = new Set(await getVerifiedFrameKeys());
    for (const source of resolved) {
      const card = printings.get(source.scryfallId.toLowerCase());
      if (!card) {
        skipped.push({ key: source.key, name: source.name || "A card", reason: "Scryfall doesn't know this printing." });
        continue;
      }
      cards.push({
        key: source.key,
        source: source.source,
        name: source.name || card.name,
        setName: card.set_name ?? null,
        collectorNumber: card.collector_number ?? null,
        thumbUrl: printingThumbOf(card),
        patch: await importPatchOf(card, verifiedKeys),
        scryfallSet: card.set ?? null,
      });
    }
    cards = cards.slice(0, 100);
  }

  const [verifiedKeys, entitlements, capacity, credits] = await Promise.all([
    getVerifiedFrameKeys(),
    getEntitlements(),
    getCardCapacity(),
    getFreshCreditBalance(),
  ]);
  record(access, "prepare", { cards: cards.length, skipped: skipped.length, ...from });
  return {
    ok: true,
    cards,
    skipped,
    verifiedKeys,
    removeWatermark: entitlements.removeWatermark,
    capacity,
    credits,
    aiAvailable: isGatewayConfigured(),
  };
}

export type BulkStarted = {
  ok: true;
  job: GenerationJobView;
  /** The cards left out (unchanged, not found), with why. */
  skipped: Array<{ name: string; reason: string }>;
  credits: number;
};

export async function startBulkCustomizeAction(input: unknown): Promise<BulkStarted | BulkFailure> {
  const access = await checkToolAccess(BULK_CUSTOMIZE_TOOL_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const body = (input ?? {}) as { sources?: unknown; choices?: unknown };
  const sources = bulkSourcesSchema.safeParse(body.sources);
  const choices = bulkChoicesSchema.safeParse(body.choices);
  if (!sources.success || !choices.success) {
    record(access, "start_failed", { reason: "invalid" });
    return { ok: false, error: "That batch couldn't be read — open the dialog again." };
  }
  /** A batch that didn't start, with why and what it asked for. */
  const refused = (reason: string, props: Record<string, number> = {}) =>
    record(access, "start_failed", {
      reason,
      selected: sources.data.length,
      look: choices.data.look,
      art: choices.data.art,
      ...props,
    });

  // A batch that changes nothing is a set of exact copies: refused at the
  // door (the card action's EXACT_COPY, lib/cards/exact-copy.ts).
  if (!choicesChangeSomething(choices.data)) {
    refused("exact_copy");
    return { ok: false, code: BULK_EXACT_COPY_CODE, error: BULK_EXACT_COPY_REASON };
  }
  if (choices.data.art === "ai" && !isGatewayConfigured()) {
    refused("ai_unavailable");
    return { ok: false, error: "AI art isn't available right now — pick another art choice." };
  }

  const { resolved, skipped: skippedSources } = await resolveBulkSources(access.userId, sources.data);
  const skipped: Array<{ name: string; reason: string }> = skippedSources.map(({ name, reason }) => ({ name, reason }));
  if (resolved.length === 0) {
    refused("no_cards", { skipped: skipped.length });
    return { ok: false, error: skipped[0]?.reason ?? "None of these cards can be customized." };
  }

  const limit = await checkScryfallRateLimit(access.userId, "deck_import_commit");
  if (!limit.ok) {
    refused("rate_limited", { cards: resolved.length });
    return { ok: false, error: limit.message, code: "RATE_LIMITED", retryAfterSeconds: limit.retryAfterSeconds };
  }
  await logScryfallCall(access.userId, "deck_import_commit");
  const printings = await fetchBulkPrintings(resolved.map((source) => source.scryfallId));
  if (!printings) {
    refused("scryfall_unavailable", { cards: resolved.length });
    return { ok: false, error: "Scryfall didn't answer — try again in a moment." };
  }

  const verifiedKeys = new Set(await getVerifiedFrameKeys());
  const entitlements = await getEntitlements();
  const entries: BulkCustomizeJobPlan["entries"] = [];
  for (const source of resolved) {
    const card = printings.get(source.scryfallId.toLowerCase());
    if (!card) {
      skipped.push({ name: source.name || "A card", reason: "Scryfall doesn't know this printing." });
      continue;
    }
    const planned = planCustomizedCard({
      patch: await importPatchOf(card, verifiedKeys),
      fallbackTitle: source.name || card.name,
      scryfallSet: card.set ?? null,
      choices: choices.data,
      verifiedKeys,
      removeWatermark: entitlements.removeWatermark,
    });
    if (!planned.ok) {
      skipped.push({ name: planned.title, reason: planned.message });
      continue;
    }
    entries.push({ source: source.source, name: planned.title, credits: planned.credits });
  }
  if (entries.length === 0) {
    // Every card came out unchanged (or unknown to Scryfall).
    refused("nothing_changes", { skipped: skipped.length });
    return {
      ok: false,
      code: BULK_EXACT_COPY_CODE,
      error: skipped[0]?.reason ?? BULK_EXACT_COPY_REASON,
    };
  }

  // The saved-card limit: the whole batch must fit (the database holds the
  // cap at each insert too, and a step stops the run on it).
  const capacity = await getCardCapacity();
  const room = capacity ? remainingCapacity(capacity) : null;
  if (room !== null && entries.length > room) {
    refused("capacity", { cards: entries.length, slots_left: room });
    return {
      ok: false,
      code: "CARD_CAPACITY",
      error:
        describeCapacity(capacity, entries.length)?.message ??
        "This batch needs more card slots than your plan has left.",
    };
  }

  // The credits, priced here before anything is made; each step reserves
  // its own and is refunded if it fails.
  const credits = entries.reduce((sum, entry) => sum + entry.credits, 0);
  if (credits > 0) {
    if (!isBillingEnabled()) {
      const daily = await checkDailyActionLimit(access.userId, "bulk_customize_art", DECK_CARDS_DAILY_LIMIT, "AI pictures");
      if (!daily.ok) {
        refused("daily_limit", { cards: entries.length, credits });
        return { ok: false, error: daily.message, code: "RATE_LIMITED", retryAfterSeconds: daily.retryAfterSeconds };
      }
    } else {
      const balance = await getFreshCreditBalance();
      if (balance !== null && balance < credits) {
        refused("insufficient_credits", { cards: entries.length, credits, balance });
        return {
          ok: false,
          code: "INSUFFICIENT_CREDITS",
          error: `This batch costs ${credits} credit${credits === 1 ? "" : "s"} and you have ${balance}.`,
        };
      }
    }
  }

  const plan: BulkCustomizeJobPlan = { choices: choices.data, entries, skipped: skipped.length };
  const steps: JobStep[] = entries.map((entry, index) => ({
    key: bulkStepKey(index),
    label: entry.name,
    status: "pending" as const,
    ...(entry.credits > 1 ? { credits: entry.credits } : {}),
  }));
  const supabase = await createClient();
  const { data: jobRow, error } = await supabase
    .from("ai_generation_jobs")
    .insert({
      owner_id: access.userId,
      kind: "bulk_customize",
      status: "generating",
      request: {
        tool: BULK_CUSTOMIZE_TOOL_SLUG,
        cards: entries.length,
        skipped: skipped.length,
        look: choices.data.look,
        art: choices.data.art,
      },
      plan: plan as unknown as Json,
      steps: steps as unknown as Json,
      deck_id: null,
    })
    .select(OWNER_JOB_COLUMNS)
    .single();
  if (error || !jobRow) {
    console.error("[bulk-customize] job insert failed:", error?.message);
    refused("job_not_created", { cards: entries.length, credits });
    return { ok: false, error: "Couldn't start the batch — try again." };
  }

  // `credits` here is the batch's PRICE (nothing is charged yet — each step
  // reserves its own); what a run really spent is `run_finished`'s.
  record(access, "start", {
    cards: entries.length,
    skipped: skipped.length,
    credits,
    look: choices.data.look,
    border: choices.data.border,
    set_symbol: choices.data.setSymbol,
    watermark: choices.data.watermark,
    art: choices.data.art,
    style: choices.data.art === "ai" ? choices.data.artStyle : null,
    visibility: choices.data.visibility,
  });
  return { ok: true, job: jobRow as unknown as GenerationJobView, skipped, credits };
}
