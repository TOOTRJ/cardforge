"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  createSetSchema,
  updateSetSchema,
} from "@/lib/validation/set";
import { slugify } from "@/lib/validation/card";
import {
  getSetById,
  isSetSlugTakenForCurrentUser,
} from "@/lib/sets/queries";
import type { CardSetInsert, CardSetUpdate } from "@/types/supabase";
import type { ZodIssue } from "zod";

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export type SetFieldErrors = Partial<Record<string, string>>;

export type SetActionFailure = {
  ok: false;
  formError?: string;
  fieldErrors?: SetFieldErrors;
};

export type CreateSetSuccess = { ok: true; setId: string; slug: string };
export type UpdateSetSuccess = { ok: true; setId: string; slug: string };
export type DeleteSetSuccess = { ok: true; setId: string };
export type SetItemSuccess = { ok: true; setId: string; cardId: string };

export type CreateSetResult = CreateSetSuccess | SetActionFailure;
export type UpdateSetResult = UpdateSetSuccess | SetActionFailure;
export type DeleteSetResult = DeleteSetSuccess | SetActionFailure;
export type SetItemResult = SetItemSuccess | SetActionFailure;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fieldErrorsFromZod(
  issues: ReadonlyArray<ZodIssue>,
): SetFieldErrors {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const segment = issue.path[0];
    if (typeof segment !== "string" && typeof segment !== "number") continue;
    const key = String(segment);
    if (key && !(key in errors)) errors[key] = issue.message;
  }
  return errors;
}

function notConfigured(): SetActionFailure {
  return {
    ok: false,
    formError:
      "Supabase isn't configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  };
}

function notAuthed(): SetActionFailure {
  return {
    ok: false,
    formError: "You must be signed in to do that.",
  };
}

async function ensureUniqueSetSlug(
  desired: string,
  excludeSetId?: string,
): Promise<string> {
  const taken = await isSetSlugTakenForCurrentUser(desired, excludeSetId);
  if (!taken) return desired;
  for (let attempt = 2; attempt <= 50; attempt += 1) {
    const candidate = `${desired}-${attempt}`.slice(0, 80);
    const stillTaken = await isSetSlugTakenForCurrentUser(
      candidate,
      excludeSetId,
    );
    if (!stillTaken) return candidate;
  }
  return desired;
}

async function getOwnerUsername(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();
    return data?.username ?? null;
  } catch {
    return null;
  }
}

