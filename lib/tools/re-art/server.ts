import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { listDeckPageCards, type DeckItem, type DeckPageCard } from "@/lib/decks/queries";
import { checkScryfallRateLimit, logScryfallCall } from "@/lib/scryfall/rate-limit";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import { getEntitlements } from "@/lib/billing/entitlements";
import { rowHasBakedBack } from "@/lib/cards/faces";
import { isUuid } from "@/lib/ids";
import type { Json } from "@/types/supabase";
import { DEFAULT_BULK_CHOICES, type BulkChoices } from "@/lib/tools/bulk-customize/model";
import { planCustomizedCard } from "@/lib/tools/bulk-customize/planner";
import { fetchBulkPrintings, importPatchOf } from "@/lib/tools/bulk-customize/server";
import {
  REART_CREDITS_PER_FACE,
  REART_MAX_CARDS,
  REART_SKIP_COPY,
  classifyReartEntry,
  normalizeReartStyle,
  reartStyleProblem,
  sameReartStyle,
  scopeTakes,
  typeBucketOf,
  type ReartEntryKind,
  type ReartScope,
  type ReartStyle,
  type ReartVisibility,
} from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck's reads and writes (server only). Every read of the deck, its
// entries and its cards goes through the caller's OWN session (RLS: their
// deck, their cards); the tool's two tables (0191) are written with the
// service role after the caller's gate, and their triggers hold every row
// to the deck's and the card's owner.
// ---------------------------------------------------------------------------

export type ReartDeck = { id: string; slug: string; title: string; visibility: string };

/** The caller's own deck, or null. */
export async function getOwnedDeck(userId: string, deckId: string): Promise<ReartDeck | null> {
  if (!isUuid(deckId)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("decks")
    .select("id, slug, title, visibility")
    .eq("id", deckId)
    .eq("owner_id", userId)
    .maybeSingle();
  return data ? { id: data.id, slug: data.slug, title: data.title, visibility: data.visibility } : null;
}

export type StoredReartStyle = ReartStyle & { version: number };

/** The deck's stored style (the owner's session), or null. */
export async function readDeckStyle(deckId: string): Promise<StoredReartStyle | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deck_art_styles")
    .select("preset, theme, version")
    .eq("deck_id", deckId)
    .maybeSingle();
  return data ? { preset: data.preset, theme: data.theme, version: data.version } : null;
}

/** The deck's style as the SERVER reads it (a step: the stored row is the
 *  authority on the version a run paints in). */
export async function readDeckStyleAdmin(userId: string, deckId: string): Promise<StoredReartStyle | null> {
  if (!isAdminConfigured()) return null;
  const { data } = await createAdminClient()
    .from("deck_art_styles")
    .select("preset, theme, version, owner_id")
    .eq("deck_id", deckId)
    .maybeSingle();
  if (!data || data.owner_id !== userId) return null;
  return { preset: data.preset, theme: data.theme, version: data.version };
}

/**
 * The deck's style saved as `style`: the same style keeps its version; a
 * new one moves it on (a new look — cards painted in the old one are no
 * longer "in this style"). Returns the version, or null when it couldn't be
 * written.
 */
export async function saveDeckStyle(userId: string, deckId: string, style: ReartStyle): Promise<StoredReartStyle | null> {
  if (!isAdminConfigured()) return null;
  const clean = normalizeReartStyle(style);
  const admin = createAdminClient();
  const { data: stored } = await admin
    .from("deck_art_styles")
    .select("preset, theme, version, owner_id")
    .eq("deck_id", deckId)
    .maybeSingle();
  if (stored && stored.owner_id !== userId) return null;
  if (stored && sameReartStyle(stored, clean)) return { ...clean, version: stored.version };
  const version = stored ? stored.version + 1 : 1;
  const { error } = await admin
    .from("deck_art_styles")
    .upsert({ deck_id: deckId, owner_id: userId, preset: clean.preset, theme: clean.theme, version }, { onConflict: "deck_id" });
  if (error) {
    console.error(`[re-art] style for deck ${deckId} not saved: ${error.message}`);
    return null;
  }
  return { ...clean, version };
}

