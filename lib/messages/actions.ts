"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  USER_MESSAGES_PER_HOUR,
  replyToFeedbackSchema,
  sendMessageSchema,
  startThreadSchema,
  THREAD_STATUSES,
  type ThreadStatus,
} from "@/lib/messages/schemas";
import { emailUserAboutMessage } from "@/lib/messages/notify";

// ---------------------------------------------------------------------------
// Writes for admin ↔ user messaging.
//
//   * A USER can only post into their own OPEN thread (RLS insert policy,
//     0070) and mark their thread read (SECURITY DEFINER RPC). They can't
//     open threads.
//   * An ADMIN opens threads (independently, or as the reply to a feedback
//     row), posts, and opens/closes — every admin write goes through the
//     service role behind the is_admin gate. The messages insert trigger
//     rolls the thread forward and fans out the bell notification.
// ---------------------------------------------------------------------------

export type MessageActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type StartThreadResult =
  | { ok: true; threadId: string }
  | { ok: false; error: string };

type ActionError = { ok: false; error: string };

async function requireAdmin(): Promise<
  | { ok: true; admin: ReturnType<typeof createAdminClient>; adminId: string }
  | ActionError
> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  if (!isAdminConfigured()) {
    return { ok: false, error: "Admin client isn't configured." };
  }
  return { ok: true, admin: createAdminClient(), adminId: profile.id };
}

function firstIssue(error: { issues: Array<{ message: string }> }, fallback: string) {
  return error.issues[0]?.message ?? fallback;
}

function revalidateMessageSurfaces(threadId: string) {
  revalidatePath("/messages");
  revalidatePath(`/messages/${threadId}`);
  revalidatePath("/admin/messages");
  revalidatePath(`/admin/messages/${threadId}`);
  revalidatePath("/admin/users");
  revalidatePath("/notifications");
  revalidatePath("/dashboard", "layout");
}

// ---------------------------------------------------------------------------
// User side
// ---------------------------------------------------------------------------

export async function sendMessageAction(input: unknown): Promise<MessageActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to reply." };
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, "Check your message and try again.") };
  }
  const { threadId, body } = parsed.data;
  const supabase = await createClient();

  // Ownership + open state, for a friendly error over RLS's silent refusal.
  const { data: thread } = await supabase
    .from("message_threads")
    .select("id, status")
    .eq("id", threadId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!thread) return { ok: false, error: "That conversation isn't available." };
  if (thread.status !== "open") {
    return { ok: false, error: "This conversation is closed. Send new feedback to start another." };
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("sender_id", user.id)
    .gte("created_at", oneHourAgo);
  if ((count ?? 0) >= USER_MESSAGES_PER_HOUR) {
    return { ok: false, error: "You've sent a lot of messages recently — try again in a little while." };
  }

  const { error } = await supabase.from("messages").insert({
    thread_id: threadId,
    sender_id: user.id,
    sender_role: "user",
    body,
  });
  if (error) {
    console.warn("sendMessageAction: insert error", error.message);
    return { ok: false, error: "Couldn't send your message. Try again." };
  }
  revalidateMessageSurfaces(threadId);
  return { ok: true };
}

/** Zero the user's unread counter on THEIR thread (RPC, RLS-safe). */
export async function markThreadReadAction(threadId: string): Promise<MessageActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_message_thread_read", {
    p_thread_id: threadId,
  });
  if (error) return { ok: false, error: "Couldn't update read state." };
  revalidatePath("/messages");
  revalidatePath("/notifications");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------------

async function postAsAdmin(
  admin: ReturnType<typeof createAdminClient>,
  adminId: string,
  thread: { id: string; user_id: string; subject: string },
  body: string,
): Promise<MessageActionResult> {
  const { error } = await admin.from("messages").insert({
    thread_id: thread.id,
    sender_id: adminId,
    sender_role: "admin",
    body,
  });
  if (error) {
    console.warn("postAsAdmin: insert error", error.message);
    return { ok: false, error: "Couldn't send the message." };
  }
  // Reading a thread you just posted in leaves nothing unread on your side.
  await admin
    .from("message_threads")
    .update({ admin_unread_count: 0, admin_last_read_at: new Date().toISOString() })
    .eq("id", thread.id);
  await emailUserAboutMessage(admin, {
    userId: thread.user_id,
    threadId: thread.id,
    subject: thread.subject,
    body,
  });
  revalidateMessageSurfaces(thread.id);
  return { ok: true };
}

