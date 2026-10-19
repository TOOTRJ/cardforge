import "server-only";

import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { buildCardPath } from "@/lib/cards/utils";
import type { Card } from "@/types/card";

type ModerationReport = {
  id: string;
  reason: string;
  details: string | null;
  createdAt: string;
};

export type ModerationCard = {
  cardId: string;
  title: string;
  /** The reported card's page (null while its owner's handle is unknown). */
  href: string | null;
  /** The whole row: the tile draws it through BakedCardThumbnail (the 600 px
   *  thumb, never the 3 MB PNG; the live preview when nothing is baked —
   *  every picture through the drawable-media guards). */
  card: Card;
  reports: ModerationReport[];
};

/** A queue for an admin; `loadError` when a read failed (logged) — the page
 *  says so rather than "No flagged cards". */
export type ModerationQueue<T> = { items: T[]; loadError: boolean };

export async function isCurrentUserAdmin(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return Boolean(profile?.is_admin);
}

/**
 * Pending reports grouped by card, newest first. Returns null when the caller
 * isn't an admin (so the page can 404), no items when there's nothing to
 * review. Reads via the service role (gated on is_admin above).
 */
export async function getModerationQueue(): Promise<ModerationQueue<ModerationCard> | null> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return null;
  if (!isAdminConfigured()) return { items: [], loadError: true };

  const admin = createAdminClient();
  // cards(*): the tile is the card's own (BakedCardThumbnail + its live
  // fallback), which reads the whole row.
  const { data, error } = await admin
    .from("card_reports")
    .select("id, reason, details, created_at, card_id, cards(*)")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error || !data) {
    console.error("[admin/moderation] card report read failed:", error?.message ?? "no data");
    return { items: [], loadError: true };
  }

  type Row = {
    id: string;
    reason: string;
    details: string | null;
    created_at: string;
    card_id: string;
    cards: Card | null;
  };
  const rows = data as unknown as Row[];

  // The owners' handles, for the card links.
  let loadError = false;
  const ownerIds = [...new Set(rows.map((r) => r.cards?.owner_id).filter((id): id is string => Boolean(id)))];
  const usernameById = new Map<string, string | null>();
  if (ownerIds.length > 0) {
    const { data: owners, error: ownersError } = await admin
      .from("profiles")
      .select("id, username")
      .in("id", ownerIds);
    if (ownersError) {
      console.error("[admin/moderation] card owner read failed:", ownersError.message);
      loadError = true;
    }
    for (const o of owners ?? []) usernameById.set(o.id as string, (o.username as string | null) ?? null);
  }

  const byCard = new Map<string, ModerationCard>();
  for (const row of rows) {
    const card = row.cards;
    if (!card) continue;
    let entry = byCard.get(card.id);
    if (!entry) {
      const username = usernameById.get(card.owner_id) ?? null;
      entry = {
        cardId: card.id,
        title: card.title,
        href: card.slug && username ? buildCardPath({ slug: card.slug, owner: { username } }) : null,
        card,
        reports: [],
      };
      byCard.set(card.id, entry);
    }
    entry.reports.push({
      id: row.id,
      reason: row.reason,
      details: row.details,
      createdAt: row.created_at,
    });
  }
  return { items: Array.from(byCard.values()), loadError };
}

export type ModerationComment = {
  commentId: string;
  body: string;
  cardId: string;
  reports: ModerationReport[];
};

/** Pending comment reports grouped by comment, newest first. Same admin gate. */
export async function getCommentModerationQueue(): Promise<
  ModerationQueue<ModerationComment> | null
> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return null;
  if (!isAdminConfigured()) return { items: [], loadError: true };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("comment_reports")
    .select(
      "id, reason, details, created_at, comment_id, card_comments(id, body, card_id)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error || !data) {
    console.error("[admin/moderation] comment report read failed:", error?.message ?? "no data");
    return { items: [], loadError: true };
  }

  type Row = {
    id: string;
    reason: string;
    details: string | null;
    created_at: string;
    comment_id: string;
    card_comments: { id: string; body: string; card_id: string } | null;
  };

  const byComment = new Map<string, ModerationComment>();
  for (const row of data as unknown as Row[]) {
    const comment = row.card_comments;
    if (!comment) continue;
    let entry = byComment.get(comment.id);
    if (!entry) {
      entry = {
        commentId: comment.id,
        body: comment.body,
        cardId: comment.card_id,
        reports: [],
      };
      byComment.set(comment.id, entry);
    }
    entry.reports.push({
      id: row.id,
      reason: row.reason,
      details: row.details,
      createdAt: row.created_at,
    });
  }
  return { items: Array.from(byComment.values()), loadError: false };
}