/** One card Re-art has painted on a deck (0191 deck_reart_cards). */
export type PaintedCard = {
  cardId: string;
  styleVersion: number;
  artUrl: string | null;
  backArtUrl: string | null;
  made: boolean;
  previousArtUrl: string | null;
  previousArtPosition: Json | null;
  previousBackArtUrl: string | null;
  previousBackArtPosition: Json | null;
  paintedAt: string;
};

type PaintedRow = {
  card_id: string;
  style_version: number;
  art_url: string | null;
  back_art_url: string | null;
  made: boolean;
  previous_art_url: string | null;
  previous_art_position: Json | null;
  previous_back_art_url: string | null;
  previous_back_art_position: Json | null;
  painted_at: string;
};

const PAINTED_COLUMNS =
  "card_id, style_version, art_url, back_art_url, made, previous_art_url, previous_art_position, previous_back_art_url, previous_back_art_position, painted_at";

function paintedOf(row: PaintedRow): PaintedCard {
  return {
    cardId: row.card_id,
    styleVersion: row.style_version,
    artUrl: row.art_url,
    backArtUrl: row.back_art_url,
    made: row.made,
    previousArtUrl: row.previous_art_url,
    previousArtPosition: row.previous_art_position,
    previousBackArtUrl: row.previous_back_art_url,
    previousBackArtPosition: row.previous_back_art_position,
    paintedAt: row.painted_at,
  };
}

/** The deck's painted cards (the owner's session), by card id. */
export async function readPaintedCards(deckId: string): Promise<Map<string, PaintedCard>> {
  const supabase = await createClient();
  const { data } = await supabase.from("deck_reart_cards").select(PAINTED_COLUMNS).eq("deck_id", deckId);
  return new Map(((data ?? []) as PaintedRow[]).map((row) => [row.card_id, paintedOf(row)]));
}

/** One painted card as the server reads it (a step). */
export async function readPaintedCardAdmin(userId: string, deckId: string, cardId: string): Promise<PaintedCard | null> {
  if (!isAdminConfigured()) return null;
  const { data } = await createAdminClient()
    .from("deck_reart_cards")
    .select(`${PAINTED_COLUMNS}, owner_id`)
    .eq("deck_id", deckId)
    .eq("card_id", cardId)
    .maybeSingle();
  if (!data || (data as { owner_id: string }).owner_id !== userId) return null;
  return paintedOf(data as PaintedRow);
}

/** Records (or replaces) a painted card. False when the write failed. */
export async function writePaintedCard(
  userId: string,
  deckId: string,
  jobId: string | null,
  painted: Omit<PaintedCard, "paintedAt">,
): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  const { error } = await createAdminClient()
    .from("deck_reart_cards")
    .upsert(
      {
        deck_id: deckId,
        card_id: painted.cardId,
        owner_id: userId,
        style_version: painted.styleVersion,
        job_id: jobId,
        art_url: painted.artUrl,
        back_art_url: painted.backArtUrl,
        made: painted.made,
        previous_art_url: painted.previousArtUrl,
        previous_art_position: painted.previousArtPosition,
        previous_back_art_url: painted.previousBackArtUrl,
        previous_back_art_position: painted.previousBackArtPosition,
        painted_at: new Date().toISOString(),
      },
      { onConflict: "deck_id,card_id" },
    );
  if (error) console.warn(`[re-art] painted card ${painted.cardId} on deck ${deckId} not recorded: ${error.message}`);
  return !error;
}

// ---------------------------------------------------------------------------
// Planning a run
// ---------------------------------------------------------------------------

/** The Bulk Customize choices a real card of a Re-art run is made with:
 *  everything as its printing has it, new AI art (the style block is the
 *  step's own prompt), the maker's visibility. */
export function reartBulkChoices(style: ReartStyle, visibility: ReartVisibility): BulkChoices {
  return { ...DEFAULT_BULK_CHOICES, art: "ai", artStyle: normalizeReartStyle(style).preset, visibility };
}

export type ReartPlannedEntry = {
  entryId: string;
  name: string;
  kind: Exclude<ReartEntryKind, "skip">;
  credits: number;
  /** The maker's own card (kind "own"). */
  cardId: string | null;
  /** Paint it even if it is in the style already (a sample, a re-roll). */
  repaint: boolean;
  notes: string[];
};

