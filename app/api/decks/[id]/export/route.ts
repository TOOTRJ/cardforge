import { NextResponse, type NextRequest } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { requireTier, UpgradeRequiredError } from "@/lib/billing/entitlements";
import { renderCardImage } from "@/lib/render/card-image";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import {
  buildDeckPdf,
  type DeckPdfEntry,
  type DeckPdfLayout,
} from "@/lib/render/card-pdf";
import { DECK_BOARD_LABELS, isDeckBoard } from "@/types/deck";
import {
  isCardType,
  isColorIdentity,
  isRarity,
  type ArtPosition,
  type CardBackFace,
  type CardType,
  type ColorIdentity,
  type FrameStyle,
  type Rarity,
} from "@/types/card";
import type { Card as CardRow, DeckCard as DeckCardRow } from "@/types/supabase";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// /api/decks/[id]/export — Pro "print the whole deck".
//
// Prints CUSTOM cards only (remixed proxies + custom-only entries): real
// cards never print as Scryfall scans — they land on a checklist page
// instead (docs/DECKS_PLAN.md §9 decision; printing is the reward for
// remixing). Owner-only, like the set export.
//
//   ?layout=pages  → one page per unique custom card (default)
//   ?layout=sheet  → 3×3 proxy sheets with crop marks, quantity-aware
//   ?paper=letter|a4 (sheets + checklist page size; default letter)
//
// Perf: prefers each card's BAKED render (card-renders bucket) and only
// falls back to a live Satori render when no bake exists — a 100-card
// commander deck of baked proxies is ~100 storage fetches, not renders.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bounds: unique cards per export, and physical printed copies on sheets.
const MAX_UNIQUE_CARDS = 100;
const MAX_PHYSICAL_COPIES = 150;

type RouteParams = { id: string };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> },
) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid deck id" }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to export a deck." },
      { status: 401 },
    );
  }

  let entitlements;
  try {
    entitlements = await requireTier("pro");
  } catch (error) {
    if (error instanceof UpgradeRequiredError) {
      return NextResponse.json(
        {
          error: "Whole-deck export is a Pro feature.",
          code: "UPGRADE_REQUIRED",
        },
        { status: 403 },
      );
    }
    throw error;
  }

  const url = new URL(request.url);
  const paper = url.searchParams.get("paper") === "a4" ? "a4" : "letter";
  const layout: DeckPdfLayout =
    url.searchParams.get("layout") === "sheet"
      ? paper === "a4"
        ? "sheet-a4"
        : "sheet-letter"
      : "pages";

  const supabase = await createClient();

  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, title, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (!deck) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (deck.owner_id !== user.id) {
    return NextResponse.json({ error: "Not your deck." }, { status: 403 });
  }

  const { data: rawEntries } = await supabase
    .from("deck_cards")
    .select("*")
    .eq("deck_id", id)
    .neq("board", "maybe")
    .order("position", { ascending: true });
  const entries = (rawEntries ?? []) as DeckCardRow[];
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "This deck has no cards." },
      { status: 404 },
    );
  }

  // Printable = entries with a linked custom card. Everything else goes on
  // the checklist.
  const printable = entries.filter((entry) => entry.card_id);
  const checklistLines = entries
    .filter((entry) => !entry.card_id)
    .map(
      (entry) =>
        `${entry.quantity}× ${entry.name}${
          isDeckBoard(entry.board) && entry.board !== "main"
            ? `  (${DECK_BOARD_LABELS[entry.board]})`
            : ""
        }`,
    );

  const cardIds = Array.from(
    new Set(printable.map((entry) => entry.card_id as string)),
  ).slice(0, MAX_UNIQUE_CARDS);
  const { data: cards } = await supabase
    .from("cards")
    .select("*")
    .in("id", cardIds.length > 0 ? cardIds : ["00000000-0000-0000-0000-000000000000"]);
  const cardById = new Map((cards ?? []).map((card) => [card.id, card]));

  // Copies per unique card across boards, capped so a sheet export stays
  // within the function budget.
  const copiesByCard = new Map<string, number>();
  let physicalBudget = MAX_PHYSICAL_COPIES;
  for (const entry of printable) {
    const cardId = entry.card_id as string;
    if (!cardById.has(cardId)) continue;
    const grant = Math.min(entry.quantity, physicalBudget);
    if (grant <= 0) continue;
    physicalBudget -= grant;
    copiesByCard.set(cardId, (copiesByCard.get(cardId) ?? 0) + grant);
  }

  const profileOverrides = await getFrameProfileOverrides();
  const pdfEntries: DeckPdfEntry[] = [];
  for (const [cardId, copies] of copiesByCard) {
    const card = cardById.get(cardId) as CardRow | undefined;
    if (!card) continue;
    const png = await pngForCard(card, profileOverrides, {
      brandMark: !entitlements.removeWatermark,
    });
    if (png) pdfEntries.push({ png, copies });
  }

  if (pdfEntries.length === 0 && checklistLines.length === 0) {
    return NextResponse.json(
      { error: "Nothing to export — remix some cards first." },
      { status: 404 },
    );
  }

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildDeckPdf(pdfEntries, {
      title: deck.title,
      layout,
      checklist:
        checklistLines.length > 0
          ? {
              heading: `${deck.title} — not yet remixed (originals to supply yourself)`,
              lines: checklistLines,
            }
          : null,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "PDF error";
    return NextResponse.json(
      { error: `PDF generation failed: ${detail}` },
      { status: 500 },
    );
  }

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${deck.slug}.pdf"`,
      "Content-Length": String(pdfBytes.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

/** Baked render first (a storage fetch), live Satori render as fallback. */
async function pngForCard(
  card: CardRow,
  profileOverrides: Awaited<ReturnType<typeof getFrameProfileOverrides>>,
  options: { brandMark: boolean },
): Promise<Uint8Array | null> {
  if (card.rendered_image_url) {
    try {
      const response = await fetch(card.rendered_image_url, {
        cache: "no-store",
      });
      if (response.ok) {
        return new Uint8Array(await response.arrayBuffer());
      }
    } catch {
      // fall through to the live render
    }
  }
  try {
    const img = renderCardImage(
      { ...toPreviewData(card), profileOverrides },
      "hd",
      { brandMark: options.brandMark },
    );
    return new Uint8Array(await img.arrayBuffer());
  } catch {
    return null;
  }
}

// Raw row → preview data (same narrowing as the set export route).
function toPreviewData(card: CardRow): CardPreviewData {
  return {
    title: card.title,
    cost: card.cost,
    cardType: isCardType(card.card_type) ? (card.card_type as CardType) : null,
    supertype: card.supertype,
    subtypes: card.subtypes,
    rarity: isRarity(card.rarity) ? (card.rarity as Rarity) : null,
    colorIdentity: (card.color_identity ?? []).filter(
      isColorIdentity,
    ) as ColorIdentity[],
    rulesText: card.rules_text,
    flavorText: card.flavor_text,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    defense: card.defense,
    artistCredit: card.artist_credit,
    artUrl: card.art_url,
    artPosition: (card.art_position as ArtPosition) ?? {},
    frameStyle: (card.frame_style as FrameStyle) ?? {},
    setIconUrl: card.set_icon_url,
    setIconCode: card.set_icon_code,
    backFace: (card.back_face as CardBackFace | null) ?? null,
  };
}
