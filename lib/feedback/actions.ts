"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser, getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  feedbackSchema,
  FEEDBACK_STATUSES,
  type FeedbackStatus,
} from "@/lib/feedback/schemas";

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

  const supabase = await createClient();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", oneHourAgo);
  if ((count ?? 0) >= MAX_PER_HOUR) {
    return {
      ok: false,
      error:
        "You've sent quite a bit of feedback recently — thank you! Try again in a little while.",
    };
  }

  const { error } = await supabase.from("feedback").insert({
    user_id: user.id,
    category: parsed.data.category,
    subject: parsed.data.subject,
    message: parsed.data.message,
    frame_template: parsed.data.frame_template ?? null,
    page_url: parsed.data.page_url ?? null,
  });
  if (error) {
    console.warn("submitFeedbackAction: insert error", error.message);
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