export type ReartPlan = {
  deck: ReartDeck;
  style: ReartStyle;
  /** The version the run paints in (the stored one, or the next). */
  version: number;
  styleChanged: boolean;
  entries: ReartPlannedEntry[];
  skipped: Array<{ name: string; reason: string }>;
  /** Cards left out because they are in this style already. */
  inStyle: number;
};

export type ReartPlanFailure = { ok: false; error: string; code?: "RATE_LIMITED"; retryAfterSeconds?: number };

/**
 * What a run over the deck paints, priced — the ONE plan the studio's
 * confirm (quota `deck_import`) and the start (`deck_import_commit`, which
 * decides) both read. Real cards are planned with Bulk Customize's own
 * planner on one Scryfall /cards/collection run; the maker's own cards are
 * read through their session.
 */
export async function planReartRun(
  userId: string,
  input: {
    deckId: string;
    style?: ReartStyle;
    scope: ReartScope;
    visibility: ReartVisibility;
    entryIds?: string[];
  },
  quota: "deck_import" | "deck_import_commit",
): Promise<({ ok: true } & ReartPlan) | ReartPlanFailure> {
  const deck = await getOwnedDeck(userId, input.deckId);
  if (!deck) return { ok: false, error: "That deck isn't one of yours." };
  const stored = await readDeckStyle(deck.id);
  const wanted = input.style ? normalizeReartStyle(input.style) : stored ? normalizeReartStyle(stored) : null;
  if (!wanted) return { ok: false, error: "Pick the deck's style first." };
  const problem = reartStyleProblem(wanted);
  if (problem) return { ok: false, error: problem };
  const styleChanged = !stored || !sameReartStyle(stored, wanted);
  const version = stored ? (styleChanged ? stored.version + 1 : stored.version) : 1;

  const [items, painted] = await Promise.all([listDeckPageCards(deck.id), readPaintedCards(deck.id)]);
  const explicit = input.entryIds ? new Set(input.entryIds.map((id) => id.toLowerCase())) : null;
  const chosen: DeckItem<DeckPageCard>[] = explicit
    ? items.filter((item) => explicit.has(item.entry.id.toLowerCase()))
    : items;
  const skipped: Array<{ name: string; reason: string }> = [];
  if (explicit && chosen.length < explicit.size) {
    skipped.push({ name: "A card", reason: "Not in this deck any more." });
  }

  const own: ReartPlannedEntry[] = [];
  const printings: DeckItem<DeckPageCard>[] = [];
  const seenCards = new Set<string>();
  let inStyle = 0;
  for (const item of chosen) {
    const { entry, card } = item;
    const classified = classifyReartEntry({
      board: entry.board,
      cardId: entry.card_id,
      scryfallId: entry.scryfall_id,
      typeLine: entry.type_line,
      card,
      ownerId: userId,
    });
    if (classified.kind === "skip") {
      // The maybeboard is said only when the maker picked one of its cards.
      if (classified.reason !== "maybeboard" || explicit) skipped.push({ name: entry.name, reason: classified.message });
      continue;
    }
    if (!explicit && !scopeTakes(input.scope, classified.kind)) continue;
    if (classified.kind === "own" && card) {
      if (seenCards.has(card.id)) continue;
      seenCards.add(card.id);
      const done = painted.get(card.id);
      if (!explicit && !styleChanged && done?.styleVersion === version) {
        inStyle += 1;
        continue;
      }
      const twoFaces = rowHasBakedBack(card);
      own.push({
        entryId: entry.id,
        name: card.title || entry.name,
        kind: "own",
        credits: REART_CREDITS_PER_FACE * (twoFaces ? 2 : 1),
        cardId: card.id,
        repaint: Boolean(explicit),
        notes: twoFaces ? ["Two faces: two pictures."] : [],
      });
      continue;
    }
    printings.push(item);
  }

  const planned: ReartPlannedEntry[] = [];
  if (printings.length > 0) {
    const limit = await checkScryfallRateLimit(userId, quota);
    if (!limit.ok) return { ok: false, error: limit.message, code: "RATE_LIMITED", retryAfterSeconds: limit.retryAfterSeconds };
    await logScryfallCall(userId, quota);
    const fetched = await fetchBulkPrintings(printings.map((item) => item.entry.scryfall_id!));
    if (!fetched) return { ok: false, error: "Scryfall didn't answer — try again in a moment." };
    const verifiedKeys = new Set(await getVerifiedFrameKeys());
    const entitlements = await getEntitlements();
    const choices = reartBulkChoices(wanted, input.visibility);
    for (const item of printings) {
      const { entry } = item;
      const card = fetched.get(entry.scryfall_id!.toLowerCase());
      if (!card) {
        skipped.push({ name: entry.name, reason: "Scryfall doesn't know this printing." });
        continue;
      }
      const plan = planCustomizedCard({
        patch: await importPatchOf(card, verifiedKeys),
        fallbackTitle: entry.name || card.name,
        scryfallSet: card.set ?? null,
        choices,
        verifiedKeys,
        removeWatermark: entitlements.removeWatermark,
      });
      if (!plan.ok) {
        skipped.push({ name: plan.title, reason: plan.message });
        continue;
      }
      if (plan.payload.card_type === "emblem") {
        skipped.push({ name: plan.title, reason: REART_SKIP_COPY.emblem });
        continue;
      }
      planned.push({
        entryId: entry.id,
        name: plan.title,
        kind: "printing",
        credits: plan.credits,
        cardId: null,
        repaint: Boolean(explicit),
        notes: plan.doubleFaced ? ["Two faces: two pictures."] : [],
      });
    }
  }

  // The deck's order: the commander first as the deck lists it.
  const order = new Map(chosen.map((item, index) => [item.entry.id, index]));
  let entries = [...own, ...planned].sort((a, b) => (order.get(a.entryId) ?? 0) - (order.get(b.entryId) ?? 0));
  if (entries.length > REART_MAX_CARDS) {
    skipped.push({
      name: `${entries.length - REART_MAX_CARDS} more cards`,
      reason: `One run paints up to ${REART_MAX_CARDS} cards — run it again for the rest.`,
    });
    entries = entries.slice(0, REART_MAX_CARDS);
  }
  return { ok: true, deck, style: wanted, version, styleChanged, entries, skipped, inStyle };
}