function revalidateSetPaths(slug: string, ownerUsername?: string | null) {
  revalidatePath("/sets");
  revalidatePath("/dashboard");
  revalidatePath(`/set/${slug}`);
  revalidatePath(`/set/${slug}/edit`);
  if (ownerUsername) {
    revalidatePath(`/profile/${ownerUsername}`);
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createSetAction(
  payload: unknown,
  options: { redirectAfterCreate?: boolean } = {},
): Promise<CreateSetResult> {
  const parsed = createSetSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  if (!isSupabaseConfigured()) return notConfigured();
  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const supabase = await createClient();

  const desired = parsed.data.slug
    ? slugify(parsed.data.slug)
    : slugify(parsed.data.title);
  const slug = await ensureUniqueSetSlug(desired);

  const insert: CardSetInsert = {
    owner_id: user.id,
    title: parsed.data.title,
    slug,
    description: parsed.data.description ?? null,
    cover_url: parsed.data.cover_url ?? null,
    visibility: parsed.data.visibility,
  };

  const { data: row, error } = await supabase
    .from("card_sets")
    .insert(insert)
    .select("id, slug")
    .single();

  if (error || !row) {
    return { ok: false, formError: error?.message ?? "Could not create set." };
  }

  const ownerUsername = await getOwnerUsername();
  revalidateSetPaths(row.slug, ownerUsername);

  if (options.redirectAfterCreate) {
    redirect(`/set/${row.slug}/edit`);
  }
  return { ok: true, setId: row.id, slug: row.slug };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateSetAction(
  setId: string,
  payload: unknown,
): Promise<UpdateSetResult> {
  if (!UUID_PATTERN.test(setId)) {
    return { ok: false, formError: "Invalid set id." };
  }
  const parsed = updateSetSchema.safeParse(payload);
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
  const existing = await getSetById(setId);
  if (!existing || existing.owner_id !== user.id) {
    return { ok: false, formError: "Set not found or not yours to edit." };
  }

  const update: CardSetUpdate = {};
  if (data.title !== undefined) update.title = data.title;
  if (data.slug !== undefined) {
    const candidate = slugify(data.slug);
    update.slug = await ensureUniqueSetSlug(candidate, setId);
  }
  if (data.description !== undefined) update.description = data.description ?? null;
  if (data.cover_url !== undefined) update.cover_url = data.cover_url ?? null;
  if (data.visibility !== undefined) update.visibility = data.visibility;

  const { data: row, error } = await supabase
    .from("card_sets")
    .update(update)
    .eq("id", setId)
    .eq("owner_id", user.id)
    .select("id, slug")
    .single();

  if (error || !row) {
    return { ok: false, formError: error?.message ?? "Could not update set." };
  }

  const ownerUsername = await getOwnerUsername();
  revalidateSetPaths(row.slug, ownerUsername);
  if (existing.slug !== row.slug) {
    revalidatePath(`/set/${existing.slug}`);
    revalidatePath(`/set/${existing.slug}/edit`);
  }
  return { ok: true, setId: row.id, slug: row.slug };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteSetAction(
  setId: string,
): Promise<DeleteSetResult> {
  if (!UUID_PATTERN.test(setId)) {
    return { ok: false, formError: "Invalid set id." };
  }
  if (!isSupabaseConfigured()) return notConfigured();
  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const supabase = await createClient();
  const existing = await getSetById(setId);
  if (!existing || existing.owner_id !== user.id) {
    return { ok: false, formError: "Set not found or not yours to delete." };
  }

  const { error } = await supabase
    .from("card_sets")
    .delete()
    .eq("id", setId)
    .eq("owner_id", user.id);
  if (error) {
    return { ok: false, formError: error.message };
  }

  const ownerUsername = await getOwnerUsername();
  revalidateSetPaths(existing.slug, ownerUsername);
  return { ok: true, setId };
}

// ---------------------------------------------------------------------------
// Set items: add / remove
// ---------------------------------------------------------------------------

export async function addCardToSetAction(
  setId: string,
  cardId: string,
): Promise<SetItemResult> {
  if (!UUID_PATTERN.test(setId) || !UUID_PATTERN.test(cardId)) {
    return { ok: false, formError: "Invalid id." };
  }
  if (!isSupabaseConfigured()) return notConfigured();
  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const supabase = await createClient();

  // Pre-flight: confirm the user owns both the set and the card (RLS will
  // also reject otherwise, but a friendlier surface helps the UI).
  const [{ data: set }, { data: card }] = await Promise.all([
    supabase
      .from("card_sets")
      .select("id, slug, owner_id")
      .eq("id", setId)
      .maybeSingle(),
    supabase
      .from("cards")
      .select("id, owner_id")
      .eq("id", cardId)
      .maybeSingle(),
  ]);

  if (!set || set.owner_id !== user.id) {
    return { ok: false, formError: "Set not found or not yours." };
  }
  if (!card || card.owner_id !== user.id) {
    return {
      ok: false,
      formError: "You can only add cards you own to your sets.",
    };
  }

  const { error } = await supabase.from("card_set_items").insert({
    set_id: setId,
    card_id: cardId,
    position: 0,
  });

  if (error) {
    if (error.code === "23505") {
      // Already in the set — treat as success (idempotent).
      return { ok: true, setId, cardId };
    }
    return { ok: false, formError: error.message };
  }

  // Set's updated_at intentionally NOT touched here — that column tracks
  // metadata edits on the set itself, not membership changes. The set's
  // cards_count surfaces in listings via a separate count query.

  revalidatePath(`/set/${set.slug}`);
  revalidatePath(`/set/${set.slug}/edit`);
  revalidatePath("/sets");
  return { ok: true, setId, cardId };
}

export async function removeCardFromSetAction(
  setId: string,
  cardId: string,
): Promise<SetItemResult> {
  if (!UUID_PATTERN.test(setId) || !UUID_PATTERN.test(cardId)) {
    return { ok: false, formError: "Invalid id." };
  }
  if (!isSupabaseConfigured()) return notConfigured();
  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const supabase = await createClient();
  const { data: set } = await supabase
    .from("card_sets")
    .select("id, slug, owner_id")
    .eq("id", setId)
    .maybeSingle();
  if (!set || set.owner_id !== user.id) {
    return { ok: false, formError: "Set not found or not yours." };
  }

  const { error } = await supabase
    .from("card_set_items")
    .delete()
    .eq("set_id", setId)
    .eq("card_id", cardId);

  if (error) {
    return { ok: false, formError: error.message };
  }

  revalidatePath(`/set/${set.slug}`);
  revalidatePath(`/set/${set.slug}/edit`);
  revalidatePath("/sets");
  return { ok: true, setId, cardId };
}

/**
 * Convenience wrapper used by the card editor's "Add to set" affordance:
 * adds the card to the set then revalidates the card's view paths.
 */
export async function addCurrentCardToSetAction(
  cardSlug: string,
  setId: string,
  cardId: string,
): Promise<SetItemResult> {
  const result = await addCardToSetAction(setId, cardId);
  if (result.ok) {
    revalidatePath(`/card/${cardSlug}`);
    revalidatePath(`/card/${cardSlug}/edit`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Bulk add (Phase 11 chunk 08)
//
// Adds many cards to a single set in one go. Used by the dashboard's
// bulk-action bar. Posture matches the bulk card actions in
// lib/cards/actions.ts:
//   - Validate as Zod arrays-of-UUIDs (max 100)
//   - Pre-flight ownership on the set AND every card
//   - Single multi-row insert; already-existing membership rows are
//     silently skipped so the operation is idempotent (a follow-up
//     bulk-add of overlapping ids just no-ops the duplicates)
//   - New rows get positions appended to the end of the set (max + i)
// ---------------------------------------------------------------------------

const BULK_MAX_SET_CARDS = 100;

const bulkAddToSetSchema = z.object({
  setId: z.string().uuid("Invalid set id."),
  cardIds: z
    .array(z.string().uuid("Invalid card id."))
    .min(1, "Pick at least one card.")
    .max(BULK_MAX_SET_CARDS, `Up to ${BULK_MAX_SET_CARDS} cards at a time.`),
});

export type BulkAddToSetSuccess = {
  ok: true;
  setId: string;
  added: number;
  skipped: number;
};

export type BulkAddToSetFailure = {
  ok: false;
  error: string;
};

export type BulkAddToSetResult = BulkAddToSetSuccess | BulkAddToSetFailure;

export async function addCardsToSetAction(
  setId: string,
  cardIds: string[],
): Promise<BulkAddToSetResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to add cards to a set." };
  }

  const parsed = bulkAddToSetSchema.safeParse({ setId, cardIds });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }
  const ids = Array.from(new Set(parsed.data.cardIds));

  const supabase = await createClient();

  // Pre-flight ownership in parallel: set + every card.
  const [setResult, cardsResult, existingItemsResult] = await Promise.all([
    supabase
      .from("card_sets")
      .select("id, slug, owner_id")
      .eq("id", parsed.data.setId)
      .maybeSingle(),
    supabase
      .from("cards")
      .select("id, owner_id")
      .in("id", ids),
    // Cards already in this set — we skip them on insert to keep the
    // operation idempotent rather than failing on the unique constraint.
    supabase
      .from("card_set_items")
      .select("card_id, position")
      .eq("set_id", parsed.data.setId),
  ]);

  if (setResult.error) return { ok: false, error: setResult.error.message };
  if (!setResult.data || setResult.data.owner_id !== user.id) {
    return { ok: false, error: "Set not found or not yours." };
  }

  if (cardsResult.error) return { ok: false, error: cardsResult.error.message };
  const existingCards = cardsResult.data ?? [];
  if (existingCards.length !== ids.length) {
    return { ok: false, error: "Some cards weren't found." };
  }
  if (existingCards.some((c) => c.owner_id !== user.id)) {
    return { ok: false, error: "Some cards aren't yours to add." };
  }

  if (existingItemsResult.error) {
    return { ok: false, error: existingItemsResult.error.message };
  }
  const alreadyIn = new Set(
    (existingItemsResult.data ?? []).map((row) => row.card_id),
  );
  const maxPosition = (existingItemsResult.data ?? []).reduce(
    (max, row) => Math.max(max, row.position ?? 0),
    -1,
  );

  // Filter to the cards that aren't already in the set. If none remain,
  // we're done — same idempotent posture as the single-card insert.
  const toInsert = ids.filter((id) => !alreadyIn.has(id));
  if (toInsert.length === 0) {
    return {
      ok: true,
      setId: parsed.data.setId,
      added: 0,
      skipped: ids.length,
    };
  }

  const rows = toInsert.map((cardId, index) => ({
    set_id: parsed.data.setId,
    card_id: cardId,
    position: maxPosition + 1 + index,
  }));

  const { error: insertError } = await supabase
    .from("card_set_items")
    .insert(rows);
  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  revalidatePath(`/set/${setResult.data.slug}`);
  revalidatePath(`/set/${setResult.data.slug}/edit`);
  revalidatePath("/sets");
  revalidatePath("/dashboard");

  return {
    ok: true,
    setId: parsed.data.setId,
    added: toInsert.length,
    skipped: ids.length - toInsert.length,
  };
}

// ---------------------------------------------------------------------------
// Reorder (Phase 11 chunk 09)
//
// Drag-reorder cards within a set. The client supplies the new ORDER of
// card_set_items row ids; the server writes each row's `position` to its
// index in the array. Posture:
//   1. Validate (Zod): array of UUIDs, max 100
//   2. Verify the caller owns the set
//   3. Verify the supplied ids are EXACTLY the current set's items (a
//      permutation) — guards against stale optimistic state, mid-flight
//      additions, and outright bad client input
//   4. Parallel UPDATEs setting position = index. Each is bounded by
//      `.eq("set_id", setId)` so a malicious client can't move rows
//      from one set into another by spoofing their ids.
// ---------------------------------------------------------------------------

const reorderSetCardsSchema = z.object({
  setId: z.string().uuid("Invalid set id."),
  orderedItemIds: z
    .array(z.string().uuid("Invalid item id."))
    .min(1, "Provide at least one item id.")
    .max(BULK_MAX_SET_CARDS, `Up to ${BULK_MAX_SET_CARDS} items at a time.`),
});

export type ReorderSetCardsSuccess = {
  ok: true;
  setId: string;
  count: number;
};

export type ReorderSetCardsFailure = {
  ok: false;
  error: string;
};

export type ReorderSetCardsResult =
  | ReorderSetCardsSuccess
  | ReorderSetCardsFailure;

export async function reorderSetCardsAction(
  setId: string,
  orderedItemIds: string[],
): Promise<ReorderSetCardsResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to reorder cards." };
  }

  const parsed = reorderSetCardsSchema.safeParse({ setId, orderedItemIds });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  // Reject duplicate ids in the ordered list — that would either silently
  // collapse positions (one row's UPDATE wins) or indicate a buggy client.
  const uniqueIds = new Set(parsed.data.orderedItemIds);
  if (uniqueIds.size !== parsed.data.orderedItemIds.length) {
    return { ok: false, error: "Duplicate item ids in the order." };
  }

  const supabase = await createClient();

  // Ownership check on the set first — RLS would block the update anyway,
  // but the friendlier error message helps the UI.
  const { data: set, error: setError } = await supabase
    .from("card_sets")
    .select("id, slug, owner_id")
    .eq("id", parsed.data.setId)
    .maybeSingle();
  if (setError) return { ok: false, error: setError.message };
  if (!set || set.owner_id !== user.id) {
    return { ok: false, error: "Set not found or not yours." };
  }

  // Permutation check: the supplied ids must match the current set's
  // membership exactly. If the user added a card in another tab between
  // when the grid loaded and the drag completed, the lists won't match
  // and we abort with a "stale" hint so the UI can re-fetch.
  const { data: existingItems, error: itemsError } = await supabase
    .from("card_set_items")
    .select("id")
    .eq("set_id", parsed.data.setId);
  if (itemsError) return { ok: false, error: itemsError.message };
  const existingIds = new Set((existingItems ?? []).map((r) => r.id));
  if (existingIds.size !== uniqueIds.size) {
    return {
      ok: false,
      error: "Set membership changed — refresh and try again.",
    };
  }
  for (const id of uniqueIds) {
    if (!existingIds.has(id)) {
      return {
        ok: false,
        error: "Set membership changed — refresh and try again.",
      };
    }
  }

  // Parallel UPDATEs — each writes position = its index. Bounded by
  // set_id so a spoofed id can't repoint another set's row. For a 30-card
  // set this is ~30 round-trips over a single pooled connection, ~50-80ms
  // end-to-end on Supabase.
  const updates = parsed.data.orderedItemIds.map((itemId, position) =>
    supabase
      .from("card_set_items")
      .update({ position })
      .eq("id", itemId)
      .eq("set_id", parsed.data.setId),
  );
  const results = await Promise.all(updates);
  const failure = results.find((r) => r.error);
  if (failure?.error) {
    return { ok: false, error: failure.error.message };
  }

  // Bump the set's updated_at so listings reflect the recent activity.
  // RLS-bound update; same posture as updateSetAction.
  await supabase
    .from("card_sets")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", parsed.data.setId)
    .eq("owner_id", user.id);

  revalidatePath(`/set/${set.slug}`);
  revalidatePath(`/set/${set.slug}/edit`);
  revalidatePath("/sets");

  return {
    ok: true,
    setId: parsed.data.setId,
    count: parsed.data.orderedItemIds.length,
  };
}
