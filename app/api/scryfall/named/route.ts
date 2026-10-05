import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_COLOR_KEYS } from "@/lib/creator/card-kinds";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";
import {
  getCardById,
  getCardByNameResult,
  getScryfallSet,
  hasBackFaceImage,
  pickArtCropUrl,
  pickPrintImageUrl,
  type ScryfallCard,
  type ScryfallNamedFailure,
} from "@/lib/scryfall/client";
import {
  checkScryfallRateLimit,
  logScryfallCall,
} from "@/lib/scryfall/rate-limit";
import { mapScryfallToFormPatch, needsScryfallSet } from "@/lib/scryfall/import-mapper";
import { rateLimitedResponse } from "@/lib/api/responses";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";

// ---------------------------------------------------------------------------
// GET /api/scryfall/named?id=<scryfall_id>
//                       ?exact=<name>
//                       ?fuzzy=<name>
//
// Resolves a single Scryfall card and returns it together with our form
// patch shape. Used by the import dialog when the user clicks a result —
// we re-fetch by id so the client never has to round-trip the full card
// object and we always operate on canonical Scryfall data.
//
// Exactly ONE of the three is read. An empty parameter counts as absent, so
// `?id=&exact=Lightning%20Bolt` looks up the exact name; two non-empty ones
// are a 400 (TODO 1.12). A name that finds no card says why — several cards
// match (Scryfall's "ambiguous" 404), none does, Scryfall refused the
// request, or Scryfall is down — and only a found card spends the user's
// Scryfall quota.
// ---------------------------------------------------------------------------

export const maxDuration = 15;

/** A name lookup's failure as the route answers it. */
function namedFailure(kind: ScryfallNamedFailure, name: string) {
  switch (kind) {
    case "ambiguous":
      return {
        status: 404,
        error: `Several cards match “${name}” — type more of the name.`,
      };
    case "not_found":
      return { status: 404, error: `No card named “${name}”.` };
    case "bad_request":
      return { status: 400, error: `Scryfall couldn't look up “${name}”.` };
    case "upstream":
      return {
        status: 502,
        error: "Scryfall didn't answer — try again in a moment.",
      };
  }
}

/** The verified combos an import is finalized against: the verified set —
 *  plus, for an ADMIN's frame preview (TODO 2.3 / 5.4), every colour of
 *  the previewed templates (`preview`, the creator's `previewFrames` list),
 *  as the creator's picker unions them. Unknown names are ignored; a
 *  non-admin's list is ignored whole (the profile decides, never the
 *  request). */
async function verifiedKeysForImport(preview: string | undefined): Promise<Set<string>> {
  const keys = new Set(await getVerifiedFrameKeys());
  if (!preview) return keys;
  const templates = preview
    .split(",")
    .map((name) => name.trim())
    .filter((name): name is FrameTemplate => (FRAME_TEMPLATE_VALUES as readonly string[]).includes(name));
  if (templates.length === 0) return keys;
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return keys;
  for (const template of templates) {
    for (const colour of FRAME_COLOR_KEYS) keys.add(frameComboKey(template, colour));
  }
  return keys;
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

  const params = request.nextUrl.searchParams;
  // Empty (or whitespace-only) parameters are absent.
  const read = (key: string) => params.get(key)?.trim() || undefined;
  const id = read("id");
  const exact = read("exact");
  const fuzzy = read("fuzzy");
  const given = [id, exact, fuzzy].filter((value) => value !== undefined);

  if (given.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Provide id, exact, or fuzzy." },
      { status: 400 },
    );
  }
  if (given.length > 1) {
    return NextResponse.json(
      { ok: false, error: "Provide only one of id, exact, or fuzzy." },
      { status: 400 },
    );
  }

  const limit = await checkScryfallRateLimit(user.id, "named");
  if (!limit.ok) {
    return rateLimitedResponse(limit);
  }

  let card: ScryfallCard | null;
  if (id !== undefined) {
    card = await getCardById(id);
    if (!card) {
      // Don't spend the user's Scryfall budget on a lookup that found
      // nothing (or that the upstream failed) — only successful fetches are
      // logged.
      return NextResponse.json(
        { ok: false, error: "Card not found." },
        { status: 404 },
      );
    }
  } else {
    const name = (exact ?? fuzzy)!;
    const result = await getCardByNameResult(
      exact !== undefined ? { exact } : { fuzzy: name },
    );
    if (!result.ok) {
      const { status, error } = namedFailure(result.kind, name);
      return NextResponse.json({ ok: false, error }, { status });
    }
    card = result.card;
  }

  await logScryfallCall(user.id, "named");

  const artPreviewUrl = pickArtCropUrl(card);
  // The collector fields follow the printing (TODO 4.9a): a token set's
  // parent code and a 2015-era set size live on the SET object, fetched
  // only when the mapper needs it — cached for a day, so at most one extra
  // Scryfall call per import and none on a hit. Nothing fetched → the
  // mapper fills no collector fields (never a guess).
  const set = needsScryfallSet(card) && card.set ? await getScryfallSet(card.set) : undefined;
  // The registry's match is static; an `exact` frame that isn't verified in
  // the card's colour is only `nearest` to the user (TODO 1.4), and a match
  // that names another frame once verified takes it when it is (A9). A
  // double-faced landing (TODO 5.4) is finalized on BOTH faces' combos —
  // for an ADMIN's frame preview (TODO 2.3, `?preview=<templates>` from the
  // creator's previewFrames) the previewed bodies count as verified here,
  // as they do in the creator's picker, so the preview can import onto a
  // body nobody has ticked yet. Anyone else's `preview` is ignored.
  const mapped = mapScryfallToFormPatch(card, { artPreviewUrl, set });
  const patch = mapped.frame_match
    ? finalizeImportMatch(mapped, await verifiedKeysForImport(read("preview")))
    : mapped;

  return NextResponse.json({
    ok: true,
    card: {
      id: card.id,
      name: card.name,
      oracle_id: card.oracle_id ?? null,
      set: card.set ?? null,
      set_name: card.set_name ?? null,
      print_url: pickPrintImageUrl(card),
      thumb_url: artPreviewUrl,
      scryfall_uri: card.scryfall_uri ?? null,
      image_status: card.image_status ?? null,
      // TODO 1.8: the second face has its own image to import (a DFC), not
      // the one shared image of a split / adventure / flip / Room card.
      has_back_image: hasBackFaceImage(card),
    },
    patch,
  });
}
