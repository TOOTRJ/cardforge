"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Card comment Server Actions
//
// All three actions return a discriminated `{ok: true, ...}` / `{ok: false,
// error}` envelope so client components can pattern-match without throwing.
// RLS already enforces ownership (author_id = auth.uid()) — these actions
// surface friendlier errors before the DB is hit.
// ---------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const commentBodySchema = z
  .string()
  .trim()
  .min(1, "Comment can't be empty.")
  .max(2000, "Comment must be 2000 characters or fewer.");

export type CommentActionResult =
  | { ok: true; commentId: string }
  | { ok: false; error: string };

function notAuthed(): CommentActionResult {
  return { ok: false, error: "You must be signed in to comment." };
}

function notConfigured(): CommentActionResult {
  return { ok: false, error: "Supabase is not configured on this deploy." };
}

async function revalidateCommentPaths(
  cardSlug: string | null,
  ownerUsername: string | null,
) {
  // The canonical detail page lives at /card/[username]/[slug]; revalidate
  // both the per-card and per-profile surfaces.
  if (ownerUsername && cardSlug) {
    revalidatePath(`/card/${ownerUsername}/${cardSlug}`);
    revalidatePath(`/profile/${ownerUsername}`);
  }
  if (cardSlug) {
    // Legacy redirector + owner edit page.
    revalidatePath(`/card/${cardSlug}`);
    revalidatePath(`/card/${cardSlug}/edit`);
  }
}

async function lookupCardForRevalidation(cardId: string) {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data: card } = await supabase
      .from("cards")
      .select("slug, owner_id")
      .eq("id", cardId)
      .maybeSingle();
    if (!card) return null;
    const { data: owner } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", card.owner_id)
      .maybeSingle();
    return { slug: card.slug, ownerUsername: owner?.username ?? null };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createCommentAction(
  cardId: string,
  rawBody: string,
): Promise<CommentActionResult> {
  if (!UUID_PATTERN.test(cardId)) {
    return { ok: false, error: "Invalid card id." };
  }
  const parsed = commentBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
  }

  if (!isSupabaseConfigured()) return notConfigured();
  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("card_comments")
    .insert({
      card_id: cardId,
      author_id: user.id,
      body: parsed.data,
    })
    .select("id")
    .single();

  if (error || !row) {
    return { ok: false, error: error?.message ?? "Could not post comment." };
  }

  const lookup = await lookupCardForRevalidation(cardId);
  await revalidateCommentPaths(lookup?.slug ?? null, lookup?.ownerUsername ?? null);

  return { ok: true, commentId: row.id };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateCommentAction(
  commentId: string,
  rawBody: string,
): Promise<CommentActionResult> {
  if (!UUID_PATTERN.test(commentId)) {
    return { ok: false, error: "Invalid comment id." };
  }
  const parsed = commentBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
  }

  if (!isSupabaseConfigured()) return notConfigured();
  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("card_comments")
    .update({ body: parsed.data })
    .eq("id", commentId)
    .eq("author_id", user.id)
    .select("id, card_id")
    .single();

  if (error || !row) {
    return { ok: false, error: error?.message ?? "Could not update comment." };
  }

  const lookup = await lookupCardForRevalidation(row.card_id);
  await revalidateCommentPaths(lookup?.slug ?? null, lookup?.ownerUsername ?? null);

  return { ok: true, commentId: row.id };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteCommentAction(
  commentId: string,
): Promise<CommentActionResult> {
  if (!UUID_PATTERN.test(commentId)) {
    return { ok: false, error: "Invalid comment id." };
  }

  if (!isSupabaseConfigured()) return notConfigured();
  const user = await getCurrentUser();
  if (!user) return notAuthed();

  const supabase = await createClient();
  // Need the card_id BEFORE deletion so we can revalidate the right paths.
  const { data: existing } = await supabase
    .from("card_comments")
    .select("card_id")
    .eq("id", commentId)
    .eq("author_id", user.id)
    .maybeSingle();

  if (!existing) {
    return { ok: false, error: "Comment not found or not yours to delete." };
  }

  const { error } = await supabase
    .from("card_comments")
    .delete()
    .eq("id", commentId)
    .eq("author_id", user.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  const lookup = await lookupCardForRevalidation(existing.card_id);
  await revalidateCommentPaths(lookup?.slug ?? null, lookup?.ownerUsername ?? null);

  return { ok: true, commentId };
}
