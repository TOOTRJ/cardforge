import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// getDeckGuide (lib/decks/guides.ts) reads a guide as the deck page shows it
// (TODO DK0.11, migration 0151's deck_guide_for_viewer): the text for a Pro
// viewer (redacted by the database for anyone but the owner), `withheld`
// for a guide this viewer may not read (the teaser), nothing otherwise. The
// table is no API role's since 0151; only a database without the function
// is read through it (0085's rule), never a database that has it.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  stub: null as null | ReturnType<typeof import("@/tests/stubs/supabase-chain").chainClient>,
  table: null as ChainAnswer | null,
  guidesOn: true,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.stub!.client }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => false, createAdminClient: () => null }));
vi.mock("@/lib/ai/deck-guide", () => ({ generateDeckGuide: vi.fn() }));
vi.mock("@/lib/ai/deck-ai-pause", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/deck-ai-pause")>()),
  areDeckGuidesEnabled: () => state.guidesOn,
}));

import { getDeckGuide, readShownDeckGuide } from "@/lib/decks/guides";

const DECK = "b0000000-0000-4000-a000-000000000006";
const ROW = {
  deck_id: DECK,
  overview: "Private card turns every artifact into a shock.",
  game_plan: ["Turn 3: land Private card."],
  mulligan: null,
  combos: [{ cards: ["Private card", "Sol Ring"], description: "Pings." }],
  weaknesses: "Artifact removal.",
  key_cards: ["Private card", "Sol Ring"],
  source: "generation",
  generated_at: "2026-10-09T00:00:00Z",
};

beforeEach(() => {
  state.guidesOn = true;
  state.table = null;
  state.stub = chainClient(() => state.table ?? {});
});

describe("getDeckGuide", () => {
  it("a readable guide: the text as the database hands it, through the one function", async () => {
    state.stub!.rpc.mockResolvedValueOnce({ data: [{ ...ROW, readable: true }], error: null });
    const read = await getDeckGuide(DECK);
    expect(state.stub!.rpc).toHaveBeenCalledWith("deck_guide_for_viewer", { p_deck_id: DECK });
    expect(read.withheld).toBe(false);
    expect(read.guide).toMatchObject({
      deck_id: DECK,
      overview: ROW.overview,
      mulligan: "",
      key_cards: ["Private card", "Sol Ring"],
      source: "generation",
    });
    // The table is never read when the function answers.
    expect(state.stub!.forTable("deck_guides")).toHaveLength(0);
  });

  it("a withheld guide is the teaser — no text", async () => {
    state.stub!.rpc.mockResolvedValueOnce({
      data: [{ deck_id: DECK, readable: false, overview: null, game_plan: null, mulligan: null, combos: null, weaknesses: null, key_cards: null, source: null, generated_at: null }],
      error: null,
    });
    expect(await getDeckGuide(DECK)).toEqual({ guide: null, withheld: true });
  });

  it("no row (no guide, or a deck the viewer can't open) and an error are nothing", async () => {
    state.stub!.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await getDeckGuide(DECK)).toEqual({ guide: null, withheld: false });
    state.stub!.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "denied" } });
    expect(await getDeckGuide(DECK)).toEqual({ guide: null, withheld: false });
    expect(state.stub!.forTable("deck_guides")).toHaveLength(0);
  });

  it("a database without 0151 (no function): 0085's table read, the page withholds the text itself", async () => {
    state.stub!.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    state.table = { data: { ...ROW } };
    const read = await getDeckGuide(DECK);
    expect(read).toMatchObject({ withheld: false, guide: { overview: ROW.overview } });
    const tableRead = state.stub!.forTable("deck_guides")[0]!;
    expect(called(tableRead.calls, "eq", "deck_id")).toBe(true);
  });
});

// Deck guides are hidden (owner 2026-10-30, DECK_GUIDES_ENABLED): the deck
// page and the Pro report read through readShownDeckGuide, which asks the
// database NOTHING while they are — no guide text leaves it.
describe("readShownDeckGuide", () => {
  it("hidden: nothing, and no deck_guide_for_viewer call or table read", async () => {
    state.guidesOn = false;
    state.stub!.rpc.mockResolvedValue({ data: [{ ...ROW, readable: true }], error: null });
    expect(await readShownDeckGuide(DECK)).toEqual({ guide: null, withheld: false });
    expect(state.stub!.rpc).not.toHaveBeenCalled();
    expect(state.stub!.forTable("deck_guides")).toHaveLength(0);
  });

  it("the flag flipped back: the guide as getDeckGuide reads it", async () => {
    state.stub!.rpc.mockResolvedValueOnce({ data: [{ ...ROW, readable: true }], error: null });
    const read = await readShownDeckGuide(DECK);
    expect(state.stub!.rpc).toHaveBeenCalledWith("deck_guide_for_viewer", { p_deck_id: DECK });
    expect(read.guide?.overview).toBe(ROW.overview);
  });
});