// ---------------------------------------------------------------------------
// The studio's reads
// ---------------------------------------------------------------------------

/** A past or paused run of the deck: when, how many cards, how many landed. */
export type ReartRun = {
  id: string;
  deckId: string | null;
  createdAt: string;
  cards: number;
  made: number;
  failed: number;
  waiting: number;
  sample: boolean;
  status: string;
};

type JobRowLite = { id: string; created_at: string; steps: unknown; request: unknown; status: string };

function runOf(row: JobRowLite): ReartRun {
  const steps = Array.isArray(row.steps) ? (row.steps as Array<{ status?: unknown }>) : [];
  const request = (row.request ?? {}) as { deck_id?: unknown; sample?: unknown };
  return {
    id: row.id,
    deckId: typeof request.deck_id === "string" ? request.deck_id : null,
    createdAt: row.created_at,
    cards: steps.length,
    made: steps.filter((step) => step?.status === "done").length,
    failed: steps.filter((step) => step?.status === "failed").length,
    waiting: steps.filter((step) => step?.status === "pending" || step?.status === "running").length,
    sample: request.sample === true,
    status: row.status,
  };
}

/** The caller's recent runs — of one deck, or of every deck (the tool
 *  page). Their own job rows, through their session; never the plan. */
export async function listReartRuns(userId: string, deckId: string | null, limit = 8): Promise<ReartRun[]> {
  const supabase = await createClient();
  let query = supabase
    .from("ai_generation_jobs")
    .select("id, created_at, steps, request, status")
    .eq("owner_id", userId)
    .eq("kind", "deck_reart");
  if (deckId) query = query.filter("request->>deck_id", "eq", deckId);
  const { data } = await query.order("created_at", { ascending: false }).limit(limit);
  return ((data ?? []) as JobRowLite[]).map(runOf);
}

/** A planned entry's words for the studio's confirm list. */
export type ReartPlanLine = Pick<ReartPlannedEntry, "entryId" | "name" | "kind" | "credits" | "notes">;

export function planLines(plan: ReartPlan): ReartPlanLine[] {
  return plan.entries.map(({ entryId, name, kind, credits, notes }) => ({ entryId, name, kind, credits, notes }));
}

/** A type bucket for the studio's sample, from what the entry knows. */
export function bucketOfItem(item: DeckItem<DeckPageCard>): string {
  return typeBucketOf(item.entry.type_line, item.card?.card_type ?? null);
}
