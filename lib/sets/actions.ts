"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
