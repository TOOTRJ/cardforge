import type { Metadata, Viewport } from "next";
import { CardDetailContent } from "@/components/cards/card-detail-content";
import { getCardByOwnerAndSlug } from "@/lib/cards/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { CARD_SOCIAL_SIZE, cardAccentColor } from "@/lib/og/card-social";
import { getSiteBaseUrl } from "@/lib/site-url";

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

  // The 1200×630 landscape composite (whole card + name + creator on a
  // branded canvas). The raw portrait render crops on X, letterboxes on
  // Bluesky/Facebook, and exceeds WhatsApp's 600 KB preview cap — the
  // composite renders uncropped everywhere. `v` is a pure cache-buster so
  // an edited card re-unfurls instead of serving the CDN/scraper-cached
  // stale image forever (Discord in particular never refetches a URL).
  const version = Date.parse(card.updated_at);
  const ogImageUrl = isShareable
    ? `/api/cards/${card.id}/og?variant=social${Number.isFinite(version) ? `&v=${version}` : ""}`
    : undefined;
  const { width, height } = CARD_SOCIAL_SIZE;

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
          siteName: "PipGlyph",
          url: `/card/${username}/${card.slug}`,
          images: [
            {
              url: ogImageUrl,
              width,
              height,
              type: "image/jpeg",
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
      // oEmbed discovery — lets Discourse forums / WordPress blogs paste a
      // card URL and get a rich embed with a backlink.
      types: isShareable
        ? {
            "application/json+oembed": `/api/oembed?url=${encodeURIComponent(
              `${getSiteBaseUrl()}/card/${username}/${card.slug}`,
            )}&format=json`,
          }
        : undefined,
    },
  };
}

// Discord reads <meta name="theme-color"> as the embed's accent bar — tint
// it per card so PipGlyph unfurls are recognizable at a glance.
export async function generateViewport({
  params,
}: {
  params: Promise<Params>;
}): Promise<Viewport> {
  const { username, slug } = await params;
  if (!isSupabaseConfigured()) return {};
  // React cache()-deduped with the generateMetadata + page body calls.
  const card = await getCardByOwnerAndSlug(username, slug);
  if (!card) return {};
  return { themeColor: cardAccentColor(card.color_identity) };
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { username, slug } = await params;
  return <CardDetailContent username={username} slug={slug} variant="page" />;
}
