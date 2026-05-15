import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { resolveLegacyCardSlug } from "@/lib/cards/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Legacy redirector (Phase 11 chunk 11).
//
// The canonical public URL is now `/card/[username]/[slug]`. This file
// preserves the old `/card/[slug]` shape so existing share links, gallery
// embeds, and search engine results keep working — it resolves the slug
// to its unambiguous owner and 301s to the canonical path.
//
// Resolution rules (see resolveLegacyCardSlug):
//   - Slug must match exactly one PUBLIC or UNLISTED card.
//   - That card's owner must have a username set.
//   - Anything else → 404.
//
// We deliberately don't fall back to "most recently updated" the way the
// pre-chunk-11 detail page did. That behavior was the slug-cybersquatting
// hole this chunk closes; emulating it in the redirector would defeat
// the purpose.
// ---------------------------------------------------------------------------

type Params = { slug: string };

export const metadata: Metadata = {
  // The redirect happens before the page renders, so search engines see
  // the destination's metadata via the 301. Set robots noindex here as
  // belt-and-braces so anything that DOES reach this stub doesn't get
  // indexed as a duplicate of the canonical URL.
  robots: { index: false, follow: false },
};

export default async function LegacyCardSlugPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;

  if (!isSupabaseConfigured()) {
    notFound();
  }

  const resolved = await resolveLegacyCardSlug(slug);
  if (!resolved) {
    notFound();
  }

  // 301 permanent — the new URL is the canonical home. Browsers and
  // search crawlers will update their cached references.
  permanentRedirect(`/card/${resolved.username}/${resolved.slug}`);
}
