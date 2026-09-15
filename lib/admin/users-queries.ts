import "server-only";

import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  USER_LIST_PAGE_SIZE,
  type UserListParams,
} from "@/lib/admin/users-params";

// ---------------------------------------------------------------------------
// /admin/users reads — the directory page and the per-user detail. Both
// RPCs (migration 0071) are EXECUTE-granted to service_role only; the
// is_admin gate here is what stands between a signed-in user and them.
// ---------------------------------------------------------------------------

export type AdminUserRow = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  subscriptionTier: string;
  subscriptionStatus: string | null;
  compTier: string | null;
  compExpiresAt: string | null;
  credits: number;
  isAdmin: boolean;
  cardCount: number;
  deckCount: number;
  createdAt: string;
  lastActiveAt: string | null;
  /** status active/trialing but tier free — the 2026-09-14 incident shape. */
  tierMismatch: boolean;
};

export type AdminUserPage = {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
};

async function requireAdminClient(): Promise<ReturnType<typeof createAdminClient> | null> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return null;
  if (!isAdminConfigured()) return null;
  return createAdminClient();
}

const n = (value: number | string | null | undefined): number =>
  typeof value === "string" ? Number(value) : (value ?? 0);

/** One page of the directory. Null for non-admins (page → notFound). */
export async function listAdminUsers(params: UserListParams): Promise<AdminUserPage | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.rpc("admin_list_users", {
    p_q: params.q || null,
    p_tier: params.tier || null,
    p_status: params.status || null,
    p_flag: params.flag || null,
    p_sort: params.sort,
    p_limit: USER_LIST_PAGE_SIZE,
    p_offset: (params.page - 1) * USER_LIST_PAGE_SIZE,
  });
  if (error) {
    console.warn("listAdminUsers: rpc error", error.message);
    return { rows: [], total: 0, page: params.page, pageSize: USER_LIST_PAGE_SIZE };
  }
  const rows = (data ?? []).map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    email: row.email,
    subscriptionTier: row.subscription_tier,
    subscriptionStatus: row.subscription_status,
    compTier: row.comp_tier,
    compExpiresAt: row.comp_expires_at,
    credits: n(row.credits),
    isAdmin: Boolean(row.is_admin),
    cardCount: n(row.card_count),
    deckCount: n(row.deck_count),
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    tierMismatch:
      row.subscription_tier === "free" &&
      (row.subscription_status === "active" || row.subscription_status === "trialing"),
  }));
  return {
    rows,
    total: n(data?.[0]?.total_count),
    page: params.page,
    pageSize: USER_LIST_PAGE_SIZE,
  };
}

export type AdminUserStats = {
  cardsTotal: number;
  cardsPublic: number;
  cardsUnlisted: number;
  cardsPrivate: number;
  decks: number;
  sets: number;
  likesReceived: number;
  creditsSpentMonth: number;
  feedbackCount: number;
  threadCount: number;
  unreadFromUser: number;
};

export async function getAdminUserStats(userId: string): Promise<AdminUserStats | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.rpc("admin_user_stats", { p_user_id: userId });
  const row = data?.[0];
  if (error || !row) return null;
  return {
    cardsTotal: n(row.cards_total),
    cardsPublic: n(row.cards_public),
    cardsUnlisted: n(row.cards_unlisted),
    cardsPrivate: n(row.cards_private),
    decks: n(row.decks),
    sets: n(row.sets),
    likesReceived: n(row.likes_received),
    creditsSpentMonth: n(row.credits_spent_month),
    feedbackCount: n(row.feedback_count),
    threadCount: n(row.thread_count),
    unreadFromUser: n(row.unread_from_user),
  };
}
