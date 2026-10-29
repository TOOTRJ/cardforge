import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createPublicClient } from "@/lib/supabase/public";
import { lookupUsername } from "@/lib/profile/username";
import {
  fetchImageAsDataUri,
  OG_SIZE,
  OgBody,
  OgDeckHero,
  OgEyebrow,
  OgShell,
  OgTitle,
} from "@/lib/og/shell";
import { DECK_FORMAT_LABELS, isDeckFormat } from "@/types/deck";
import { deckCoverColors, deckCoverOf } from "@/lib/decks/cover";
import { featuredCardsOf, type FeaturableCard } from "@/lib/decks/featured";
import { withDeckVisibleCards } from "@/lib/decks/entry-status";
import { viaDeckLink } from "@/lib/decks/deck-link";
import { isLandscapeFrame } from "@/lib/cards/card-orientation";
import {
  DECK_SHARE_IMAGE_TYPE,
  deckCoverDataUri,
  deckShareImageResponse,
  renderDeckShareImage,
} from "@/lib/og/deck-share-image";

// Social-preview card for deck pages (TODO DK6.6): the deck page's hero,
// flat — the cover (an upload, or the default background its colours pick,
// lib/decks/cover.ts) with up to five of its PipGlyph cards fanned in front
// (lib/decks/featured.ts: commanders first, then a seeded pick of its custom
// cards). Every picture is pre-fetched to a data URI, so a dead URL drops
// that one picture, never the render. Served as JPEG, under WhatsApp's
// 600 KB (lib/og/deck-share-image.tsx).
//
// The fan here is the deck's OWN cards only — their stored bake thumbs,
// which carry the pipglyph.com mark like every display surface. A real
// printing's scan is drawn on the deck page (Scryfall's image, linked) but
// never baked into a PipGlyph share image.

export const alt = "A custom card deck on PipGlyph";
export const size = OG_SIZE;
export const contentType = DECK_SHARE_IMAGE_TYPE;

type OgCard = FeaturableCard & { color_identity: string[] | null; frame_style: unknown };

type OgDeck = {
  id: string;
  title: string;
  cover_url: string | null;
  cover_position: unknown;
  format: string;
  owner_id: string;
};

type OgEntry = {
  id: string;
  board: string;
  name: string;
  position: number;
  card_id: string | null;
  scryfall_id: string | null;
  image_url: string | null;
  type_line: string | null;
  color_identity: string[];
  card: OgCard | null;
};

async function getDeck(
  slug: string,
): Promise<{ deck: OgDeck; entries: OgEntry[]; username: string | null } | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = createPublicClient();
    // Anonymous RLS only surfaces public rows and an unlisted deck named by
    // its link (both reads name it by its slug — lib/decks/deck-link.ts,
    // migration 0150), so a private deck falls through to the generic
    // branded card — nothing leaks — and so does every private card in a
    // public deck (its embed is null).
    const { data: deck } = await viaDeckLink(
      supabase.from("decks").select("id, title, cover_url, cover_position, format, owner_id").eq("slug", slug),
      slug,
    ).maybeSingle();
    if (!deck) return null;
    const [{ data: entries }, username] = await Promise.all([
      viaDeckLink(
        supabase
          .from("deck_cards")
          .select(
            "id, board, name, position, card_id, scryfall_id, image_url, type_line, color_identity, card:cards(id, owner_id, title, visibility, rendered_image_url, rendered_thumb_url, color_identity, frame_style)",
          )
          .eq("deck_id", deck.id)
          .order("position", { ascending: true }),
        slug,
      ),
      lookupUsername(supabase, deck.owner_id),
    ]);
    return { deck, entries: (entries ?? []) as unknown as OgEntry[], username };
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
    return deckShareImageResponse(
      await renderDeckShareImage(
        <OgShell>
          <OgEyebrow>Community decks</OgEyebrow>
          <OgTitle text="Custom card decks" />
          <OgBody>Real decks rebuilt with custom cards.</OgBody>
        </OgShell>,
      ),
    );
  }

  const { deck, entries, username } = result;
  // Only the cards the deck may show (D3: another creator's card while it
  // is public — the rule the deck page's listDeckCards reads by; an
  // unlisted card's anonymous read is not null).
  const items = withDeckVisibleCards(
    entries.map(({ card, ...entry }) => ({ entry, card })),
    deck.owner_id,
  );
  const cover = deckCoverOf(deck, deckCoverColors(items));
  // The page's rule (commanders first, then the seeded fill, up to five),
  // filled from the baked PipGlyph cards alone.
  const customs = featuredCardsOf(items, deck, { printings: false });
  const [coverUri, ...thumbs] = await Promise.all([
    deckCoverDataUri(cover.src),
    ...customs.map(async (featured) => {
      if (featured.kind !== "custom" || !featured.card.rendered_thumb_url) return null;
      const src = await fetchImageAsDataUri(featured.card.rendered_thumb_url);
      return src ? { src, landscape: isLandscapeFrame(featured.card.frame_style) } : null;
    }),
  ]);
  const byline = username ? `by @${username}` : "on PipGlyph";
  const formatLabel = isDeckFormat(deck.format)
    ? DECK_FORMAT_LABELS[deck.format]
    : "Deck";

  return deckShareImageResponse(
    await renderDeckShareImage(
      <OgDeckHero
        cover={coverUri}
        cards={thumbs.filter((thumb) => thumb !== null)}
        eyebrow={`${formatLabel} deck`}
        title={deck.title}
        byline={byline}
      />,
    ),
  );
}