/** Open an independent thread with a user and post the first message. */
export async function adminStartThreadAction(input: unknown): Promise<StartThreadResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const parsed = startThreadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, "Invalid input.") };
  }
  const { userId, subject, body } = parsed.data;
  const { admin, adminId } = gate;

  const { data: target } = await admin
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (!target) return { ok: false, error: "No user with that id." };

  const { data: thread, error } = await admin
    .from("message_threads")
    .insert({ user_id: userId, subject, created_by: adminId })
    .select("id, user_id, subject")
    .single();
  if (error || !thread) {
    console.warn("adminStartThreadAction: insert error", error?.message);
    return { ok: false, error: "Couldn't open the conversation." };
  }
  const posted = await postAsAdmin(admin, adminId, thread, body);
  if (!posted.ok) return posted;
  return { ok: true, threadId: thread.id };
}

/**
 * Reply to a feedback submission: reuse its thread when one exists, else
 * open one titled after the feedback (the feedback text becomes the
 * thread's header quote — see ThreadDetail.feedback), and post the reply.
 * Also moves the feedback to "reviewed" if it was still "new".
 */
export async function adminReplyToFeedbackAction(input: unknown): Promise<StartThreadResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const parsed = replyToFeedbackSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, "Invalid input.") };
  }
  const { feedbackId, body } = parsed.data;
  const { admin, adminId } = gate;

  const { data: feedback } = await admin
    .from("feedback")
    .select("id, user_id, subject, status")
    .eq("id", feedbackId)
    .maybeSingle();
  if (!feedback) return { ok: false, error: "That feedback no longer exists." };
  if (!feedback.user_id) {
    return { ok: false, error: "The account that sent this feedback was deleted." };
  }

  let thread: { id: string; user_id: string; subject: string } | null = null;
  const { data: existing } = await admin
    .from("message_threads")
    .select("id, user_id, subject")
    .eq("feedback_id", feedbackId)
    .maybeSingle();
  if (existing) {
    thread = existing;
    // Replying re-opens a closed conversation.
    await admin.from("message_threads").update({ status: "open" }).eq("id", existing.id);
  } else {
    const { data: created, error } = await admin
      .from("message_threads")
      .insert({
        user_id: feedback.user_id,
        subject: `Re: ${feedback.subject}`.slice(0, 120),
        feedback_id: feedbackId,
        created_by: adminId,
      })
      .select("id, user_id, subject")
      .single();
    if (error || !created) {
      console.warn("adminReplyToFeedbackAction: insert error", error?.message);
      return { ok: false, error: "Couldn't open the conversation." };
    }
    thread = created;
  }

  const posted = await postAsAdmin(admin, adminId, thread, body);
  if (!posted.ok) return posted;
  if (feedback.status === "new") {
    await admin.from("feedback").update({ status: "reviewed" }).eq("id", feedbackId);
    revalidatePath("/admin/feedback");
    revalidatePath("/feedback");
  }
  return { ok: true, threadId: thread.id };
}

export async function adminSendMessageAction(input: unknown): Promise<MessageActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, "Check the message and try again.") };
  }
  const { admin, adminId } = gate;
  const { data: thread } = await admin
    .from("message_threads")
    .select("id, user_id, subject, status")
    .eq("id", parsed.data.threadId)
    .maybeSingle();
  if (!thread) return { ok: false, error: "No such conversation." };
  if (thread.status !== "open") {
    // An admin reply reopens a closed thread — the user needs to be able to
    // answer it.
    await admin.from("message_threads").update({ status: "open" }).eq("id", thread.id);
  }
  return postAsAdmin(admin, adminId, thread, parsed.data.body);
}

export async function adminSetThreadStatusAction(
  threadId: string,
  status: ThreadStatus,
): Promise<MessageActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (!THREAD_STATUSES.includes(status)) return { ok: false, error: "Unknown status." };
  const { error } = await gate.admin
    .from("message_threads")
    .update({ status })
    .eq("id", threadId);
  if (error) return { ok: false, error: "Couldn't update the conversation." };
  revalidateMessageSurfaces(threadId);
  return { ok: true };
}

/** Zero the admin-side unread counter (called when an admin views a thread). */
export async function adminMarkThreadReadAction(threadId: string): Promise<MessageActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const { admin, adminId } = gate;
  await admin
    .from("message_threads")
    .update({ admin_unread_count: 0, admin_last_read_at: new Date().toISOString() })
    .eq("id", threadId);
  await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", adminId)
    .eq("thread_id", threadId)
    .is("read_at", null);
  revalidatePath("/admin/messages");
  revalidatePath("/notifications");
  return { ok: true };
}
