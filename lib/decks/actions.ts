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
import { MEDIA_URL_NOT_ALLOWED_MESSAGE, mediaUrlViolationField } from "@/lib/media/media-url-errors";
import { getEntitlements, type Entitlements } from "@/lib/billing/entitlements";
import { CARD_CAPACITY_UNLIMITED } from "@/lib/billing/plans";
import {
  deckCapacityRefusal,
  deckCountsTowardCap,
  isDeckCapacityViolation,
} from "@/lib/billing/deck-capacity-copy";
import { countCappedDecks } from "@/lib/decks/capacity";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { recordFunnelEvent } from "@/lib/analytics/funnel-server";
import { addCustomCardEntryToDeck } from "@/lib/decks/membership";

// ---------------------------------------------------------------------------
// Result shapes — discriminated unions so callers pattern-match without throwing.
// ---------------------------------------------------------------------------

type DeckFieldErrors = Partial<Record<string, string>>;

type DeckActionFailure = {
  ok: false;
  formError?: string;
  fieldErrors?: DeckFieldErrors;
  /** "UPGRADE_REQUIRED" when a plan with more room is needed — the UI opens
   *  the upgrade modal instead of only showing the error. "AUTH_REQUIRED"
   *  when nobody is signed in — the New deck dialog asks the visitor to
   *  sign up or sign in instead (TODO DK4.3). */
  code?: "UPGRADE_REQUIRED" | "AUTH_REQUIRED";
  /** Which limit was hit: the private-deck cap (migration 0145). */
  reason?: "deck_capacity";
};

/** Where a deck was made from — a funnel prop only (allow-listed, sanitized
 *  again by recordFunnelEvent); it never changes what the action does. */
export type DeckCreateSurface = "dialog" | "creator" | "ai";

type CreateDeckSuccess = {
  ok: true;
  deckId: string;
  slug: string;
  /** Only when `firstCardId` was asked for and could not be added: why. The
   *  deck is made all the same. */
  firstCardError?: string;
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

// ---------------------------------------------------------------------------
// The private-deck cap (owner decision D1, 2026-10-28; migration 0145). The
// pre-check reads the plan so the common case gets the friendly refusal
// without a round trip; the database trigger is the backstop the pre-check
// can lose a race to (and the only check while billing is off, when every
// entitlement reads unlimited — 0104's posture for saved cards).
// ---------------------------------------------------------------------------

function deckCapacityFailure(entitlements: Pick<Entitlements, "deckCapacity" | "effectiveTier">): DeckActionFailure {
  return {
    ok: false,
    code: "UPGRADE_REQUIRED",
    reason: "deck_capacity",
    formError: deckCapacityRefusal(
      entitlements.deckCapacity === CARD_CAPACITY_UNLIMITED
        ? null
        : { cap: entitlements.deckCapacity, tier: entitlements.effectiveTier },
    ),
  };
}

/** True when the plan leaves no room for one more private / unlisted deck.
 *  An unreadable count lets the write go on: the trigger still decides. */
async function deckCapacityFull(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  entitlements: Pick<Entitlements, "deckCapacity">,
): Promise<boolean> {
  if (entitlements.deckCapacity === CARD_CAPACITY_UNLIMITED) return false;
  const used = await countCappedDecks(supabase, userId);
  return used !== null && used >= entitlements.deckCapacity;
}

/** Funnel rows (TODO DK3.8). Best effort; never touches the write. */
async function recordDeckEvent(
  event: "deck_created" | "deck_cap_hit",
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

  // A private or unlisted deck takes one of the plan's private slots; a
  // public deck never does (D1).
  const capped = deckCountsTowardCap(insert.visibility ?? "private");
  const entitlements = capped ? await getEntitlements() : null;
  const capHit = () =>
    recordDeckEvent("deck_cap_hit", user.id, {
      kind: "create",
      visibility: insert.visibility,
      tier: entitlements?.effectiveTier,
      surface: options.surface,
    });
  if (entitlements && (await deckCapacityFull(supabase, user.id, entitlements))) {
    await capHit();
    return deckCapacityFailure(entitlements);
  }

  let row: { id: string; slug: string } | null = null;
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
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

  // The database enforces the cap too (migration 0145) — the pre-check above
  // can lose a race between two creates, the trigger can't.
  if (!row && isDeckCapacityViolation(lastError)) {
    await capHit();
    return deckCapacityFailure(entitlements ?? (await getEntitlements()));
  }
  if (!row && mediaUrlViolationField(lastError)) {
    // Migration 0127: a cover that isn't one of the user's own uploads.
    return { ok: false, fieldErrors: { cover_url: MEDIA_URL_NOT_ALLOWED_MESSAGE } };
  }
  if (!row) {
    return { ok: false, formError: lastError ?? "Could not create deck." };
  }

  const ownerUsername = await getCurrentUsername();
  revalidateDeckPaths(row.slug, ownerUsername);
  await recordDeckEvent("deck_created", user.id, {
    visibility: insert.visibility,
    format: insert.format,
    surface: options.surface,
  });

  const firstCardError = options.firstCardId
    ? await addFirstCard(supabase, user.id, row.id, options.firstCardId)
    : null;

  if (options.redirectAfterCreate) {
    redirect(`/deck/${row.slug}/edit`);
  }
  return firstCardError
    ? { ok: true, deckId: row.id, slug: row.slug, firstCardError }
    : { ok: true, deckId: row.id, slug: row.slug };
}

/** The card a new deck starts with, through the RPC the creator's "add to
 *  deck" uses (`add_custom_deck_entry`: the per-deck lock, the entry cap).
 *  The card is read through RLS — the caller's own, or a public one — and
 *  the deck_cards policies decide whether it may join. Null when added,
 *  else why not. */
async function addFirstCard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  deckId: string,
  cardId: string,
): Promise<string | null> {
  const unavailable = "That card couldn't be added — add it from the deck page.";
  if (!isUuid(cardId)) return unavailable;
  const { data: card } = await supabase.from("cards").select("id, title").eq("id", cardId).maybeSingle();
  if (!card) return unavailable;
  const added = await addCustomCardEntryToDeck(supabase, userId, deckId, card.id, card.title);
  return added.ok ? null : (added.error ?? unavailable);
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

  // A public deck turned private or unlisted joins the plan's private decks
  // (D1). Switching between private and unlisted, or re-sending the stored
  // value (the details form sends it every time), adds nothing — a deck over
  // the cap stays editable (grandfathered, TODO DK3.4).
  const joiningCap =
    data.visibility !== undefined &&
    !deckCountsTowardCap(existing.visibility) &&
    deckCountsTowardCap(data.visibility);
  const entitlements = joiningCap ? await getEntitlements() : null;
  const capHit = () =>
    recordDeckEvent("deck_cap_hit", user.id, {
      kind: "visibility",
      visibility: data.visibility,
      tier: entitlements?.effectiveTier,
    });
  if (entitlements && (await deckCapacityFull(supabase, user.id, entitlements))) {
    await capHit();
    return deckCapacityFailure(entitlements);
  }

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

  if (!row && isDeckCapacityViolation(lastError)) {
    await capHit();
    return deckCapacityFailure(entitlements ?? (await getEntitlements()));
  }
  if (!row && mediaUrlViolationField(lastError)) {
    // Migration 0127: a cover that isn't one of the user's own uploads.
    return { ok: false, fieldErrors: { cover_url: MEDIA_URL_NOT_ALLOWED_MESSAGE } };
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
