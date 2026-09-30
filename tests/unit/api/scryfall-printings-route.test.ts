import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import treatmentPrintings from "../scryfall/fixtures/treatment-printings.json";
import importPrintings from "../scryfall/fixtures/import-printings.json";
import tokenPrintings from "../scryfall/fixtures/token-printings.json";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import {
  PRINTING_VIEW_QUALIFIERS,
  PRINTING_VIEW_VALUES,
  printingTreatmentBadge,
  type PrintingSummary,
} from "@/lib/scryfall/printing-views";

// ---------------------------------------------------------------------------
// GET /api/scryfall/printings (TODO 1.5): the view → Scryfall qualifier
// mapping (one search per page, charged to the user's "search" budget), the
// representative strip's look label (1.5's interim fix: every look keeps a
// representative), and each printing's finalized match from ONE
// frame_reviews read. Scryfall is stubbed; the fixtures are real printings.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  check: vi.fn(),
  log: vi.fn(),
  getCardPrintings: vi.fn(),
  searchPrintingsPage: vi.fn(),
  verifiedKeys: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => state.user,
}));
vi.mock("@/lib/scryfall/rate-limit", () => ({
  checkScryfallRateLimit: state.check,
  logScryfallCall: state.log,
}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: state.verifiedKeys,
}));
vi.mock("@/lib/scryfall/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/client")>();
  return {
    ...actual,
    getCardPrintings: state.getCardPrintings,
    searchPrintingsPage: state.searchPrintingsPage,
  };
});

import { GET } from "@/app/api/scryfall/printings/route";
import {
  MAX_REPRESENTATIVE_PRINTINGS,
  printingLookLabel,
  selectRepresentatives,
} from "@/lib/scryfall/printing-summary";

const PLAINS = "bc71ebf6-2056-41f7-be35-b2e5c34afa99";
const SHEOLDRED = "34f34409-326d-4994-a0ea-1a69aa278f03";

type Key = keyof typeof treatmentPrintings;
const printing = (key: Key): ScryfallCard => scryfallCardSchema.parse(treatmentPrintings[key]);

function get(query: string) {
  return GET(new NextRequest(`https://www.pipglyph.com/api/scryfall/printings?${query}`));
}

beforeEach(() => {
  state.user = { id: "user-1" };
  state.check.mockReset().mockResolvedValue({ ok: true });
  state.log.mockReset().mockResolvedValue(undefined);
  state.verifiedKeys.mockReset().mockResolvedValue(["m15/b", "m15/w", "m15land/w"]);
  state.getCardPrintings.mockReset().mockResolvedValue({
    cards: [printing("dmu-107"), printing("dmu-435")],
    totalCards: 7,
  });
  state.searchPrintingsPage
    .mockReset()
    .mockResolvedValue({ cards: [printing("dmu-435")], hasMore: true, totalCards: 3 });
});

describe("GET /api/scryfall/printings — views", () => {
  it.each(
    PRINTING_VIEW_VALUES.filter((v) => v !== "representative").map((view) => [
      view,
      PRINTING_VIEW_QUALIFIERS[view as Exclude<typeof view, "representative">],
    ]),
  )("view=%s appends %j to the oracle id, one Scryfall page per request", async (view, qualifier) => {
    const res = await get(`oracle_id=${SHEOLDRED}&view=${view}&page=2`);
    expect(res.status).toBe(200);
    expect(state.searchPrintingsPage).toHaveBeenCalledTimes(1);
    expect(state.searchPrintingsPage).toHaveBeenCalledWith(
      qualifier ? `oracleid:${SHEOLDRED} ${qualifier}` : `oracleid:${SHEOLDRED}`,
      2,
    );
    expect(state.getCardPrintings).not.toHaveBeenCalled();
    expect(state.check).toHaveBeenCalledWith("user-1", "search");
    expect(state.log).toHaveBeenCalledWith("user-1", "search");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, has_more: true, total_cards: 3 });
  });

  it("maps each chip onto the Scryfall syntax checked on scryfall.com/docs/syntax", () => {
    expect(PRINTING_VIEW_QUALIFIERS).toEqual({
      all: "",
      regular:
        "frame:2015 -border:borderless -frame:showcase -frame:extendedart -is:full -is:textless",
      borderless: "border:borderless",
      showcase: "frame:showcase",
      extendedart: "frame:extendedart",
      fullart: "is:full",
      textless: "is:textless",
      oldborder: "-frame:2015",
    });
  });

  it("defaults to the representative strip: never paged, Scryfall's total", async () => {
    const res = await get(`oracle_id=${SHEOLDRED}`);
    const body = await res.json();
    expect(state.getCardPrintings).toHaveBeenCalledWith(SHEOLDRED);
    expect(state.searchPrintingsPage).not.toHaveBeenCalled();
    expect(body).toMatchObject({ ok: true, has_more: false, total_cards: 7 });
    expect(body.printings.map((p: PrintingSummary) => p.collector_number)).toEqual(["435", "107"]);
  });

  it("refuses a bad view, page or oracle id before any Scryfall call", async () => {
    for (const query of [
      `oracle_id=${SHEOLDRED}&view=everything`,
      `oracle_id=${SHEOLDRED}&view=all&page=0`,
      `oracle_id=${SHEOLDRED}&view=all&page=x`,
      `oracle_id=${SHEOLDRED}&view=all&page=51`,
      `oracle_id=not-a-uuid`,
    ]) {
      const res = await get(query);
      expect(res.status, query).toBe(400);
    }
    expect(state.check).not.toHaveBeenCalled();
    expect(state.searchPrintingsPage).not.toHaveBeenCalled();
  });

  it("an over-quota user is refused before Scryfall", async () => {
    state.check.mockResolvedValue({ ok: false, message: "Slow down", retryAfterSeconds: 30 });
    const res = await get(`oracle_id=${SHEOLDRED}&view=all`);
    expect(res.status).toBe(429);
    expect(state.searchPrintingsPage).not.toHaveBeenCalled();
  });

  it("no matches is an empty page, not logged; Scryfall down is a 502", async () => {
    state.searchPrintingsPage.mockResolvedValueOnce({ cards: [], hasMore: false, totalCards: 0 });
    const empty = await get(`oracle_id=${SHEOLDRED}&view=extendedart`);
    expect(await empty.json()).toEqual({ ok: true, printings: [], has_more: false, total_cards: 0 });
    expect(state.log).not.toHaveBeenCalled();

    state.searchPrintingsPage.mockResolvedValueOnce(null);
    const down = await get(`oracle_id=${SHEOLDRED}&view=all`);
    expect(down.status).toBe(502);
    expect(state.log).not.toHaveBeenCalled();
  });
});

