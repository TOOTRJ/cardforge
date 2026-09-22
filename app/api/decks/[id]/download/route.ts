import { NextResponse, type NextRequest } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { requireTier, UpgradeRequiredError } from "@/lib/billing/entitlements";
import { isAllowedServerImageFetchUrl } from "@/lib/validation/card";
import { listDeckCards } from "@/lib/decks/queries";
import { computeDeckAnalytics } from "@/lib/decks/analytics";
import { deckToText } from "@/lib/decks/export-text";
import { getDeckGuide } from "@/lib/decks/guides";
import { buildDeckReportPdf } from "@/lib/decks/deck-report-pdf";
import { commanderBracket, deckTypeByKey } from "@/lib/decks/deck-types";
import { DECK_BOARD_LABELS, DECK_FORMAT_LABELS, isDeckFormat } from "@/types/deck";
import { getSiteBaseUrl } from "@/lib/site-url";
import type { DeckExportManifest } from "@/lib/decks/export-client";
import { isUuid } from "@/lib/ids";

// ---------------------------------------------------------------------------
// /api/decks/[id]/download — the pieces of a Pro whole-deck export.
//
// The export itself is assembled IN THE BROWSER (lib/decks/export-client.ts,
// driven by components/decks/deck-export-provider.tsx): the client asks for
// the manifest, fetches every card's CLEAN render one by one from
// /api/cards/[id]/png (which follows the viewer's plan — a Pro download is
// never the watermarked bake), shows live progress, and zips / lays out the
// PDF locally. That keeps a 100-card deck off a single 300 s function and
// lets the user keep browsing while it builds. Owner-only, Pro-only.
//
//   ?part=manifest → JSON: the custom cards to render (+ copies), the
//                    checklist of un-remixed entries, whether a cover exists
//   ?part=report   → deck.pdf (stats, decklist by board, AI guide + combos)
//   ?part=decklist → decklist.txt
//   ?part=cover    → the cover image bytes (proxied from our storage host)
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 60;

/** Unique custom cards per export and physical copies on print sheets. */
export const MAX_EXPORT_CARDS = 150;
const MAX_PHYSICAL_COPIES = 150;

type RouteParams = { id: string };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> },
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid deck id" }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to export a deck." }, { status: 401 });
  }

  try {
    await requireTier("pro");
  } catch (error) {
    if (error instanceof UpgradeRequiredError) {
      return NextResponse.json(
        { error: "Whole-deck export is a Pro feature.", code: "UPGRADE_REQUIRED" },
        { status: 403 },
      );
    }
    throw error;
  }

  const supabase = await createClient();
  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, title, description, format, deck_type, bracket, owner_id, cover_url")
    .eq("id", id)
    .maybeSingle();
  if (!deck) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (deck.owner_id !== user.id) {
    return NextResponse.json({ error: "Not your deck." }, { status: 403 });
  }

  const part = request.nextUrl.searchParams.get("part") ?? "manifest";
  const hasCover = Boolean(deck.cover_url && isAllowedServerImageFetchUrl(deck.cover_url));

  if (part === "cover") {
    if (!hasCover) return NextResponse.json({ error: "No cover" }, { status: 404 });
    try {
      const response = await fetch(deck.cover_url as string, { cache: "no-store" });
      if (!response.ok) return NextResponse.json({ error: "Cover unavailable" }, { status: 502 });
      const type = response.headers.get("content-type") ?? "image/png";
      return new NextResponse(Buffer.from(await response.arrayBuffer()), {
        status: 200,
        headers: { "Content-Type": type, "Cache-Control": "private, no-store" },
      });
    } catch {
      return NextResponse.json({ error: "Cover unavailable" }, { status: 502 });
    }
  }

  const items = await listDeckCards(id);
  if (items.length === 0) {
    return NextResponse.json({ error: "This deck has no cards yet — add some first." }, { status: 404 });
  }
  const playable = items.filter((item) => item.entry.board !== "maybe");

  if (part === "decklist") {
    const text = deckToText({ title: deck.title }, toExportEntries(items), { style: "plain" });
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }

  if (part === "report") {
    const [guide, ownerProfile] = await Promise.all([
      getDeckGuide(id),
      supabase.from("profiles").select("username, display_name").eq("id", user.id).maybeSingle(),
    ]);
    const format = isDeckFormat(deck.format) ? deck.format : "casual";
    const type = deckTypeByKey(deck.deck_type);
    const bracket = commanderBracket(deck.bracket);
    const report = await buildDeckReportPdf({
      title: deck.title,
      description: deck.description,
      formatLabel: DECK_FORMAT_LABELS[format],
      deckTypeLabel: type ? `${type.label} deck` : null,
      bracketLabel: bracket ? `Bracket ${bracket.level} · ${bracket.name}` : null,
      ownerName: ownerProfile.data?.display_name || ownerProfile.data?.username || null,
      url: `${getSiteBaseUrl()}/deck/${deck.slug}`,
      analytics: computeDeckAnalytics(items),
      entries: toExportEntries(items),
      guide,
    });
    return new NextResponse(Buffer.from(report), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store" },
    });
  }

  // Manifest: unique custom cards in deck order with their physical copies
  // (capped like the old sheet export), plus a checklist of everything that
  // isn't a custom card (real cards never print as scans).
  const cards: DeckExportManifest["cards"] = [];
  const indexById = new Map<string, number>();
  let physicalBudget = MAX_PHYSICAL_COPIES;
  const checklist: string[] = [];
  for (const { entry, card } of playable) {
    if (!card) {
      checklist.push(
        `${entry.quantity}× ${entry.name}${entry.board !== "main" ? `  (${DECK_BOARD_LABELS[entry.board]})` : ""}`,
      );
      continue;
    }
    const grant = Math.min(entry.quantity, physicalBudget);
    physicalBudget -= Math.max(0, grant);
    const existing = indexById.get(card.id);
    if (existing !== undefined) {
      cards[existing].copies += Math.max(0, grant);
      continue;
    }
    if (cards.length >= MAX_EXPORT_CARDS) continue;
    indexById.set(card.id, cards.length);
    cards.push({ id: card.id, slug: card.slug, title: card.title, copies: Math.max(1, grant) });
  }

  const manifest: DeckExportManifest = {
    deck: { id: deck.id, slug: deck.slug, title: deck.title },
    cards,
    checklist,
    hasCover,
    totalEntries: playable.reduce((n, item) => n + item.entry.quantity, 0),
  };
  return NextResponse.json(manifest, { headers: { "Cache-Control": "private, no-store" } });
}

function toExportEntries(items: Awaited<ReturnType<typeof listDeckCards>>) {
  return items.map(({ entry, card }) => ({
    name: entry.name,
    quantity: entry.quantity,
    board: entry.board,
    set_code: entry.set_code,
    collector_number: entry.collector_number,
    type_line: entry.type_line,
    mana_cost: entry.mana_cost,
    proxyTitle: card?.title ?? null,
  }));
}
