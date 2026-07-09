import { NextResponse, type NextRequest } from "next/server";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getSiteBaseUrl } from "@/lib/site-url";
import { RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// oEmbed provider endpoint (https://oembed.com) for public card pages.
//
// Card pages advertise this via <link rel="alternate"
// type="application/json+oembed"> (see the card page's generateMetadata), so
// Discourse forums, WordPress blogs, and embed.ly-class consumers that get a
// pasted PipGlyph card link render a rich card embed with a backlink instead
// of a bare URL. We answer as a `photo` type pointing at the portrait card
// render — universally supported, no iframe surface to maintain.
//
// Spec bits honored: `url` (required), `format` (json only — 501 on xml),
// `maxwidth`/`maxheight` (we scale the reported dimensions down, never up).
// Cookie-free public client keeps this cacheable and leak-proof: private
// cards are invisible to the anon role, and we filter to shareable
// visibilities anyway.
// ---------------------------------------------------------------------------

const CACHE_HEADER = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

const CARD_PATH_PATTERN = /^\/card\/([a-zA-Z0-9_-]+)\/([a-z0-9-]+)\/?$/;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const format = params.get("format");
  if (format && format !== "json") {
    return NextResponse.json(
      { error: "Only json format is supported" },
      { status: 501 },
    );
  }

  const rawUrl = params.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  const siteBase = getSiteBaseUrl();
  let target: URL;
  try {
    target = new URL(rawUrl, siteBase);
  } catch {
    return NextResponse.json({ error: "Invalid url parameter" }, { status: 400 });
  }
  if (target.origin !== new URL(siteBase).origin) {
    return NextResponse.json({ error: "Unknown resource" }, { status: 404 });
  }

  const match = CARD_PATH_PATTERN.exec(target.pathname);
  if (!match) {
    return NextResponse.json({ error: "Unknown resource" }, { status: 404 });
  }
  const [, username, slug] = match;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }

  let card: {
    id: string;
    title: string;
    updated_at: string;
  } | null = null;
  let ownerDisplay = username;
  try {
    const supabase = createPublicClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, display_name")
      .eq("username", username)
      .maybeSingle();
    if (!profile) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    ownerDisplay = profile.display_name || profile.username || username;

    const { data } = await supabase
      .from("cards")
      .select("id, title, updated_at, visibility")
      .eq("owner_id", profile.id)
      .eq("slug", slug)
      .in("visibility", ["public", "unlisted"])
      .maybeSingle();
    card = data;
  } catch {
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  if (!card) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Scale the reported size to the consumer's cap (never upscale).
  const natural = RENDER_PRESETS.default;
  const maxWidth = positiveInt(params.get("maxwidth")) ?? natural.width;
  const maxHeight = positiveInt(params.get("maxheight")) ?? natural.height;
  const scale = Math.min(maxWidth / natural.width, maxHeight / natural.height, 1);
  const width = Math.round(natural.width * scale);
  const height = Math.round(natural.height * scale);

  const version = Date.parse(card.updated_at);
  const imageUrl = `${siteBase}/api/cards/${card.id}/og${
    Number.isFinite(version) ? `?v=${version}` : ""
  }`;

  return NextResponse.json(
    {
      version: "1.0",
      type: "photo",
      title: card.title,
      url: imageUrl,
      width,
      height,
      author_name: ownerDisplay,
      author_url: `${siteBase}/profile/${username}`,
      provider_name: "PipGlyph",
      provider_url: siteBase,
      thumbnail_url: imageUrl,
      thumbnail_width: width,
      thumbnail_height: height,
      web_page: `${siteBase}/card/${username}/${slug}`,
      cache_age: 86400,
    },
    { headers: { "Cache-Control": CACHE_HEADER } },
  );
}

function positiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
