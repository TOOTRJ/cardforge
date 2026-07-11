import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { isSetsEnabled } from "@/lib/sets/flags";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createPublicClient } from "@/lib/supabase/public";
import {
  fetchImageAsDataUri,
  OG_SIZE,
  OgEyebrow,
  OgShell,
  OgTitle,
} from "@/lib/og/shell";

// Social-preview card for set pages. When the set has an uploaded cover we
// embed it full-bleed (pre-fetched to a data URI so a dead storage URL
// degrades to the branded fallback instead of failing the whole render);
// coverless sets previously unfurled with the generic site image.

export const alt = "A custom card set on PipGlyph";
export const size = OG_SIZE;
export const contentType = "image/png";

type OgSet = {
  title: string;
  description: string | null;
  cover_url: string | null;
  visibility: string;
  owner_id: string;
};

async function getSet(
  slug: string,
): Promise<{ set: OgSet; username: string | null } | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = createPublicClient();
    // Anonymous RLS only surfaces public/unlisted rows, so a private set
    // falls through to the generic branded card — nothing leaks.
    const { data: sets } = await supabase
      .from("card_sets")
      .select("title, description, cover_url, visibility, owner_id")
      .eq("slug", slug)
      .order("updated_at", { ascending: false })
      .limit(1);
    const set = sets?.[0] as OgSet | undefined;
    if (!set) return null;
    const { data: owner } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", set.owner_id)
      .maybeSingle();
    return { set, username: owner?.username ?? null };
  } catch {
    return null;
  }
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!isSetsEnabled()) notFound();
  const { slug } = await params;
  const result = await getSet(slug);

  if (!result) {
    return new ImageResponse(
      (
        <OgShell>
          <OgEyebrow>Community sets</OgEyebrow>
          <OgTitle text="Custom card sets" />
          <p style={{ margin: 0, fontSize: 26, color: "#9aa3b5" }}>
            Full expansions, themed decks, and remix collections.
          </p>
        </OgShell>
      ),
      size,
    );
  }

  const { set, username } = result;
  const cover = set.cover_url
    ? await fetchImageAsDataUri(set.cover_url)
    : null;
  const byline = username ? `by @${username}` : "on PipGlyph";

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
              Card set · PipGlyph
            </span>
            <span
              style={{
                fontSize: set.title.length > 36 ? 52 : 64,
                fontWeight: 700,
                lineHeight: 1.08,
                letterSpacing: -1,
              }}
            >
              {set.title}
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
        <OgEyebrow>Card set</OgEyebrow>
        <OgTitle text={set.title} />
        {set.description ? (
          <p
            style={{
              margin: 0,
              fontSize: 26,
              lineHeight: 1.45,
              color: "#9aa3b5",
              maxWidth: 880,
            }}
          >
            {set.description.length > 120
              ? `${set.description.slice(0, 117)}…`
              : set.description}
          </p>
        ) : null}
        <p style={{ margin: 0, fontSize: 24, color: "#6e7687" }}>{byline}</p>
      </OgShell>
    ),
    size,
  );
}
