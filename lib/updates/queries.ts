import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { needsAck, type SiteUpdate } from "@/lib/updates/shared";

// ---------------------------------------------------------------------------
// Public reads (cookie-free, cached, tagged) for /news and the homepage
// banner; cookie-bound reads for the signed-in acknowledgement splash and
// the admin page. Release is enforced by RLS (is_published AND
// publish_at <= now()), so a scheduled row simply appears once its time
// passes — within the cache window (5 min) or immediately when an admin
// save purges the tag.
// ---------------------------------------------------------------------------

export const SITE_UPDATES_TAG = "site-updates";

const SELECT =
  "id, kind, title, summary, body, link_href, publish_at, is_published, show_in_banner, banner_scope, require_ack, ack_until, notified_at, notified_count, emailed_at, emailed_count, created_at, updated_at";

const loadReleasedUpdates = unstable_cache(
  async (): Promise<SiteUpdate[]> => {
    if (!isSupabaseConfigured()) return [];
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("site_updates")
      .select(SELECT)
      .order("publish_at", { ascending: false })
      .limit(100);
    return (data ?? []) as SiteUpdate[];
  },
  [SITE_UPDATES_TAG],
  { revalidate: 300, tags: [SITE_UPDATES_TAG] },
);

/** Every released row, newest first (RLS hides drafts + scheduled). */
export const listReleasedUpdates = cache(loadReleasedUpdates);

export type NewsFeed = { updates: SiteUpdate[]; upcoming: SiteUpdate[] };

export async function getNewsFeed(): Promise<NewsFeed> {
  const rows = await listReleasedUpdates();
  return {
    updates: rows.filter((r) => r.kind === "update"),
    upcoming: rows.filter((r) => r.kind === "upcoming"),
  };
}

export type BannerSlice = {
  /** Newest released update flagged for the banner, if any. */
  headline: SiteUpdate | null;
  /** Released upcoming features flagged for the banner (newest first). */
  upcoming: SiteUpdate[];
};

export type BannerContent = {
  /** The admin's global switch (site_settings.updates_banner.enabled). */
  enabled: boolean;
  /** What the homepage ribbon shows: every banner-flagged update. */
  home: BannerSlice;
  /** What every other page shows: only updates scoped to the whole site. */
  site: BannerSlice;
};

function slice(rows: SiteUpdate[]): BannerSlice {
  return {
    headline: rows.find((r) => r.kind === "update") ?? null,
    upcoming: rows.filter((r) => r.kind === "upcoming").slice(0, 3),
  };
}

const loadBannerEnabled = unstable_cache(
  async (): Promise<boolean> => {
    if (!isSupabaseConfigured()) return true;
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "updates_banner")
      .maybeSingle();
    const value = (data?.value ?? {}) as { enabled?: unknown };
    return value.enabled !== false;
  },
  [SITE_UPDATES_TAG, "banner-enabled"],
  { revalidate: 300, tags: [SITE_UPDATES_TAG] },
);

export const isBannerEnabled = cache(loadBannerEnabled);

export async function getBannerContent(): Promise<BannerContent> {
  const [rows, enabled] = await Promise.all([listReleasedUpdates(), isBannerEnabled()]);
  const flagged = rows.filter((r) => r.show_in_banner);
  return {
    enabled,
    home: slice(flagged),
    site: slice(flagged.filter((r) => r.banner_scope === "site")),
  };
}

/** Released, ack-required rows the signed-in viewer has not acknowledged. */
export async function listPendingAcks(): Promise<SiteUpdate[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("site_updates")
    .select(SELECT)
    .eq("require_ack", true)
    .order("publish_at", { ascending: false })
    .limit(20);
  const candidates = ((rows ?? []) as SiteUpdate[]).filter((r) => needsAck(r));
  if (candidates.length === 0) return [];
  const { data: acks } = await supabase
    .from("site_update_acks")
    .select("update_id")
    .in(
      "update_id",
      candidates.map((c) => c.id),
    );
  const acked = new Set((acks ?? []).map((a) => a.update_id as string));
  return candidates.filter((c) => !acked.has(c.id));
}

/** Admin: every row, drafts and scheduled included (RLS admin policy). */
export async function listAllUpdatesForAdmin(): Promise<SiteUpdate[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("site_updates")
    .select(SELECT)
    .order("publish_at", { ascending: false })
    .limit(200);
  return (data ?? []) as SiteUpdate[];
}
