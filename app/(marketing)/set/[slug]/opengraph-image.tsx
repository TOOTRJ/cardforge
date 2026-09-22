import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { isSetsEnabled } from "@/lib/sets/flags";
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

// Social-preview card for set pages (the deck version is its twin). An
// uploaded cover is embedded full-bleed — pre-fetched to a data URI so a dead
// storage URL degrades to the branded fallback instead of failing the render;
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
    return { set, username: await lookupUsername(supabase, set.owner_id) };
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
          <OgBody>Full expansions, themed decks, and remix collections.</OgBody>
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
        <OgCoverHero
          cover={cover}
          eyebrow="Card set · PipGlyph"
          title={set.title}
          byline={byline}
        />
      ),
      size,
    );
  }

  return new ImageResponse(
    (
      <OgShell>
        <OgEyebrow>Card set</OgEyebrow>
        <OgTitle text={set.title} />
        {set.description ? <OgBody>{ogExcerpt(set.description)}</OgBody> : null}
        <OgBody tone="dim">{byline}</OgBody>
      </OgShell>
    ),
    size,
  );
}
