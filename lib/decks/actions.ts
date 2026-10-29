"use server";

import { revalidatePath } from "next/cache";
import { revalidateDeckPaths } from "@/lib/decks/revalidate";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser, getCurrentUsername } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createDeckSchema, updateDeckSchema } from "@/lib/validation/deck";
import { slugify } from "@/lib/validation/card";
import { getDeckById } from "@/lib/decks/queries";
import type { DeckInsert, DeckUpdate } from "@/types/supabase";
import type { ZodIssue } from "zod";
import { isUuid } from "@/lib/ids";
import { mediaUrlViolationField, refusedDeckCoverMessage } from "@/lib/media/media-url-errors";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { recordFunnelEvent } from "@/lib/analytics/funnel-server";
import { addCustomCardEntryToDeck } from "@/lib/decks/membership";
import { FIRST_CARD_NOT_COMMANDER, firstCardBoard } from "@/lib/decks/first-card";
import type { DeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// Result shapes — discriminated unions so callers pattern-match without throwing.
// ---------------------------------------------------------------------------

type DeckFieldErrors = Partial<Record<string, string>>;

type DeckActionFailure = {
  ok: false;
  formError?: string;
  fieldErrors?: DeckFieldErrors;
  /** "AUTH_REQUIRED" when nobody is signed in — the New deck dialog asks the
   *  visitor to sign up or sign in instead (TODO DK4.3). */
  code?: "AUTH_REQUIRED";
};

/** Where a deck was made from — a funnel prop only (allow-listed, sanitized
 *  again by recordFunnelEvent); it never changes what the action does. */
export type DeckCreateSurface = "dialog" | "creator" | "ai" | "my_cards" | "gallery";

type CreateDeckSuccess = {
  ok: true;
  deckId: string;
  slug: string;
  /** Only when `firstCardId` was asked for and could not be added: why. The
   *  deck is made all the same. */
  firstCardError?: string;
  /** Only when the first card WAS added but couldn't be set as the deck's
   *  commander (lib/decks/first-card.ts): one plain sentence to show. The
   *  card is on the main board. */
  firstCardNotice?: string;
};
type UpdateDeckSuccess = { ok: true; deckId: string; slug: string };
type DeleteDeckSuccess = { ok: true; deckId: string };

export type CreateDeckResult = CreateDeckSuccess | DeckActionFailure;
export type UpdateDeckResult = UpdateDeckSuccess | DeckActionFailure;
export type DeleteDeckResult = DeleteDeckSuccess | DeckActionFailure;

// Postgres unique-constraint violation.
const UNIQUE_VIOLATION = "23505";

// Deck slugs are globally unique (migration 0055). A pre-flight existence
// check can't see other owners' private decks through RLS, so uniqueness is
// resolved by attempting the write and retrying with a numeric suffix on the
// unique violation.
const MAX_SLUG_ATTEMPTS = 50;

function fieldErrorsFromZod(issues: ReadonlyArray<ZodIssue>): DeckFieldErrors {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const segment = issue.path[0];
    if (typeof segment !== "string" && typeof segment !== "number") continue;
    const key = String(segment);
    if (key && !(key in errors)) errors[key] = issue.message;
  }
  return errors;
}

function notConfigured(): DeckActionFailure {
  return {
    ok: false,
    formError:
      "Supabase isn't configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
  };
}

function notAuthed(): DeckActionFailure {
  return {
    ok: false,
    code: "AUTH_REQUIRED",
    formError: "You must be signed in to do that.",
  };
}

/** Funnel rows (TODO DK3.8). Best effort; never touches the write. */
async function recordDeckEvent(
  event: "deck_created",
  userId: string,
  props: Record<string, string | undefined>,
): Promise<void> {
  if (!isAdminConfigured()) return;
  await recordFunnelEvent(createAdminClient(), { event, userId, props });
}

