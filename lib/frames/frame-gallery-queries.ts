import "server-only";

import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { verifiedKeysOfRows } from "@/lib/cards/frame-reviews";
import { buildCardPath } from "@/lib/cards/utils";
import {
  FRAME_EXAMPLE_COLUMNS,
  buildFrameGallery,
  galleryEntries,
  pickFrameExamples,
  type FrameExampleRow,
  type FrameGallerySection,
} from "@/lib/frames/frame-gallery";
import type { CardType, ColorIdentity, FrameStyle, FrameTemplate, Rarity } from "@/types/card";

// ---------------------------------------------------------------------------
// The /frames reads (TODO NV8), all through the cookie-free public client so
// the page and the sitemap stay ISR-eligible; React cache() lets the page and
// its generateMetadata share them.
//
//   * The frames: ONE read of the verified combos (frame_reviews is
//     world-readable), turned into the creator's own groups
//     (lib/frames/frame-gallery.ts buildFrameGallery). The sitemap reads only
//     this.
//   * The examples: public cards stored on those templates with a bake, most
//     liked first, in batched reads — never one per frame. A read asks only
//     for the templates still without an example, so a page full of the
//     common frame never hides a rare one: the next read leaves that frame
//     out. Usually one or two reads; a template still missing after
//     EXAMPLE_ROUNDS shows its empty master.
//
// Fail-soft like the other public lists: an error leaves the list empty (the
// page says so and is noindex) or a frame without its example — never a
// thrown page.
// ---------------------------------------------------------------------------

/** Rows per example read. */
const EXAMPLE_PAGE = 200;
/** The most example reads one build makes. */
const EXAMPLE_ROUNDS = 4;

export type FrameGalleryFrames = {
  sections: FrameGallerySection[];
  /** Why the list may be empty for another reason than "nothing verified". */
  error: string | null;
};

export const getFrameGalleryFrames = cache(async (): Promise<FrameGalleryFrames> => {
  if (!isSupabaseConfigured()) return { sections: [], error: "offline" };
  try {
    const { data, error } = await createPublicClient()
      .from("frame_reviews")
      .select("template, color_key, verified_layout_version")
      .eq("verified", true);
    if (error) {
      console.warn("getFrameGalleryFrames: read failed", error.message);
      return { sections: [], error: "unavailable" };
    }
    return { sections: buildFrameGallery(new Set(verifiedKeysOfRows(data ?? []))), error: null };
  } catch (error) {
    console.warn("getFrameGalleryFrames: failed", error instanceof Error ? error.message : error);
    return { sections: [], error: "unavailable" };
  }
});

/** A frame's example, as the tile draws it. */
export type FrameExample = {
  id: string;
  title: string;
  /** The card's canonical page. */
  path: string;
  ownerUsername: string | null;
  cardType: CardType | null;
  rarity: Rarity | null;
  colorIdentity: ColorIdentity[];
  frameStyle: FrameStyle;
  renderedImageUrl: string;
  renderedThumbUrl: string;
  renderedBackThumbUrl: string | null;
};

export type FrameGallery = FrameGalleryFrames & {
  examples: Partial<Record<FrameTemplate, FrameExample>>;
};

/** The example card of each template (absent = none public yet). */
async function readFrameExamples(
  templates: readonly FrameTemplate[],
): Promise<Partial<Record<FrameTemplate, FrameExample>>> {
  if (templates.length === 0) return {};
  const supabase = createPublicClient();
  const rows = new Map<FrameTemplate, FrameExampleRow>();
  let missing = [...templates];
  for (let round = 0; round < EXAMPLE_ROUNDS && missing.length > 0; round++) {
    const { data, error } = await supabase
      .from("cards")
      .select(FRAME_EXAMPLE_COLUMNS)
      .eq("visibility", "public")
      .not("rendered_image_url", "is", null)
      .not("rendered_thumb_url", "is", null)
      .in("frame_style->>template", missing)
      .order("likes_count", { ascending: false })
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(EXAMPLE_PAGE);
    if (error) {
      console.warn("readFrameExamples: read failed", error.message);
      break;
    }
    const page = (data ?? []) as unknown as FrameExampleRow[];
    const picked = pickFrameExamples(page, missing);
    for (const [template, row] of picked) rows.set(template, row);
    // A short page held every candidate left; a full one found at least one
    // more frame (or none at all — then another read would see the same).
    if (page.length < EXAMPLE_PAGE || picked.size === 0) break;
    missing = missing.filter((template) => !rows.has(template));
  }
  if (rows.size === 0) return {};

  const ownerIds = [...new Set([...rows.values()].map((row) => row.owner_id))];
  const { data: owners, error } = await supabase.from("profiles").select("id, username").in("id", ownerIds);
  if (error) console.warn("readFrameExamples: owner read failed", error.message);
  const usernameById = new Map((owners ?? []).map((owner) => [owner.id, owner.username]));

  const examples: Partial<Record<FrameTemplate, FrameExample>> = {};
  for (const [template, row] of rows) {
    const username = usernameById.get(row.owner_id) ?? null;
    examples[template] = {
      id: row.id,
      title: row.title,
      path: buildCardPath({ slug: row.slug, owner: username ? { username } : null }),
      ownerUsername: username,
      cardType: row.card_type as CardType | null,
      rarity: row.rarity as Rarity | null,
      colorIdentity: (row.color_identity ?? []) as ColorIdentity[],
      frameStyle: (row.frame_style ?? {}) as FrameStyle,
      // pickFrameExamples kept only rows with both.
      renderedImageUrl: row.rendered_image_url!,
      renderedThumbUrl: row.rendered_thumb_url!,
      renderedBackThumbUrl: row.rendered_back_thumb_url,
    };
  }
  return examples;
}

/** The frames and their examples — the page's read. */
export const getFrameGallery = cache(async (): Promise<FrameGallery> => {
  const frames = await getFrameGalleryFrames();
  if (frames.sections.length === 0) return { ...frames, examples: {} };
  try {
    const templates = galleryEntries(frames.sections).map((entry) => entry.template);
    return { ...frames, examples: await readFrameExamples(templates) };
  } catch (error) {
    console.warn("getFrameGallery: examples failed", error instanceof Error ? error.message : error);
    return { ...frames, examples: {} };
  }
});
