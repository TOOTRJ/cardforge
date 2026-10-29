"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser, getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  deckFeedbackCategory,
  deckFeedbackSchema,
  deckFeedbackSubject,
  feedbackSchema,
  FEEDBACK_STATUSES,
  type FeedbackStatus,
} from "@/lib/feedback/schemas";
import type { Database } from "@/types/supabase";
import { viaDeckLink } from "@/lib/decks/deck-link";

export type FeedbackActionResult =
  | { ok: true }
  | { ok: false; error: string };

// Soft spam guard on top of RLS: a real person doesn't file more than a
// handful of reports in an hour.
const MAX_PER_HOUR = 5;

export async function submitFeedbackAction(
  input: unknown,
): Promise<FeedbackActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to send feedback." };
  }

  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "Check your feedback and try again.",
    };
  }

  return insertFeedback(user.id, {
    category: parsed.data.category,
    subject: parsed.data.subject,
    message: parsed.data.message,
    frame_template: parsed.data.frame_template ?? null,
    page_url: parsed.data.page_url ?? null,
  });
}

/** The deck feedback dialog (TODO DK10.1): Idea / Bug / Other and a
 *  message, filed under area "decks" with the deck, the page's path and the
 *  window size it attached. A deck the sender can't read is dropped rather
 *  than refused (0146's insert policy would refuse the whole row) — the
 *  feedback still arrives, without the link. */
export async function submitDeckFeedbackAction(
  input: unknown,
): Promise<FeedbackActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to send feedback." };
  }

  const parsed = deckFeedbackSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "Check your feedback and try again.",
    };
  }

  let deckId = parsed.data.deck_id ?? null;
  if (deckId) {
    const supabase = await createClient();
    // Named by its link: an unlisted deck is read only that way (0150).
    const { data: deck } = await viaDeckLink(
      supabase.from("decks").select("id").eq("id", deckId),
      deckId,
    ).maybeSingle();
    if (!deck) deckId = null;
  }

  return insertFeedback(user.id, {
    category: deckFeedbackCategory(parsed.data.kind),
    subject: deckFeedbackSubject(parsed.data.message),
    message: parsed.data.message,
    area: "decks",
    deck_id: deckId,
    page_url: parsed.data.page_url ?? null,
    viewport: parsed.data.viewport ?? null,
  });
}

/** One insert for every intake: the hourly cap, then the row under RLS
 *  (users insert their own; 0051's trigger pings the admins). */
async function insertFeedback(
  userId: string,
  row: Omit<Database["public"]["Tables"]["feedback"]["Insert"], "user_id">,
): Promise<FeedbackActionResult> {
  const supabase = await createClient();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneHourAgo);
  if ((count ?? 0) >= MAX_PER_HOUR) {
    return {
      ok: false,
      error:
        "You've sent quite a bit of feedback recently — thank you! Try again in a little while.",
    };
  }

  // 0146's insert policy reads the deck a row names: an unlisted one only by
  // its link (migration 0150, lib/decks/deck-link.ts).
  const insert = supabase.from("feedback").insert({ ...row, user_id: userId });
  const { error } = await (row.deck_id ? viaDeckLink(insert, row.deck_id) : insert);
  if (error) {
    console.warn("insertFeedback: insert error", error.message);
    return { ok: false, error: "Couldn't save your feedback. Try again." };
  }

  revalidatePath("/feedback");
  return { ok: true };
}

/** Admin: move a submission through new → reviewed → resolved. Service-role
 *  write gated on profiles.is_admin — the same split the moderation queue
 *  uses (users have no UPDATE policy on feedback). */
export async function setFeedbackStatusAction(
  feedbackId: string,
  status: FeedbackStatus,
): Promise<FeedbackActionResult> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  if (!isAdminConfigured()) {
    return { ok: false, error: "Admin client isn't configured." };
  }
  if (!FEEDBACK_STATUSES.includes(status)) {
    return { ok: false, error: "Unknown status." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("feedback")
    .update({
      status,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
      resolved_by: status === "resolved" ? profile.id : null,
    })
    .eq("id", feedbackId);
  if (error) {
    console.warn("setFeedbackStatusAction: update error", error.message);
    return { ok: false, error: "Couldn't update the status." };
  }

  revalidatePath("/admin/feedback");
  return { ok: true };
}
