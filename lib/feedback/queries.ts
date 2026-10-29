import "server-only";

import { createClient, getCurrentUser, getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  isFeedbackArea,
  type FeedbackArea,
  type FeedbackCategory,
  type FeedbackStatus,
} from "@/lib/feedback/schemas";
import type { FeedbackInboxFilter } from "@/lib/feedback/inbox-filters";

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
  /** Where it was sent from (0146): null = the general /feedback page. */
  area: FeedbackArea | null;
  /** The deck the deck dialog was opened on — null when none was attached
   *  or the deck was deleted since (0146's `on delete set null`). A private
   *  deck's page opens for its owner only (`isPrivate`: no link). */
  deck: { id: string; slug: string; title: string; isPrivate: boolean } | null;
  /** The sender's window, "<width>x<height>". */
  viewport: string | null;
  status: FeedbackStatus;
  createdAt: string;
  user: { username: string | null; displayName: string | null } | null;
};

/** Unread work for the admin rail badge: feedback still marked 'new'.
 *  0 for non-admins. */
export async function countNewFeedback(): Promise<number> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin || !isAdminConfigured()) return 0;
  const { count } = await createAdminClient()
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  return count ?? 0;
}

export type { FeedbackInboxFilter };

/** Migration 0146's columns (TODO DK10.1) are missing — "column
 *  feedback.area does not exist" (42703) or PostgREST's stale-schema
 *  PGRST204. On a merge Vercel can deploy before Supabase migrates, and the
 *  dev DB migrates from the `dev` branch after it; until then the inbox
 *  reads the rows without them instead of showing its load error (a deck
 *  dialog's insert fails with its friendly "Couldn't save" meanwhile).
 *  Remove once 0146 is on production and dev. */
function isMissing0146Column(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (error?.code !== "42703" && error?.code !== "PGRST204") return false;
  return /\b(area|deck_id|viewport)\b/.test(error.message ?? "");
}

/** Statuses that still need attention (the inbox default). */
const UNRESOLVED_FEEDBACK_STATUSES: readonly FeedbackStatus[] = ["new", "reviewed"];

/** Admin inbox. Returns null when the caller isn't an admin (page 404s),
 *  [] when the inbox is empty. Service-role read gated on is_admin. Newest
 *  first; the unresolved view additionally lifts untouched ("new") rows
 *  above reviewed ones so fresh reports are always at the top. */
/** The inbox for an admin (null for anyone else). `loadError`: a read
 *  failed (logged) — the items may be missing or nameless, and the page
 *  says so rather than "Inbox zero". */
export async function listAllFeedback(
  filter: FeedbackInboxFilter = "unresolved",
  /** One area only (0146); omitted / null = every area, /feedback's too. */
  area: FeedbackArea | null = null,
): Promise<{ items: AdminFeedbackItem[]; loadError: boolean } | null> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return null;
  if (!isAdminConfigured()) return { items: [], loadError: true };

  const admin = createAdminClient();
  let query = admin
    .from("feedback")
    .select("id, category, subject, message, frame_template, page_url, area, deck_id, viewport, status, created_at, user_id")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter === "unresolved") query = query.in("status", [...UNRESOLVED_FEEDBACK_STATUSES]);
  else if (filter !== "all") query = query.eq("status", filter);
  if (area) query = query.eq("area", area);
  let { data: fetched, error } = await query;
  if (isMissing0146Column(error)) {
    // A database 0146 has not reached yet: no row there has an area, so one
    // area is an honest empty inbox, and every area is the rows as before.
    if (area) return { items: [], loadError: false };
    let legacy = admin
      .from("feedback")
      .select("id, category, subject, message, frame_template, page_url, status, created_at, user_id")
      .order("created_at", { ascending: false })
      .limit(200);
    if (filter === "unresolved") legacy = legacy.in("status", [...UNRESOLVED_FEEDBACK_STATUSES]);
    else if (filter !== "all") legacy = legacy.eq("status", filter);
    const read = await legacy;
    fetched = read.data?.map((r) => ({ ...r, area: null, deck_id: null, viewport: null })) ?? null;
    error = read.error;
  }
  if (error || !fetched) {
    console.error("[admin/feedback] feedback read failed:", error?.message ?? "no data");
    return { items: [], loadError: true };
  }
  let loadError = false;
  const data =
    filter === "unresolved"
      ? [...fetched].sort((a, b) => {
          const rank = (s: string) => (s === "new" ? 0 : 1);
          return rank(a.status) - rank(b.status) || (a.created_at < b.created_at ? 1 : -1);
        })
      : fetched;

  // Resolve submitter names in one shot (feedback.user_id has no FK to
  // profiles, so no implicit join).
  const userIds = [...new Set(data.map((r) => r.user_id).filter(Boolean))] as string[];
  const names = new Map<string, { username: string | null; displayName: string | null }>();
  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id, username, display_name")
      .in("id", userIds);
    if (profilesError) {
      // Every sender would read "deleted account" below: say so instead.
      console.error("[admin/feedback] sender read failed:", profilesError.message);
      loadError = true;
    }
    for (const p of profiles ?? []) {
      names.set(p.id, { username: p.username, displayName: p.display_name });
    }
  }

  // The decks the deck dialog attached, in one read. A private one is named
  // too (the service role reads it), but its page opens for its owner only
  // — the inbox shows its title without a link.
  const deckIds = [...new Set(data.map((r) => r.deck_id).filter(Boolean))] as string[];
  const decks = new Map<string, NonNullable<AdminFeedbackItem["deck"]>>();
  if (deckIds.length > 0) {
    const { data: deckRows, error: decksError } = await admin
      .from("decks")
      .select("id, slug, title, visibility")
      .in("id", deckIds);
    if (decksError) {
      // Every deck link would be missing: say so instead.
      console.error("[admin/feedback] deck read failed:", decksError.message);
      loadError = true;
    }
    for (const d of deckRows ?? []) {
      decks.set(d.id, { id: d.id, slug: d.slug, title: d.title, isPrivate: d.visibility === "private" });
    }
  }

  const items = data.map((r) => ({
    id: r.id,
    category: r.category as FeedbackCategory,
    subject: r.subject,
    message: r.message,
    frameTemplate: r.frame_template,
    pageUrl: r.page_url,
    area: isFeedbackArea(r.area) ? r.area : null,
    deck: r.deck_id ? (decks.get(r.deck_id) ?? null) : null,
    viewport: r.viewport,
    status: r.status as FeedbackStatus,
    createdAt: r.created_at,
    user: r.user_id ? (names.get(r.user_id) ?? null) : null,
  }));
  return { items, loadError };
}
