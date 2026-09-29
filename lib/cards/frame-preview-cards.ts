import "server-only";

import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  BAKE_SELECT_COLUMNS,
  rowToPreviewData,
  type CardRowForBake,
} from "@/lib/cards/bake-core";
import {
  toFramePreviewCard,
  type FramePreviewCard,
} from "@/lib/cards/frame-preview-groups";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// The admins' walked preview cards (TODO 2.3) — every card flagged
// `frame_preview` (migration 0121), whichever admin saved it, for the
// checklist and the template sign-off in /admin/frame-compare. Read through
// the service role: the rows are private, and the caller has already checked
// is_admin. Never fatal: before 0121 runs (or on any error) the list is
// empty.
// ---------------------------------------------------------------------------

/** Upper bound — previews are a working set, not an archive. */
const PREVIEW_LIMIT = 500;

type PreviewRow = CardRowForBake & {
  slug: string;
  created_at: string;
};

export type FramePreviewCardWithRender = FramePreviewCard & {
  /** What the bake would draw (the second face included) — for the
   *  sign-off view's live render. */
  previewData: CardPreviewData;
};

export async function listFramePreviewCards(
  viewerId: string | null,
  options: { profileOverrides?: FrameProfileOverridesMap | null } = {},
): Promise<FramePreviewCardWithRender[]> {
  if (!isAdminConfigured()) return [];
  try {
    // Every preview (a few dozen at most), grouped by the caller: a stored
    // legacy template value groups under the frame it renders as, which a
    // filter on the raw JSON value would miss.
    const { data, error } = await createAdminClient()
      .from("cards")
      .select(`${BAKE_SELECT_COLUMNS}, slug, created_at`)
      .eq("frame_preview", true)
      .order("created_at", { ascending: false })
      .limit(PREVIEW_LIMIT);
    if (error || !data) return [];
    return (data as unknown as PreviewRow[]).map((row) => ({
      ...toFramePreviewCard(
        {
          id: row.id,
          slug: row.slug,
          title: row.title,
          ownerId: row.owner_id,
          createdAt: row.created_at,
          template: (row.frame_style as { template?: string } | null)?.template,
          colorIdentity: row.color_identity,
        },
        viewerId,
      ),
      previewData: rowToPreviewData(row, null, options.profileOverrides ?? null),
    }));
  } catch {
    return [];
  }
}