describe("GET /api/scryfall/printings — each printing's match and facts", () => {
  it("reads frame_reviews ONCE per request and finalizes every match against it", async () => {
    state.searchPrintingsPage.mockResolvedValue({
      cards: [printing("dmu-435"), printing("dmu-107"), printing("one-262"), printing("unf-235")],
      hasMore: false,
      totalCards: 4,
    });
    const res = await get(`oracle_id=${PLAINS}&view=all`);
    const body = (await res.json()) as { printings: PrintingSummary[] };
    expect(state.verifiedKeys).toHaveBeenCalledTimes(1);
    const byNumber = Object.fromEntries(body.printings.map((p) => [p.collector_number, p]));

    // Sheoldred DMU #435: borderless, the crown missing → nearest, lands on M15.
    expect(byNumber["435"]).toMatchObject({
      set: "dmu",
      border_color: "borderless",
      full_art: false,
      textless: false,
      treatment: "borderless",
      has_back_image: false,
      match: {
        status: "nearest",
        exactLabel: "Borderless frame",
        template: "m15borderless",
        landOn: "m15",
        reason: "PipGlyph doesn't draw the legendary crown yet",
      },
    });
    // A full-art Plains (ONE #262) — its badge says so.
    expect(byNumber["262"]).toMatchObject({ full_art: true, treatment: "fullart" });
    expect(printingTreatmentBadge(byNumber["262"]!)).toBe("Full art");
    // UNF #235: borderless, full art and textless.
    expect(printingTreatmentBadge(byNumber["235"]!)).toBe("Borderless · Full art");
  });

  it("an exact match needs the combo verified in the card's colour", async () => {
    // A white 2014–19 Soldier token (TDOM #3) → m15token, its own design.
    const card = scryfallCardSchema.parse(tokenPrintings["tdom-3"]);
    state.searchPrintingsPage.mockResolvedValue({ cards: [card], hasMore: false, totalCards: 1 });
    state.verifiedKeys.mockResolvedValue([frameComboKey("m15token", "w")]);
    const exact = (await (await get(`oracle_id=${PLAINS}&view=all`)).json()).printings[0];
    expect(exact.match).toMatchObject({ status: "exact", template: "m15token", reason: null });

    state.verifiedKeys.mockResolvedValue([]);
    const nearest = (await (await get(`oracle_id=${PLAINS}&view=all`)).json()).printings[0];
    expect(nearest.match).toMatchObject({ status: "nearest", reason: "not yet verified in white" });
  });

  it("an M20-design token is nearest the arch until its full-art template is verified, then exact on it; badged Full art (TODO 1.23 / 4.48)", async () => {
    const card = printing("t2xm-4"); // a white full-art Cat token, 2020
    state.searchPrintingsPage.mockResolvedValue({ cards: [card], hasMore: false, totalCards: 1 });
    state.verifiedKeys.mockResolvedValue([frameComboKey("m15token", "w")]);
    const tile = (await (await get(`oracle_id=${PLAINS}&view=all`)).json()).printings[0];
    expect(tile.match).toMatchObject({
      status: "nearest",
      template: "m15token",
      exactLabel: "M20 full-art token frame",
      reason: "not yet verified in white",
    });
    expect(tile).toMatchObject({ treatment: "fullart" });
    expect(printingTreatmentBadge(tile)).toBe("Full art");
    state.verifiedKeys.mockResolvedValue([frameComboKey("m15token", "w"), frameComboKey("m20token", "w")]);
    const done = (await (await get(`oracle_id=${PLAINS}&view=all`)).json()).printings[0];
    expect(done.match).toMatchObject({ status: "exact", template: "m20token", reason: null });
  });
});

