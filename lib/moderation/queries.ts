import "server-only";

import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export type ModerationReport = {
  id: string;
  reason: string;
  details: string | null;
  createdAt: string;
};

export type ModerationCard = {
  cardId: string;
  title: string;
  slug: string | null;
  ownerId: string;
  artUrl: string | null;
  renderedImageUrl: string | null;
  reports: ModerationReport[];
};

export async function isCurrentUserAdmin(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return Boolean(profile?.is_admin);
}

/**
 * Pending reports grouped by card, newest first. Returns null when the caller
 * isn't an admin (so the page can 404), [] when there's nothing to review.
 * Reads via the service role (gated on is_admin above).
 */
export async function getModerationQueue(): Promise<ModerationCard[] | null> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return null;
  if (!isAdminConfigured()) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("card_reports")
    .select(
      "id, reason, details, created_at, card_id, cards(id, title, slug, owner_id, art_url, rendered_image_url)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error || !data) return [];

  type Row = {
    id: string;
    reason: string;
    details: string | null;
    created_at: string;
    card_id: string;
    cards: {
      id: string;
      title: string;
      slug: string | null;
      owner_id: string;
      art_url: string | null;
      rendered_image_url: string | null;
    } | null;
  };

  const byCard = new Map<string, ModerationCard>();
  for (const row of data as unknown as Row[]) {
    const card = row.cards;
    if (!card) continue;
    let entry = byCard.get(card.id);
    if (!entry) {
      entry = {
        cardId: card.id,
        title: card.title,
        slug: card.slug,
        ownerId: card.owner_id,
        artUrl: card.art_url,
        renderedImageUrl: card.rendered_image_url,
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
  return Array.from(byCard.values());
}
