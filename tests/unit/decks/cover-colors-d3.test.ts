import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The tiles' default-cover colours (lib/decks/cover-colors.ts, TODO DK6.2)
// read their own rows, so they hold the D3 rule themselves: another
// creator's card counts only while it is PUBLIC — an unlisted one is
// readable through RLS — the deck owner's own as it is (a private one counts
// for nobody, lib/decks/cover.ts). The same rule the deck page's
// listDeckCards reads by, so a tile and its page pick the same default.
// ---------------------------------------------------------------------------

const OWNER = "owner-1";
const OTHER = "artist-1";

type Row = Record<string, unknown>;
const s = vi.hoisted(() => ({ commanders: [] as Row[], decks: [] as Row[] }));

function chain(rows: () => Row[]) {
  const c: Record<string, unknown> = {};
  for (const op of ["select", "in", "eq", "neq", "order", "limit"]) c[op] = () => c;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve);
  return c;
}

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => chain(() => (table === "deck_cards" ? s.commanders : s.decks)) }),
}));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => ({ from: () => chain(() => []) }) }));

import { listDeckCoverColors } from "@/lib/decks/cover-colors";

const linked = (board: string, card: Row) => ({ board, scryfall_id: null, card_id: "c", color_identity: [], card });

beforeEach(() => {
  s.commanders = [];
  s.decks = [];
});

describe("listDeckCoverColors (D3)", () => {
  it("a commander of another creator's that is UNLISTED tells nothing; a public one tells its colours", async () => {
    s.commanders = [
      { deck_id: "d-unlisted", deck: { owner_id: OWNER }, ...linked("commander", { color_identity: ["green"], visibility: "unlisted", owner_id: OTHER }) },
      { deck_id: "d-public", deck: { owner_id: OWNER }, ...linked("commander", { color_identity: ["red"], visibility: "public", owner_id: OTHER }) },
      { deck_id: "d-own", deck: { owner_id: OWNER }, ...linked("commander", { color_identity: ["blue"], visibility: "unlisted", owner_id: OWNER }) },
    ];
    // The unlisted commander's deck falls through to its playable rows.
    s.decks = [
      { id: "d-unlisted", owner_id: OWNER, deck_cards: [linked("main", { color_identity: ["green"], visibility: "unlisted", owner_id: OTHER })] },
    ];
    const colors = await listDeckCoverColors(["d-unlisted", "d-public", "d-own"]);
    expect(colors.get("d-public")).toEqual(["R"]);
    expect(colors.get("d-own")).toEqual(["U"]);
    // Nothing the deck may show: no colours (the neutral pair), never green.
    expect(colors.get("d-unlisted")).toBeNull();
  });
});
