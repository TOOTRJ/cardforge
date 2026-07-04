import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  getCardPrintings,
  pickArtCropUrl,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import {
  checkScryfallRateLimit,
  logScryfallCall,
} from "@/lib/scryfall/rate-limit";

// ---------------------------------------------------------------------------
// GET /api/scryfall/printings?oracle_id=<uuid>
//
// Every printing of an oracle card (newest first, capped), trimmed for the
// import dialog's printing picker. Each printing carries its own border
// generation + frame effects, so picking one decides which of our frame
// eras the import adopts. Counted against the "search" budget — it IS a
// Scryfall search under the hood.
// ---------------------------------------------------------------------------

const MAX_PRINTINGS = 30;

type PrintingSummary = {
  id: string;
  set: string | null;
  set_name: string | null;
  released_at: string | null;
  /** Scryfall border generation: "1993" | "1997" | "2003" | "2015" | "future". */
  frame: string | null;
  snow: boolean;
  devoid: boolean;
  thumb_url: string | null;
  image_status: string | null;
};

function trimPrinting(card: ScryfallCard): PrintingSummary {
  const effects = (card.frame_effects ?? []).map((e) => e.toLowerCase());
  return {
    id: card.id,
    set: card.set ?? null,
    set_name: card.set_name ?? null,
    released_at: card.released_at ?? null,
    frame: card.frame ?? null,
    snow: effects.includes("snow"),
    devoid: effects.includes("devoid"),
    thumb_url: pickArtCropUrl(card),
    image_status: card.image_status ?? null,
  };
}

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
      { ok: false, error: "Sign in to look up cards." },
      { status: 401 },
    );
  }

  const oracleId = request.nextUrl.searchParams.get("oracle_id")?.trim();
  // Scryfall oracle ids are UUID-shaped; reject anything else before it
  // reaches the upstream query string.
  if (!oracleId || !/^[0-9a-f-]{36}$/i.test(oracleId)) {
    return NextResponse.json(
      { ok: false, error: "Provide a valid oracle_id." },
      { status: 400 },
    );
  }

  const limit = await checkScryfallRateLimit(user.id, "search");
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: limit.message },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const all = await getCardPrintings(oracleId);
  if (all.length === 0) {
    return NextResponse.json({ ok: true, printings: [] });
  }

  await logScryfallCall(user.id, "search");

  return NextResponse.json({
    ok: true,
    printings: selectRepresentatives(all).map(trimPrinting),
  });
}

/** The strip caps at MAX_PRINTINGS, but a naive newest-first cut would drop
 *  exactly the printings the picker exists for — the old borders. Guarantee
 *  the NEWEST and the OLDEST printing of every distinct frame treatment
 *  (border generation + snow/devoid), then fill the remaining slots newest
 *  first. Result stays sorted newest → oldest. */
function selectRepresentatives(cards: ScryfallCard[]): ScryfallCard[] {
  const sorted = [...cards].sort((a, b) =>
    (b.released_at ?? "").localeCompare(a.released_at ?? ""),
  );
  const labelOf = (c: ScryfallCard) => {
    const effects = (c.frame_effects ?? []).map((e) => e.toLowerCase());
    return `${c.frame ?? "?"}|${effects.includes("snow") ? "s" : ""}${effects.includes("devoid") ? "d" : ""}`;
  };
  const keep = new Set<string>();
  const newestByLabel = new Map<string, string>();
  const oldestByLabel = new Map<string, string>();
  for (const c of sorted) {
    const label = labelOf(c);
    if (!newestByLabel.has(label)) newestByLabel.set(label, c.id);
    oldestByLabel.set(label, c.id); // last one seen per label = oldest
  }
  for (const id of newestByLabel.values()) keep.add(id);
  for (const id of oldestByLabel.values()) keep.add(id);
  for (const c of sorted) {
    if (keep.size >= MAX_PRINTINGS) break;
    keep.add(c.id);
  }
  return sorted.filter((c) => keep.has(c.id)).slice(0, MAX_PRINTINGS);
}
