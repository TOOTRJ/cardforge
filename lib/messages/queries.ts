import "server-only";

import { cache } from "react";
import { createClient, getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import type { MessageSenderRole, ThreadStatus } from "@/lib/messages/schemas";

// ---------------------------------------------------------------------------
// Reads for admin ↔ user messaging.
//
//   * User side runs under the user's RLS-scoped session: a user only ever
//     sees their own threads (message_threads / messages policies, 0070).
//   * Admin side returns null when the caller isn't an admin (pages map
//     null → notFound) and otherwise reads through the service role.
// ---------------------------------------------------------------------------

export type ThreadSummary = {
  id: string;
  subject: string;
  status: ThreadStatus;
  feedbackId: string | null;
  createdAt: string;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastSenderRole: MessageSenderRole | null;
  /** Unread for the VIEWER's side (user or admin). */
  unreadCount: number;
};

export type ThreadMessage = {
  id: string;
  senderRole: MessageSenderRole;
  senderId: string | null;
  body: string;
  createdAt: string;
};

export type ThreadDetail = ThreadSummary & {
  messages: ThreadMessage[];
  /** The feedback submission this thread answers, for the header quote. */
  feedback: {
    id: string;
    category: string;
    subject: string;
    message: string;
    createdAt: string;
    status: string;
  } | null;
};

type ThreadRow = {
  id: string;
  subject: string;
  status: string;
  feedback_id: string | null;
  created_at: string;
  last_message_at: string;
  last_message_preview: string | null;
  last_sender_role: string | null;
  user_unread_count: number;
  admin_unread_count: number;
  user_last_read_at: string | null;
};

const THREAD_COLUMNS =
  "id, subject, status, feedback_id, created_at, last_message_at, last_message_preview, last_sender_role, user_unread_count, admin_unread_count, user_last_read_at";

function toSummary(row: ThreadRow, side: MessageSenderRole): ThreadSummary {
  return {
    id: row.id,
    subject: row.subject,
    status: (row.status === "closed" ? "closed" : "open") as ThreadStatus,
    feedbackId: row.feedback_id,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    lastSenderRole:
      row.last_sender_role === "user" || row.last_sender_role === "admin"
        ? row.last_sender_role
        : null,
    unreadCount: side === "user" ? row.user_unread_count : row.admin_unread_count,
  };
}

type MessageRow = {
  id: string;
  sender_role: string;
  sender_id: string | null;
  body: string;
  created_at: string;
};

function toMessage(row: MessageRow): ThreadMessage {
  return {
    id: row.id,
    senderRole: row.sender_role === "admin" ? "admin" : "user",
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// User side
// ---------------------------------------------------------------------------

export type MessageNavState = {
  /** The user has at least one thread — the Messages nav entry exists. */
  hasThreads: boolean;
  /** Unread admin posts across all threads — the nav badge. */
  unread: number;
};

/**
 * What the chrome needs: whether to show "Messages" at all, and the badge.
 * One indexed read (user_id, last_message_at) — request-cached so the app
 * layout, the dashboard rail, and /api/me share a single query.
 */
export const getMessageNavState = cache(async (): Promise<MessageNavState> => {
  const user = await getCurrentUser();
  if (!user) return { hasThreads: false, unread: 0 };
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("message_threads")
      .select("user_unread_count")
      .eq("user_id", user.id);
    const rows = data ?? [];
    return {
      hasThreads: rows.length > 0,
      unread: rows.reduce((sum, row) => sum + (row.user_unread_count ?? 0), 0),
    };
  } catch {
    return { hasThreads: false, unread: 0 };
  }
});

export async function listMyThreads(): Promise<ThreadSummary[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("message_threads")
    .select(THREAD_COLUMNS)
    .eq("user_id", user.id)
    .order("last_message_at", { ascending: false })
    .limit(100);
  return ((data ?? []) as ThreadRow[]).map((row) => toSummary(row, "user"));
}

async function feedbackForThread(
  client: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  feedbackId: string | null,
): Promise<ThreadDetail["feedback"]> {
  if (!feedbackId) return null;
  const { data } = await client
    .from("feedback")
    .select("id, category, subject, message, created_at, status")
    .eq("id", feedbackId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    category: data.category,
    subject: data.subject,
    message: data.message,
    createdAt: data.created_at,
    status: data.status,
  };
}

/** One of the user's own threads with its full transcript, or null. */
export async function getMyThread(threadId: string): Promise<ThreadDetail | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: thread } = await supabase
    .from("message_threads")
    .select(THREAD_COLUMNS)
    .eq("id", threadId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!thread) return null;
  const [{ data: messages }, feedback] = await Promise.all([
    supabase
      .from("messages")
      .select("id, sender_role, sender_id, body, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(500),
    feedbackForThread(supabase, thread.feedback_id),
  ]);
  return {
    ...toSummary(thread as ThreadRow, "user"),
    messages: ((messages ?? []) as MessageRow[]).map(toMessage),
    feedback,
  };
}

// ---------------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------------

export type AdminThreadSummary = ThreadSummary & {
  user: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  /** Read receipt for the ADMIN side only: when the user last opened the
   *  thread (mark_message_thread_read) and whether anything the team sent is
   *  still unseen. Users never get the mirror of this. */
  userLastReadAt: string | null;
  userHasUnseen: boolean;
};

function adminReceipt(row: ThreadRow): Pick<AdminThreadSummary, "userLastReadAt" | "userHasUnseen"> {
  return {
    userLastReadAt: row.user_last_read_at,
    userHasUnseen: row.user_unread_count > 0,
  };
}

export type AdminThreadDetail = AdminThreadSummary & {
  messages: ThreadMessage[];
  feedback: ThreadDetail["feedback"];
  /** Admin display names by sender id, so the transcript can say WHICH
   *  admin posted (users never see this — they see "PipGlyph team"). */
  adminNames: Record<string, string>;
};

async function requireAdminClient(): Promise<ReturnType<typeof createAdminClient> | null> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return null;
  if (!isAdminConfigured()) return null;
  return createAdminClient();
}

