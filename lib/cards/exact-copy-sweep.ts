import "server-only";

import { revalidatePath } from "next/cache";
import type { createAdminClient } from "@/lib/supabase/admin";
import { isExactCopyOfImport, type ExactCopyCard } from "@/lib/cards/exact-copy";
import { EXACT_COPY_COLUMNS } from "@/lib/cards/exact-copy-read";
import { revalidateCardListSurfaces, revalidateCardPages, type CardPageRef } from "@/lib/cards/revalidate";

// ---------------------------------------------------------------------------
// The hourly sweep (/api/cron/exact-copies, owner 2026-11-06): a PUBLIC card
// that is still exactly the real card it was imported from
// (lib/cards/exact-copy.ts) is moved to UNLISTED, and its owner is told once
// per run in ONE `exact_copy_unlisted` notification. Its page and links keep
// working; every list, hub, trending row and the sitemap leave unlisted cards
// out, so nothing else changes. The first run after the deploy moves the
// exact copies saved before the rule; later runs only catch one that went
// public behind the app's back (a raw API write). Idempotent: a card is
// moved only while it is still public (the UPDATE says so), and a card that
// was changed is no longer an exact copy.
//
// Only rows with a stored fingerprint can be one, so the scan reads those
// (public, `import_fingerprint` not null) a page at a time, by id.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

/** Rows read per page, and pages per run (a run stays well inside the
 *  route's maxDuration; what is left waits for the next hour). */
const PAGE_SIZE = 500;
const MAX_PAGES = 20;
/** UPDATEs in flight at once (one per card: each is held to its row's
 *  `updated_at` as scanned). */
const UPDATE_CONCURRENCY = 8;
/** Cards a notification names (its count is the full number). */
const NOTIFY_NAMES = 3;

export type ExactCopySweepResult = {
  /** Public cards with a fingerprint the run read. */
  scanned: number;
  /** Of those, still exact copies. */
  exactCopies: number;
  /** Moved to unlisted by this run. */
  unlisted: number;
  /** Owners told. */
  notified: number;
  errors: number;
  /** More rows were waiting when the run stopped at MAX_PAGES. */
  more: boolean;
};

type ScanRow = ExactCopyCard & {
  id: string;
  owner_id: string;
  slug: string | null;
  title: string | null;
  updated_at: string;
};

export async function unlistPublicExactCopies(admin: AdminClient): Promise<ExactCopySweepResult> {
  const result: ExactCopySweepResult = { scanned: 0, exactCopies: 0, unlisted: 0, notified: 0, errors: 0, more: false };
  const columns = [...EXACT_COPY_COLUMNS, "owner_id", "slug", "updated_at"].join(", ");

  const copies: ScanRow[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = admin
      .from("cards")
      .select(columns)
      .eq("visibility", "public")
      .not("import_fingerprint", "is", null)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw new Error(`exact-copy scan failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ScanRow[];
    result.scanned += rows.length;
    copies.push(...rows.filter(isExactCopyOfImport));
    if (rows.length < PAGE_SIZE) break;
    after = rows[rows.length - 1]!.id;
    if (page === MAX_PAGES - 1) result.more = true;
  }
  result.exactCopies = copies.length;
  if (copies.length === 0) return result;

  // Move them — each only while it is still public AND unedited since the
  // scan (`updated_at` as read; a render write never moves it, 0108): a card
  // its owner unlisted, made private or customised meanwhile is left alone,
  // and the rows that come back are exactly the ones this run moved.
  const moved: ScanRow[] = [];
  for (let i = 0; i < copies.length; i += UPDATE_CONCURRENCY) {
    const batch = copies.slice(i, i + UPDATE_CONCURRENCY);
    const answers = await Promise.all(
      batch.map((card) =>
        admin
          .from("cards")
          .update({ visibility: "unlisted" })
          .eq("id", card.id)
          .eq("visibility", "public")
          .eq("updated_at", card.updated_at)
          .select("id"),
      ),
    );
    answers.forEach(({ data, error }, index) => {
      if (error) {
        console.error("[exact-copies] unlist failed:", error.message);
        result.errors += 1;
      } else if ((data ?? []).length > 0) {
        moved.push(batch[index]!);
      }
    });
  }
  result.unlisted = moved.length;
  if (moved.length === 0) return result;

  // The owners' handles, for their cards' pages and their profiles.
  const ownerIds = [...new Set(moved.map((card) => card.owner_id))];
  const { data: profiles } = await admin.from("profiles").select("id, username").in("id", ownerIds);
  const usernames = new Map((profiles ?? []).map((p) => [p.id, p.username as string | null]));

  const pages: CardPageRef[] = moved.map((card) => ({
    id: card.id,
    slug: card.slug,
    ownerUsername: usernames.get(card.owner_id) ?? null,
  }));
  revalidateCardListSurfaces();
  revalidateCardPages(pages);
  for (const username of usernames.values()) if (username) revalidatePath(`/profile/${username}`);

  // One notification per owner and run.
  for (const ownerId of ownerIds) {
    const theirs = moved.filter((card) => card.owner_id === ownerId);
    const { error } = await admin.from("notifications").insert({
      recipient_id: ownerId,
      actor_id: null,
      type: "exact_copy_unlisted",
      payload: {
        count: theirs.length,
        titles: theirs.slice(0, NOTIFY_NAMES).map((card) => card.title ?? "Untitled"),
        cardIds: theirs.slice(0, 50).map((card) => card.id),
      },
    });
    if (error) {
      console.error("[exact-copies] notification failed:", error.message);
      result.errors += 1;
    } else {
      result.notified += 1;
    }
  }
  return result;
}