function slugCandidate(desired: string, attempt: number): string {
  if (attempt === 1) return desired;
  const suffix = `-${attempt}`;
  // Trim any hyphen the cut leaves at the end — "my-deck-" + "-2" would fail
  // the decks_slug_format CHECK with a raw Postgres error.
  return `${desired.slice(0, 80 - suffix.length).replace(/-+$/, "")}${suffix}`;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createDeckAction(
  payload: unknown,
  options: {
    redirectAfterCreate?: boolean;
    surface?: DeckCreateSurface;
    /** A saved card the deck starts with (the New deck dialog's `cardId`:
     *  "Build a deck around this card", TODO DK8.3). Added to the main board
     *  once the deck exists — best effort, never fails the create. */
    firstCardId?: string;
    /** The New deck dialog's retry after a create whose ANSWER was lost (the
     *  network): the same owner's deck with the same name, format and
     *  visibility made in the last minute is that create — it is returned
     *  instead of a second deck. Never sent on a first press. */
    reuseRecentTwin?: boolean;
  } = {},
): Promise<CreateDeckResult> {
  const parsed = createDeckSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  if (!isSupabaseConfigured()) return notConfigured();
  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const supabase = await createClient();

  const desired =
    slugify(parsed.data.slug ?? parsed.data.title).slice(0, 80) || "deck";

  const insert: DeckInsert = {
    owner_id: user.id,
    title: parsed.data.title,
    slug: desired,
    description: parsed.data.description ?? null,
    cover_url: parsed.data.cover_url ?? null,
    cover_position: parsed.data.cover_position ?? null,
    format: parsed.data.format,
    visibility: parsed.data.visibility,
    deck_type: parsed.data.deck_type ?? null,
    bracket: parsed.data.bracket ?? null,
  };

  let row: { id: string; slug: string } | null = options.reuseRecentTwin
    ? await recentTwinDeck(supabase, insert)
    : null;
  const reused = row !== null;
  let lastError: string | null = null;
  for (let attempt = 1; !row && attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase
      .from("decks")
      .insert({ ...insert, slug: slugCandidate(desired, attempt) })
      .select("id, slug")
      .single();
    if (data) {
      row = data;
      break;
    }
    lastError = error?.message ?? null;
    if (error?.code !== UNIQUE_VIOLATION) break;
  }

  if (!row && mediaUrlViolationField(lastError)) {
    // Migration 0127: a cover that isn't one of the user's own uploads — or
    // a built-in background on a database 0150 hasn't reached.
    return { ok: false, fieldErrors: { cover_url: refusedDeckCoverMessage(insert.cover_url) } };
  }
  if (!row) {
    return { ok: false, formError: lastError ?? "Could not create deck." };
  }

  if (!reused) {
    const ownerUsername = await getCurrentUsername();
    revalidateDeckPaths(row.slug, ownerUsername);
    await recordDeckEvent("deck_created", user.id, {
      visibility: insert.visibility,
      format: insert.format,
      surface: options.surface,
    });
  }

  // add_custom_deck_entry adds nothing when the card is in the deck already
  // (a reused twin), so this is safe to run again.
  const firstCard = options.firstCardId
    ? await addFirstCard(supabase, user.id, row.id, options.firstCardId, parsed.data.format)
    : null;

  if (options.redirectAfterCreate) {
    redirect(`/deck/${row.slug}/edit`);
  }
  return { ok: true, deckId: row.id, slug: row.slug, ...firstCard };
}

/** How far back a lost create's twin is looked for (reuseRecentTwin). */
const TWIN_WINDOW_MS = 60_000;

/** The caller's deck with this name, format and visibility made within the
 *  last minute — the create a lost answer hid — or null. */
async function recentTwinDeck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  insert: DeckInsert,
): Promise<{ id: string; slug: string } | null> {
  const { data } = await supabase
    .from("decks")
    .select("id, slug")
    .eq("owner_id", insert.owner_id)
    .eq("title", insert.title)
    .eq("format", insert.format ?? "commander")
    .eq("visibility", insert.visibility ?? "public")
    .gte("created_at", new Date(Date.now() - TWIN_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** The card a new deck starts with, through the RPC the creator's "add to
 *  deck" uses (`add_custom_deck_entry`: the per-deck lock, the entry cap).
 *  RLS reads the caller back ANY card it may see — another creator's
 *  unlisted one included — and the deck_cards policies and 0144's
 *  `deck_card_not_linkable` guard decide whether it may join (the caller's
 *  own at any visibility, another creator's only while public). The card
 *  that leads a deck of its format (lib/decks/first-card.ts) is then moved
 *  to the commander zone (the RPC adds to the main board only) — best
 *  effort: a refused move leaves it on the main board, the add kept, and
 *  says so (`firstCardNotice`). Null when it all went in; else ONE plain
 *  sentence — never a database error's words (a new deck is far from the
 *  entry limit, the one refusal worth its own copy). */
async function addFirstCard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  deckId: string,
  cardId: string,
  format: DeckFormat,
): Promise<{ firstCardError: string } | { firstCardNotice: string } | null> {
  const unavailable = { firstCardError: "That card couldn't be added — add it from the deck page." };
  if (!isUuid(cardId)) return unavailable;
  const { data: card } = await supabase
    .from("cards")
    .select("id, title, card_type, supertype")
    .eq("id", cardId)
    .maybeSingle();
  if (!card) return unavailable;
  const added = await addCustomCardEntryToDeck(supabase, userId, deckId, card.id, card.title);
  if (!added.ok) return unavailable;
  if (firstCardBoard(format, card) === "commander") {
    // No row matched is no failure: a reused twin's card is in the zone
    // already (the RPC added nothing to the main board). An error is.
    const { error } = await supabase
      .from("deck_cards")
      .update({ board: "commander" })
      .eq("deck_id", deckId)
      .eq("card_id", card.id)
      .eq("board", "main");
    if (error) return { firstCardNotice: FIRST_CARD_NOT_COMMANDER };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateDeckAction(
  deckId: string,
  payload: unknown,
): Promise<UpdateDeckResult> {
  if (!isUuid(deckId)) {
    return { ok: false, formError: "Invalid deck id." };
  }
  const parsed = updateDeckSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }
  const data = parsed.data;
  if (Object.keys(data).length === 0) {
    return { ok: false, formError: "No changes provided." };
  }

  if (!isSupabaseConfigured()) return notConfigured();
  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const supabase = await createClient();
  const existing = await getDeckById(deckId);
  if (!existing || existing.owner_id !== user.id) {
    return { ok: false, formError: "Deck not found or not yours to edit." };
  }

  const update: DeckUpdate = {};
  if (data.title !== undefined) update.title = data.title;
  if (data.description !== undefined)
    update.description = data.description ?? null;
  if (data.cover_url !== undefined) update.cover_url = data.cover_url ?? null;
  if (data.cover_position !== undefined)
    update.cover_position = data.cover_position ?? null;
  if (data.deck_type !== undefined) update.deck_type = data.deck_type ?? null;
  if (data.bracket !== undefined) update.bracket = data.bracket ?? null;
  if (data.format !== undefined) update.format = data.format;
  if (data.visibility !== undefined) update.visibility = data.visibility;

  const desiredSlug =
    data.slug !== undefined ? slugify(data.slug).slice(0, 80) || null : null;
  const changingSlug = desiredSlug !== null && desiredSlug !== existing.slug;

  let row: { id: string; slug: string } | null = null;
  let lastError: string | null = null;
  const attempts = changingSlug ? MAX_SLUG_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const candidate = changingSlug
      ? { ...update, slug: slugCandidate(desiredSlug, attempt) }
      : update;
    const { data: updated, error } = await supabase
      .from("decks")
      .update(candidate)
      .eq("id", deckId)
      .eq("owner_id", user.id)
      .select("id, slug")
      .single();
    if (updated) {
      row = updated;
      break;
    }
    lastError = error?.message ?? null;
    if (error?.code !== UNIQUE_VIOLATION) break;
  }

  if (!row && mediaUrlViolationField(lastError)) {
    // Migration 0127: a cover that isn't one of the user's own uploads — or
    // a built-in background on a database 0150 hasn't reached.
    return { ok: false, fieldErrors: { cover_url: refusedDeckCoverMessage(update.cover_url) } };
  }
  if (!row) {
    return { ok: false, formError: lastError ?? "Could not update deck." };
  }

  const ownerUsername = await getCurrentUsername();
  revalidateDeckPaths(row.slug, ownerUsername);
  if (existing.slug !== row.slug) {
    revalidatePath(`/deck/${existing.slug}`);
    revalidatePath(`/deck/${existing.slug}/edit`);
  }

  return { ok: true, deckId: row.id, slug: row.slug };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteDeckAction(
  deckId: string,
): Promise<DeleteDeckResult> {
  if (!isUuid(deckId)) {
    return { ok: false, formError: "Invalid deck id." };
  }
  if (!isSupabaseConfigured()) return notConfigured();
  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const supabase = await createClient();
  const existing = await getDeckById(deckId);
  if (!existing || existing.owner_id !== user.id) {
    return { ok: false, formError: "Deck not found or not yours to delete." };
  }

  const { error } = await supabase
    .from("decks")
    .delete()
    .eq("id", deckId)
    .eq("owner_id", user.id);
  if (error) {
    return { ok: false, formError: error.message };
  }

  const ownerUsername = await getCurrentUsername();
  revalidateDeckPaths(existing.slug, ownerUsername);
  return { ok: true, deckId };
}
