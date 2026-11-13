import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Re-art deck's server reads (lib/tools/re-art/server.ts), the two that
// decide what a run may do to a card and to a stored picture:
//
//   * the PLAN leaves a card alone only while it still SHOWS the picture
//     Re-art painted in this style (or was given its own art back from the
//     tool). It used to compare the style version alone, so a card whose art
//     was changed in the editor — or repainted by a run of another deck that
//     holds it — still counted as done and a run over the deck skipped it;
//
//   * a picture a re-roll or "Put the old art back" took off a card is
//     removed only when NOTHING else of the maker's shows or keeps it. It
//     used to be removed unasked: a remix of the maker's own card shares its
//     parent's art file (lib/cards/remix-media.ts), so the remix was left
//     with a dead picture.
// ---------------------------------------------------------------------------

type Call = { table: string; filters: Array<[string, unknown]>; head: boolean };
type Result = { data?: unknown; count?: number | null; error?: { message: string } | null };

const m = vi.hoisted(() => ({
  query: vi.fn(),
  items: vi.fn(),
  discard: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const call: Call = { table, filters: [], head: false };
      const answer = async (): Promise<Result> => m.query(call);
      const chain = {
        select: (_columns: string, options?: { head?: boolean }) => {
          call.head = Boolean(options?.head);
          return chain;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        filter: (column: string, _operator: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        maybeSingle: answer,
        then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => answer().then(resolve, reject),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => false, createAdminClient: vi.fn() }));
vi.mock("@/lib/decks/queries", () => ({ listDeckPageCards: m.items }));
vi.mock("@/lib/scryfall/rate-limit", () => ({ checkScryfallRateLimit: vi.fn(), logScryfallCall: vi.fn() }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: vi.fn(async () => []) }));
vi.mock("@/lib/billing/entitlements", () => ({ getEntitlements: vi.fn(async () => ({ removeWatermark: false })) }));
vi.mock("@/lib/ai/random-art", () => ({ discardGeneratedArt: m.discard }));
vi.mock("@/lib/tools/bulk-customize/planner", () => ({ planCustomizedCard: vi.fn() }));
vi.mock("@/lib/tools/bulk-customize/server", () => ({ fetchBulkPrintings: vi.fn(), importPatchOf: vi.fn() }));

import { discardReartArtIfUnused, planReartRun } from "@/lib/tools/re-art/server";

const ME = "u1";
const DECK = "00000000-0000-4000-8000-0000000000d1";
const ENTRY = "00000000-0000-4000-8000-0000000000e1";
const CARD = "00000000-0000-4000-8000-0000000000c1";
const ART = (n: string) => `https://x.supabase.co/storage/v1/object/public/card-art/u1/${n}`;

const columnOf = (call: Call) => call.filters.find(([column]) => column !== "owner_id")?.[0];

describe("the plan — a card is left alone only while it still shows the style's picture", () => {
  const item = (artUrl: string | null) => ({
    entry: { id: ENTRY, name: "Archivist", quantity: 1, board: "main", card_id: CARD, scryfall_id: null, type_line: "Creature — Human Wizard" },
    card: { id: CARD, owner_id: ME, title: "Archivist of Lost Hours", card_type: "creature", art_url: artUrl, frame_style: { template: "m15" }, back_face: null },
    cardOwner: null,
  });
  const row = (artUrl: string | null) => ({
    card_id: CARD,
    entry_id: null,
    style_version: 3,
    art_url: artUrl,
    back_art_url: null,
    made: false,
    previous_art_url: ART("mine.png"),
    previous_art_position: null,
    previous_back_art_url: null,
    previous_back_art_position: null,
    previous_artist_credit: null,
    previous_back_artist_credit: null,
    painted_at: "2026-11-12T00:00:00Z",
  });

  /** The deck with its stored style (version 3) and one own card. */
  function deckWith(cardArt: string | null, painted: ReturnType<typeof row> | null) {
    m.items.mockResolvedValue([item(cardArt)]);
    m.query.mockImplementation(async (call: Call): Promise<Result> => {
      if (call.table === "decks") return { data: { id: DECK, slug: "embers", title: "Embers", visibility: "private" } };
      if (call.table === "deck_art_styles") return { data: { preset: "watercolor", theme: "a haunted fen", version: 3 } };
      if (call.table === "deck_reart_cards") return { data: painted ? [painted] : [] };
      return { data: null };
    });
  }

  const plan = (entryIds?: string[]) =>
    planReartRun(ME, { deckId: DECK, scope: "all", visibility: "private", ...(entryIds ? { entryIds } : {}) }, "deck_import");

  beforeEach(() => {
    m.query.mockReset();
    m.items.mockReset();
  });

  it("painted in this style and still showing it: left as it is, nothing to paint", async () => {
    deckWith(ART("ai-1.jpg"), row(ART("ai-1.jpg")));
    expect(await plan()).toMatchObject({ ok: true, version: 3, styleChanged: false, inStyle: 1, entries: [] });
  });

  it("painted in this style but showing OTHER art now: painted again, priced", async () => {
    // Changed in the card's editor, or repainted by a run of another deck.
    deckWith(ART("hand.png"), row(ART("ai-1.jpg")));
    const result = await plan();
    expect(result).toMatchObject({ ok: true, inStyle: 0 });
    expect(result.ok && result.entries).toEqual([
      expect.objectContaining({ entryId: ENTRY, kind: "own", cardId: CARD, credits: 1, repaint: false, paintedBefore: true }),
    ]);
  });

  it("given its own art back from the tool: kept — a run over the deck leaves it alone", async () => {
    deckWith(ART("mine.png"), row(null));
    expect(await plan()).toMatchObject({ ok: true, inStyle: 1, entries: [] });
  });

  it("never painted: painted; and a NAMED card is painted whatever it shows", async () => {
    deckWith(ART("mine.png"), null);
    const fresh = await plan();
    expect(fresh.ok && fresh.entries).toEqual([expect.objectContaining({ kind: "own", repaint: false, paintedBefore: false })]);
    deckWith(ART("ai-1.jpg"), row(ART("ai-1.jpg")));
    const named = await plan([ENTRY]);
    expect(named.ok && named.entries).toEqual([expect.objectContaining({ kind: "own", repaint: true, paintedBefore: true })]);
  });
});

describe("a replaced picture is removed only when nothing else shows or keeps it", () => {
  const PICTURE = ART("ai-old.jpg");
  /** How many rows hold the picture, by `table.column`. */
  function holders(counts: Record<string, number | "error"> = {}) {
    m.query.mockImplementation(async (call: Call): Promise<Result> => {
      const answer = counts[`${call.table}.${columnOf(call)}`] ?? 0;
      return answer === "error" ? { count: null, error: { message: "boom" } } : { count: answer, error: null };
    });
  }

  beforeEach(() => {
    m.query.mockReset();
    m.discard.mockReset();
  });

  it("nothing holds it: removed", async () => {
    holders();
    expect(await discardReartArtIfUnused(ME, PICTURE)).toBe(true);
    expect(m.discard).toHaveBeenCalledWith(ME, PICTURE);
  });

  it("asks only about the caller's own rows, by the picture's exact address, without reading a row", async () => {
    holders();
    await discardReartArtIfUnused(ME, PICTURE);
    const calls = m.query.mock.calls.map(([call]) => call as Call);
    expect(calls.map((call) => `${call.table}.${columnOf(call)}`).sort()).toEqual([
      "cards.art_url",
      "cards.back_face->>art_url",
      "deck_reart_cards.previous_art_url",
      "deck_reart_cards.previous_back_art_url",
    ]);
    for (const call of calls) {
      expect(call.head).toBe(true);
      expect(call.filters).toContainEqual(["owner_id", ME]);
      expect(call.filters).toContainEqual([columnOf(call), PICTURE]);
    }
  });

  it.each([
    ["another card of the maker's shows it (a remix of the card shares its art file)", "cards.art_url"],
    ["a card shows it on its back face", "cards.back_face->>art_url"],
    ["a Re-art row keeps it as the art to put back", "deck_reart_cards.previous_art_url"],
    ["a Re-art row keeps it as the back's art to put back", "deck_reart_cards.previous_back_art_url"],
  ])("%s: kept", async (_name, holder) => {
    holders({ [holder]: 1 });
    expect(await discardReartArtIfUnused(ME, PICTURE)).toBe(false);
    expect(m.discard).not.toHaveBeenCalled();
  });

  it("a read that fails keeps the picture (a leftover is the orphan sweep's; a dead link is nobody's)", async () => {
    holders({ "cards.art_url": "error" });
    expect(await discardReartArtIfUnused(ME, PICTURE)).toBe(false);
    m.query.mockRejectedValue(new Error("offline"));
    expect(await discardReartArtIfUnused(ME, PICTURE)).toBe(false);
    expect(m.discard).not.toHaveBeenCalled();
  });

  it("no picture: nothing asked, nothing removed", async () => {
    expect(await discardReartArtIfUnused(ME, null)).toBe(false);
    expect(await discardReartArtIfUnused(ME, undefined)).toBe(false);
    expect(m.query).not.toHaveBeenCalled();
    expect(m.discard).not.toHaveBeenCalled();
  });
});
