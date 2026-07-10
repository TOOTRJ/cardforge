import { ImageResponse } from "next/og";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createPublicClient } from "@/lib/supabase/public";
import {
  fetchImageAsDataUri,
  OG_SIZE,
  OgEyebrow,
  OgShell,
  OgTitle,
} from "@/lib/og/shell";
import { DECK_FORMAT_LABELS, isDeckFormat } from "@/types/deck";

// Social-preview card for deck pages — clone of the set version. When the
// deck has an uploaded cover we embed it full-bleed (pre-fetched to a data
// URI so a dead storage URL degrades to the branded fallback instead of
// failing the whole render).

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
    const { data: owner } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", deck.owner_id)
      .maybeSingle();
    return { deck, username: owner?.username ?? null };
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
    return new ImageResponse(
      (
        <OgShell>
          <OgEyebrow>Community decks</OgEyebrow>
          <OgTitle text="Custom card decks" />
          <p style={{ margin: 0, fontSize: 26, color: "#9aa3b5" }}>
            Real decks rebuilt with custom cards.
          </p>
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
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            position: "relative",
            fontFamily: "system-ui, sans-serif",
            background: "#0d1320",
          }}
        >
          <img
            src={cover}
            alt=""
            width={OG_SIZE.width}
            height={OG_SIZE.height}
            style={{ objectFit: "cover" }}
          />
          {/* Legibility scrim behind the title block */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 320,
              display: "flex",
              background:
                "linear-gradient(180deg, rgba(13,19,32,0) 0%, rgba(13,19,32,0.92) 70%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 72,
              right: 72,
              bottom: 48,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              color: "#f2f3f5",
            }}
          >
            <span
              style={{
                fontSize: 20,
                letterSpacing: 4,
                textTransform: "uppercase",
                color: "#d8b26e",
                fontWeight: 600,
              }}
            >
              {formatLabel} deck · PipGlyph
            </span>
            <span
              style={{
                fontSize: deck.title.length > 36 ? 52 : 64,
                fontWeight: 700,
                lineHeight: 1.08,
                letterSpacing: -1,
              }}
            >
              {deck.title}
            </span>
            <span style={{ fontSize: 24, color: "#9aa3b5" }}>{byline}</span>
          </div>
        </div>
      ),
      size,
    );
  }

  return new ImageResponse(
    (
      <OgShell>
        <OgEyebrow>{`${formatLabel} deck`}</OgEyebrow>
        <OgTitle text={deck.title} />
        {deck.description ? (
          <p
            style={{
              margin: 0,
              fontSize: 26,
              lineHeight: 1.45,
              color: "#9aa3b5",
              maxWidth: 880,
            }}
          >
            {deck.description.length > 120
              ? `${deck.description.slice(0, 117)}…`
              : deck.description}
          </p>
        ) : null}
        <p style={{ margin: 0, fontSize: 24, color: "#6e7687" }}>{byline}</p>
      </OgShell>
    ),
    size,
  );
}
