import "server-only";

import { createClient, getCurrentUser, getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import type { FeedbackCategory, FeedbackStatus } from "@/lib/feedback/schemas";

export type MyFeedbackItem = {
  id: string;
  category: FeedbackCategory;
  subject: string;
  status: FeedbackStatus;
  createdAt: string;
};

/** The signed-in user's own submissions (RLS-scoped) — shown on /feedback so
 *  senders can see their history and its status. */
export async function listMyFeedback(limit = 20): Promise<MyFeedbackItem[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("feedback")
    .select("id, category, subject, status, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id,
    category: r.category as FeedbackCategory,
    subject: r.subject,
    status: r.status as FeedbackStatus,
    createdAt: r.created_at,
  }));
}

export type AdminFeedbackItem = {
  id: string;
  category: FeedbackCategory;
  subject: string;
  message: string;
  frameTemplate: string | null;
  pageUrl: string | null;
  status: FeedbackStatus;
  createdAt: string;
  user: { username: string | null; displayName: string | null } | null;
};

/** Admin inbox. Returns null when the caller isn't an admin (page 404s),
 *  [] when the inbox is empty. Service-role read gated on is_admin. */
export async function listAllFeedback(
  status?: FeedbackStatus,
): Promise<AdminFeedbackItem[] | null> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return null;
  if (!isAdminConfigured()) return [];

  const admin = createAdminClient();
  let query = admin
    .from("feedback")
    .select("id, category, subject, message, frame_template, page_url, status, created_at, user_id")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error || !data) return [];

  // Resolve submitter names in one shot (feedback.user_id has no FK to
  // profiles, so no implicit join).
  const userIds = [...new Set(data.map((r) => r.user_id).filter(Boolean))] as string[];
  const names = new Map<string, { username: string | null; displayName: string | null }>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, username, display_name")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      names.set(p.id, { username: p.username, displayName: p.display_name });
    }
  }

  return data.map((r) => ({
    id: r.id,
    category: r.category as FeedbackCategory,
    subject: r.subject,
    message: r.message,
    frameTemplate: r.frame_template,
    pageUrl: r.page_url,
    status: r.status as FeedbackStatus,
    createdAt: r.created_at,
    user: r.user_id ? (names.get(r.user_id) ?? null) : null,
  }));
}
