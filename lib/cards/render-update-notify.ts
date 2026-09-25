import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { CARD_LAYOUT_VERSION, hasNewerLook, latestOptInVersion } from "@/lib/cards/layout-version";

// ---------------------------------------------------------------------------
// "Your cards have a newer look" notifications.
//
// A CARD_LAYOUT_VERSION bump ships with a deploy; nothing tells owners
// unless they happen to open the dashboard. The daily cron
// (/api/cron/notify-render-updates) walks every published card whose stored
// image is stale for its frame, counts them per owner, and inserts ONE
// `render_update` notification per owner per version (payload
// { version, count }). Realtime (0075) delivers it as a toast to any open
// tab; clicking it opens the dashboard's update walkthrough.
//
// Only OPT-IN bumps are the owner's decision (hasNewerLook, TODO 0.20):
// the notification is keyed on the newest opt-in version, so a later
// SWEEP bump (a correction the platform re-bakes itself) never notifies
// anyone again, and a deploy with no opt-in version notifies nobody.
// ---------------------------------------------------------------------------

export type StaleCardRow = {
  owner_id: string;
  layout_version: number | null;
  frame_style: unknown;
  rendered_image_url?: string | null;
  visibility?: string | null;
  rarity?: string | null;
  set_icon_url?: string | null;
  set_icon_code?: string | null;
};

/** Template-aware stale count per owner. Pure — unit-tested. */
export function staleCountsByOwner(rows: Iterable<StaleCardRow>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    // Rows come from a public/unlisted scan; a missing render is "not baked
    // yet", not a newer look (lib/cards/layout-version.ts hasNewerLook).
    if (
      !hasNewerLook({
        visibility: row.visibility ?? "public",
        layout_version: row.layout_version,
        rendered_image_url: row.rendered_image_url ?? null,
        frame_style: row.frame_style,
        rarity: row.rarity,
        set_icon_url: row.set_icon_url,
        set_icon_code: row.set_icon_code,
      })
    ) {
      continue;
    }
    counts.set(row.owner_id, (counts.get(row.owner_id) ?? 0) + 1);
  }
  return counts;
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Insert the owner's notification for `version` (the newest opt-in bump)
 * unless one exists.
 * Returns true when a row was inserted.
 */
async function ensureRenderUpdateNotification(
  admin: Admin,
  ownerId: string,
  count: number,
  version: number = CARD_LAYOUT_VERSION,
): Promise<boolean> {
  const { data: existing } = await admin
    .from("notifications")
    .select("id")
    .eq("recipient_id", ownerId)
    .eq("type", "render_update")
    .contains("payload", { version })
    .limit(1);
  if (existing && existing.length > 0) return false;

  const { error } = await admin.from("notifications").insert({
    recipient_id: ownerId,
    actor_id: null,
    type: "render_update",
    payload: { version, count },
  });
  if (error) {
    console.warn(`ensureRenderUpdateNotification(${ownerId}): insert error`, error.message);
    return false;
  }
  return true;
}

const PAGE = 1000;
const MAX_ROWS = 50_000;

/**
 * The cron body: page through stale published cards (coarse SQL filter,
 * template-aware count in code), then notify each owner once.
 */
export async function notifyOwnersOfRenderUpdates(
  admin: Admin,
): Promise<{ owners: number; notified: number; scanned: number }> {
  const version = latestOptInVersion();
  if (version == null) return { owners: 0, notified: 0, scanned: 0 };
  const rows: StaleCardRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await admin
      .from("cards")
      .select("owner_id, layout_version, frame_style, rendered_image_url, visibility, rarity, set_icon_url, set_icon_code")
      .in("visibility", ["public", "unlisted"])
      // Coarse SQL filter; hasNewerLook decides. Null stamps and missing
      // renders are never a newer look, so they aren't scanned at all.
      .not("rendered_image_url", "is", null)
      .lt("layout_version", CARD_LAYOUT_VERSION)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as StaleCardRow[]));
    if (data.length < PAGE) break;
  }

  const counts = staleCountsByOwner(rows);
  let notified = 0;
  for (const [ownerId, count] of counts) {
    if (await ensureRenderUpdateNotification(admin, ownerId, count, version)) notified += 1;
  }
  return { owners: counts.size, notified, scanned: rows.length };
}
