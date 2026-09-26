import { ogImageResponse } from "@/lib/og/image-response";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createPublicClient } from "@/lib/supabase/public";
import { lookupUsername } from "@/lib/profile/username";
import {
  fetchImageAsDataUri,
  OG_SIZE,
  OgBody,
  OgCoverHero,
  OgEyebrow,
  OgShell,
  OgTitle,
  ogExcerpt,
} from "@/lib/og/shell";
import { DECK_FORMAT_LABELS, isDeckFormat } from "@/types/deck";

// Social-preview card for deck pages (the set version is its twin). An
// uploaded cover is embedded full-bleed — pre-fetched to a data URI so a dead
// storage URL degrades to the branded fallback instead of failing the render.

export const alt = "A custom card deck on PipGlyph";
export const size = OG_SIZE;
export const contentType = "image/png";

type OgDeck = {
  title: string;
  description: string | null;
  cover_url: string | null;
  format: string;
  owner_id: string;
};

async function getDeck(
  slug: string,
): Promise<{ deck: OgDeck; username: string | null } | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = createPublicClient();
    // Anonymous RLS only surfaces public/unlisted rows, so a private deck
    // falls through to the generic branded card — nothing leaks.
    const { data: deck } = await supabase
      .from("decks")
      .select("title, description, cover_url, format, owner_id")
      .eq("slug", slug)
      .maybeSingle();
    if (!deck) return null;
    return { deck, username: await lookupUsername(supabase, deck.owner_id) };
  } catch {
    return null;
  }
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await getDeck(slug);

  if (!result) {
    return ogImageResponse(
      (
        <OgShell>
          <OgEyebrow>Community decks</OgEyebrow>
          <OgTitle text="Custom card decks" />
          <OgBody>Real decks rebuilt with custom cards.</OgBody>
        </OgShell>
      ),
      size,
    );
  }

  const { deck, username } = result;
  const cover = deck.cover_url
    ? await fetchImageAsDataUri(deck.cover_url)
    : null;
  const byline = username ? `by @${username}` : "on PipGlyph";
  const formatLabel = isDeckFormat(deck.format)
    ? DECK_FORMAT_LABELS[deck.format]
    : "Deck";

  if (cover) {
    return ogImageResponse(
      (
        <OgCoverHero
          cover={cover}
          eyebrow={`${formatLabel} deck · PipGlyph`}
          title={deck.title}
          byline={byline}
        />
      ),
      size,
    );
  }

  return ogImageResponse(
    (
      <OgShell>
        <OgEyebrow>{`${formatLabel} deck`}</OgEyebrow>
        <OgTitle text={deck.title} />
        {deck.description ? <OgBody>{ogExcerpt(deck.description)}</OgBody> : null}
        <OgBody tone="dim">{byline}</OgBody>
      </OgShell>
    ),
    size,
  );
}
