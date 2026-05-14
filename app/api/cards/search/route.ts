import { NextResponse, type NextRequest } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// GET /api/cards/search?q=<query>&limit=<n>
//
// Owner-scoped search over the caller's own cards. Powers the command
// palette's "My Cards" tab so users can jump to any of their cards
// without navigating through the dashboard.
//
// Auth-gated. RLS keeps cross-user reads impossible at the DB level — the
// explicit `.eq("owner_id", user.id)` is a belt-and-braces clarity guard.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const MAX_QUERY_LENGTH = 200;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

type TrimmedCard = {
  id: string;
  slug: string;
  title: string;
  visibility: "private" | "unlisted" | "public";
  card_type: string | null;
  rarity: string | null;
  art_url: string | null;
  updated_at: string;
};

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in to search your cards." },
      { status: 401 },
    );
  }

  const params = request.nextUrl.searchParams;
  const query = (params.get("q") ?? "").trim();
  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { ok: false, error: "Query is too long." },
      { status: 400 },
    );
  }

  const limitRaw = Number(params.get("limit") ?? String(DEFAULT_LIMIT));
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.round(limitRaw)))
    : DEFAULT_LIMIT;

  const supabase = await createClient();
  // Pull the most-recently-updated cards owned by the caller. If a query
  // is present, ILIKE-filter by title. We escape SQL wildcards so a user
  // typing `_` or `%` doesn't accidentally widen the match.
  let q = supabase
    .from("cards")
    .select(
      "id, slug, title, visibility, card_type, rarity, art_url, updated_at",
    )
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (query) {
    const escaped = query.replace(/[%_]/g, "\\$&");
    q = q.ilike("title", `%${escaped}%`);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  const results: TrimmedCard[] = (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    visibility: row.visibility as "private" | "unlisted" | "public",
    card_type: row.card_type,
    rarity: row.rarity,
    art_url: row.art_url,
    updated_at: row.updated_at,
  }));

  return NextResponse.json({ ok: true, results });
}
