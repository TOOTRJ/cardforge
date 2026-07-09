import type { Metadata } from "next";
import { CardDetailContent } from "@/components/cards/card-detail-content";
import { getCardByOwnerAndSlug } from "@/lib/cards/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// Canonical public card detail page (Phase 11 chunk 11).
//
// URL: /card/[username]/[slug]
//
// The username-namespaced URL eliminates slug ambiguity — two different
// owners can each have a card named "lightning-bolt" without one
// hijacking the other's public link. The legacy `/card/[slug]` route is
// preserved as a 301 redirector (see app/(marketing)/card/[slug]/page.tsx).
//
// The body lives in CardDetailContent, shared with the intercepting route
// at app/@modal/(.)card/[username]/[slug] that renders the same view in a
// dialog when the viewer clicks a card tile in-app. This full page serves
// direct visits, refreshes, and crawlers — so metadata stays here.
// ---------------------------------------------------------------------------

type Params = { username: string; slug: string };

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : ""))
    .join(" ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { username, slug } = await params;
  if (!isSupabaseConfigured()) {
    return { title: titleFromSlug(slug) };
  }
  const card = await getCardByOwnerAndSlug(username, slug);
  if (!card) {
    return { title: titleFromSlug(slug) };
  }

  const isShareable =
    card.visibility === "public" || card.visibility === "unlisted";
  const description =
    card.flavor_text?.trim() ||
    card.rules_text?.trim() ||
    "A custom trading card on PipGlyph.";

  const ogImageUrl = isShareable ? `/api/cards/${card.id}/og` : undefined;
  const { width, height } = RENDER_PRESETS.default;

  return {
    // Unlisted cards are reachable by link but shouldn't enter the index;
    // private renders only ever reach the owner, but belt-and-braces.
    robots: card.visibility !== "public" ? { index: false, follow: false } : undefined,
    title: card.title,
    description,
    openGraph: ogImageUrl
      ? {
          title: `${card.title} · PipGlyph`,
          description,
          type: "article",
          url: `/card/${username}/${card.slug}`,
          images: [
            {
              url: ogImageUrl,
              width,
              height,
              alt: `${card.title} card preview`,
            },
          ],
        }
      : undefined,
    twitter: ogImageUrl
      ? {
          card: "summary_large_image",
          title: `${card.title} · PipGlyph`,
          description,
          images: [ogImageUrl],
        }
      : undefined,
    alternates: {
      canonical: `/card/${username}/${card.slug}`,
    },
  };
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { username, slug } = await params;
  return <CardDetailContent username={username} slug={slug} variant="page" />;
}
