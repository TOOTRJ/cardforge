"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createDeckSchema, updateDeckSchema } from "@/lib/validation/deck";
import { slugify } from "@/lib/validation/card";
import { getDeckById } from "@/lib/decks/queries";
import type { DeckInsert, DeckUpdate } from "@/types/supabase";
import type { ZodIssue } from "zod";

// ---------------------------------------------------------------------------
// Result shapes — same discriminated-union posture as lib/sets/actions.ts.
// ---------------------------------------------------------------------------

export type DeckFieldErrors = Partial<Record<string, string>>;

export type DeckActionFailure = {
  ok: false;
  formError?: string;
  fieldErrors?: DeckFieldErrors;
};

export type CreateDeckSuccess = { ok: true; deckId: string; slug: string };
export type UpdateDeckSuccess = { ok: true; deckId: string; slug: string };
export type DeleteDeckSuccess = { ok: true; deckId: string };

export type CreateDeckResult = CreateDeckSuccess | DeckActionFailure;
export type UpdateDeckResult = UpdateDeckSuccess | DeckActionFailure;
export type DeleteDeckResult = DeleteDeckSuccess | DeckActionFailure;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    formError: "You must be signed in to do that.",
  };
}

function slugCandidate(desired: string, attempt: number): string {
  if (attempt === 1) return desired;
  const suffix = `-${attempt}`;
  return `${desired.slice(0, 80 - suffix.length)}${suffix}`;
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

function revalidateDeckPaths(slug: string, ownerUsername?: string | null) {
  revalidatePath("/dashboard/decks");
  revalidatePath("/decks"); // public browse (live from PR 2 of the decks series)
  revalidatePath("/dashboard");
  revalidatePath(`/deck/${slug}`);
  revalidatePath(`/deck/${slug}/edit`);
  if (ownerUsername) {
    revalidatePath(`/profile/${ownerUsername}`);
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createDeckAction(
  payload: unknown,
  options: { redirectAfterCreate?: boolean } = {},
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
    format: parsed.data.format,
    visibility: parsed.data.visibility,
  };

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

  if (!row) {
    return { ok: false, formError: lastError ?? "Could not create deck." };
  }

  const ownerUsername = await getOwnerUsername();
  revalidateDeckPaths(row.slug, ownerUsername);

  if (options.redirectAfterCreate) {
    redirect(`/deck/${row.slug}/edit`);
  }
  return { ok: true, deckId: row.id, slug: row.slug };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateDeckAction(
  deckId: string,
  payload: unknown,
): Promise<UpdateDeckResult> {
  if (!UUID_PATTERN.test(deckId)) {
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

  if (!row) {
    return { ok: false, formError: lastError ?? "Could not update deck." };
  }

  const ownerUsername = await getOwnerUsername();
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
  if (!UUID_PATTERN.test(deckId)) {
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

  const ownerUsername = await getOwnerUsername();
  revalidateDeckPaths(existing.slug, ownerUsername);
  return { ok: true, deckId };
}
