import { NextResponse, type NextRequest } from "next/server";
import JSZip from "jszip";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { requireTier, UpgradeRequiredError } from "@/lib/billing/entitlements";

// ---------------------------------------------------------------------------
// /api/decks/[id]/download — Pro "save all cards": a ZIP of the deck's
// custom cards' baked PNG renders. Owner-only. Cards without a baked render
// are listed in a MISSING.txt inside the archive rather than silently
// dropped. PNGs are already compressed — STORE keeps the CPU bill near zero.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_ZIP_CARDS = 150;

type RouteParams = { id: string };

export async function GET(
  _request: NextRequest,
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
      { error: "Sign in to download a deck." },
      { status: 401 },
    );
  }

  try {
    await requireTier("pro");
  } catch (error) {
    if (error instanceof UpgradeRequiredError) {
      return NextResponse.json(
        {
          error: "Deck download is a Pro feature.",
          code: "UPGRADE_REQUIRED",
        },
        { status: 403 },
      );
    }
    throw error;
  }

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

  const { data: entries } = await supabase
    .from("deck_cards")
    .select("card_id, name, quantity, board")
    .eq("deck_id", id)
    .neq("board", "maybe")
    .not("card_id", "is", null)
    .order("position", { ascending: true });

  const cardIds = Array.from(
    new Set((entries ?? []).map((entry) => entry.card_id as string)),
  ).slice(0, MAX_ZIP_CARDS);
  if (cardIds.length === 0) {
    return NextResponse.json(
      { error: "No custom cards in this deck yet — remix some first." },
      { status: 404 },
    );
  }

  const { data: cards } = await supabase
    .from("cards")
    .select("id, title, slug, rendered_image_url")
    .in("id", cardIds);

  const zip = new JSZip();
  const missing: string[] = [];
  let added = 0;

  for (const card of cards ?? []) {
    if (!card.rendered_image_url) {
      missing.push(card.title);
      continue;
    }
    try {
      const response = await fetch(card.rendered_image_url, {
        cache: "no-store",
      });
      if (!response.ok) {
        missing.push(card.title);
        continue;
      }
      added += 1;
      zip.file(
        `${String(added).padStart(2, "0")}-${card.slug}.png`,
        await response.arrayBuffer(),
      );
    } catch {
      missing.push(card.title);
    }
  }

  if (added === 0) {
    return NextResponse.json(
      {
        error:
          "None of the deck's cards have a baked image yet — open them once to bake, then retry.",
      },
      { status: 404 },
    );
  }

  if (missing.length > 0) {
    zip.file(
      "MISSING.txt",
      `These cards had no baked image and were skipped:\n${missing.join("\n")}\n`,
    );
  }

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "STORE",
  });

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${deck.slug}-cards.zip"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