describe("selectRepresentatives — every look keeps a representative (1.5's interim fix)", () => {
  const plain = (n: number, date: string): ScryfallCard =>
    scryfallCardSchema.parse({
      ...treatmentPrintings["dmu-107"],
      id: `plain-${n}`,
      collector_number: String(n),
      released_at: date,
    });

  it("labels a printing by frame, snow/devoid, border, full art, textless, showcase and extended art", () => {
    expect(printingLookLabel(printing("dmu-107"))).toBe("2015|||black||||");
    expect(printingLookLabel(printing("dmu-435"))).toBe("2015|||borderless||||");
    expect(printingLookLabel(printing("one-262"))).toBe("2015|||black|fullart|||");
    expect(printingLookLabel(printing("unf-235"))).toBe("2015|||borderless|fullart|textless||");
    expect(printingLookLabel(printing("blb-316"))).toBe("2015|||borderless|||showcase|");
  });

  it("keeps the older full-art, textless and borderless printings when 40 newer plain ones would fill the cap", () => {
    const newer = Array.from({ length: 40 }, (_, i) => plain(i + 1, `2025-${String((i % 12) + 1).padStart(2, "0")}-01`));
    const older = [printing("one-262"), printing("unf-235"), printing("dmu-435")].map((c) => ({
      ...c,
      released_at: "2019-01-01",
    }));
    const picked = selectRepresentatives([...newer, ...older]);
    expect(picked).toHaveLength(MAX_REPRESENTATIVE_PRINTINGS);
    const ids = picked.map((c) => c.id);
    for (const card of older) expect(ids).toContain(card.id);
    // Still newest first.
    const dates = picked.map((c) => c.released_at ?? "");
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe("GET /api/scryfall/printings — a back face's own art (TODO 1.15)", () => {
  // Real printings (tests/unit/scryfall/fixtures/import-printings.json) with
  // the image_uris Scryfall serves for them: a transform DFC carries one per
  // face, a split card one at the top level for both halves.
  const art = (face: "front" | "back", id: string) =>
    `https://cards.scryfall.io/art_crop/${face}/${id[0]}/${id[1]}/${id}.jpg`;
  const delverIsd = () => {
    const raw = importPrintings["isd-51"];
    return scryfallCardSchema.parse({
      ...raw,
      card_faces: raw.card_faces.map((face, i) => ({
        ...face,
        image_uris: { art_crop: art(i === 0 ? "front" : "back", raw.id) },
      })),
    });
  };
  const fireIce = () => {
    const raw = importPrintings["dmr-215"];
    return scryfallCardSchema.parse({ ...raw, image_uris: { art_crop: art("front", raw.id) } });
  };

  it("Delver of Secrets ISD #51: the back crop and the back face's artist ride with the printing", async () => {
    state.searchPrintingsPage.mockResolvedValue({ cards: [delverIsd()], hasMore: false, totalCards: 1 });
    const body = (await (await get(`oracle_id=${PLAINS}&view=all`)).json()) as {
      printings: PrintingSummary[];
    };
    const id = importPrintings["isd-51"].id;
    expect(body.printings[0]).toMatchObject({
      has_back_image: true,
      thumb_url: art("front", id),
      back_thumb_url: art("back", id),
      front_artist: "Nils Hamm",
      back_artist: "Nils Hamm",
    });
  });

  it("an empty image_uris on the back face is no back image (hasBackFaceImage, TODO 1.8)", async () => {
    const raw = importPrintings["isd-51"];
    const card = scryfallCardSchema.parse({
      ...raw,
      card_faces: raw.card_faces.map((face, i) => ({
        ...face,
        image_uris: i === 0 ? { art_crop: art("front", raw.id) } : {},
      })),
    });
    state.searchPrintingsPage.mockResolvedValue({ cards: [card], hasMore: false, totalCards: 1 });
    const body = (await (await get(`oracle_id=${PLAINS}&view=all`)).json()) as {
      printings: PrintingSummary[];
    };
    expect(body.printings[0]).toMatchObject({
      has_back_image: false,
      back_thumb_url: null,
      back_artist: null,
    });
  });

  it("Fire // Ice DMR #215: one image for both halves, so no back crop and no back artist", async () => {
    state.searchPrintingsPage.mockResolvedValue({ cards: [fireIce()], hasMore: false, totalCards: 1 });
    const body = (await (await get(`oracle_id=${PLAINS}&view=all`)).json()) as {
      printings: PrintingSummary[];
    };
    expect(body.printings[0]).toMatchObject({
      has_back_image: false,
      thumb_url: art("front", importPrintings["dmr-215"].id),
      back_thumb_url: null,
      back_artist: null,
      // The card-level credit joins the halves'; the front art's credit is
      // the first face's own — what import-art writes (TODO 1.8).
      artist: "David Martin & Franz Vohwinkel",
      front_artist: "David Martin",
    });
  });
});