type ProfileLite = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

async function profilesById(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, ProfileLite>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await admin
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", unique);
  return new Map(((data ?? []) as ProfileLite[]).map((p) => [p.id, p]));
}

export type AdminThreadFilter = "all" | "unread" | "open" | "closed";

/** Every thread, newest activity first. Null for non-admins. */
export async function listAllThreads(
  filter: AdminThreadFilter = "all",
): Promise<AdminThreadSummary[] | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  let query = admin
    .from("message_threads")
    .select(`${THREAD_COLUMNS}, user_id`)
    .order("last_message_at", { ascending: false })
    .limit(200);
  if (filter === "unread") query = query.gt("admin_unread_count", 0);
  if (filter === "open" || filter === "closed") query = query.eq("status", filter);
  const { data } = await query;
  const rows = (data ?? []) as Array<ThreadRow & { user_id: string }>;
  const people = await profilesById(admin, rows.map((row) => row.user_id));
  return rows.map((row) => {
    const p = people.get(row.user_id);
    return {
      ...toSummary(row, "admin"),
    ...adminReceipt(row),
      user: {
        id: row.user_id,
        username: p?.username ?? null,
        displayName: p?.display_name ?? null,
        avatarUrl: p?.avatar_url ?? null,
      },
    };
  });
}

/** Threads for one user (the admin users page's detail view). */
export async function listThreadsForUser(userId: string): Promise<AdminThreadSummary[] | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const { data } = await admin
    .from("message_threads")
    .select(`${THREAD_COLUMNS}, user_id`)
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as Array<ThreadRow & { user_id: string }>;
  const people = await profilesById(admin, [userId]);
  const p = people.get(userId);
  return rows.map((row) => ({
    ...toSummary(row, "admin"),
    ...adminReceipt(row),
    user: {
      id: userId,
      username: p?.username ?? null,
      displayName: p?.display_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
    },
  }));
}

export async function getThreadForAdmin(threadId: string): Promise<AdminThreadDetail | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const { data: thread } = await admin
    .from("message_threads")
    .select(`${THREAD_COLUMNS}, user_id`)
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return null;
  const row = thread as ThreadRow & { user_id: string };
  const [{ data: messages }, feedback] = await Promise.all([
    admin
      .from("messages")
      .select("id, sender_role, sender_id, body, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(500),
    feedbackForThread(admin, row.feedback_id),
  ]);
  const msgs = ((messages ?? []) as MessageRow[]).map(toMessage);
  const people = await profilesById(admin, [
    row.user_id,
    ...msgs.filter((m) => m.senderRole === "admin" && m.senderId).map((m) => m.senderId as string),
  ]);
  const p = people.get(row.user_id);
  const adminNames: Record<string, string> = {};
  for (const m of msgs) {
    if (m.senderRole !== "admin" || !m.senderId) continue;
    const a = people.get(m.senderId);
    adminNames[m.senderId] = a?.display_name || (a?.username ? `@${a.username}` : "Admin");
  }
  return {
    ...toSummary(row, "admin"),
    ...adminReceipt(row),
    user: {
      id: row.user_id,
      username: p?.username ?? null,
      displayName: p?.display_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
    },
    messages: msgs,
    feedback,
    adminNames,
  };
}

/** Threads awaiting an admin reply — the admin inbox badge. */
export const getAdminUnreadThreadCount = cache(async (): Promise<number> => {
  const admin = await requireAdminClient();
  if (!admin) return 0;
  const { count } = await admin
    .from("message_threads")
    .select("id", { count: "exact", head: true })
    .gt("admin_unread_count", 0);
  return count ?? 0;
});

/** feedback id → thread id for the admin feedback inbox's Reply buttons. */
export async function threadIdsForFeedback(
  feedbackIds: string[],
): Promise<Map<string, string>> {
  const admin = await requireAdminClient();
  if (!admin || feedbackIds.length === 0) return new Map();
  const { data } = await admin
    .from("message_threads")
    .select("id, feedback_id")
    .in("feedback_id", feedbackIds);
  return new Map(
    (data ?? [])
      .filter((row) => row.feedback_id)
      .map((row) => [row.feedback_id as string, row.id]),
  );
}
