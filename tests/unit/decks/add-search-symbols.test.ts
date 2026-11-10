import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// New pips PR 6 — the deck page's add box draws each result's CARD OWNER's
// symbols (as the deck's rows do since PR 4): one batched read per search,
// only for owners whose card's cost names one, and the row the box adds
// before the server answers carries them too.
// ---------------------------------------------------------------------------

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "99999999-9999-4999-8999-999999999999";
const PLAIN = "77777777-7777-4777-8777-777777777777";

const s = vi.hoisted(() => ({
  mine: [] as unknown[],
  gallery: [] as unknown[],
  owners: [] as string[][],
}));

vi.mock("@/lib/decks/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/decks/queries")>();
  return { ...actual, readDeckPageCardRows: async () => s.mine };
});
vi.mock("@/lib/pips/queries", () => ({
  readOwnerSymbolsOf: async (ids: Iterable<string>) => {
    const list = [...ids];
    s.owners.push(list);
    const map = new Map();
    for (const id of list) map.set(id, { meanings: { FIRE: { manaValue: 3, baseColor: "R" } }, pictures: { "*FIRE": `pic-${id}` } });
    return map;
  },
}));

import { searchDeckAddCards } from "@/lib/decks/add-search-queries";

const card = (id: string, owner: string, cost: string | null) => ({ id, owner_id: owner, title: `Card ${id}`, cost, visibility: "public" });

const supabase = {
  rpc: () => ({ then: (resolve: (value: unknown) => unknown) => resolve({ data: s.gallery }) }),
  from: () => ({ select: () => ({ in: () => ({ then: (resolve: (value: unknown) => unknown) => resolve({ data: [{ id: THEM, username: "them" }] }) }) }) }),
};

beforeEach(() => {
  s.owners = [];
  s.mine = [card("m1", ME, "{1}{*FIRE}"), card("m2", ME, "{2}")];
  s.gallery = [card("c1", THEM, "{*FIRE}"), card("c2", PLAIN, "{R}")];
});

describe("searchDeckAddCards — the owners' symbols", () => {
  it("attaches each card OWNER's symbols in one batch, only where the cost names one", async () => {
    const results = await searchDeckAddCards(supabase as never, ME, "card");
    expect(s.owners).toEqual([[ME, THEM]]);
    const byId = new Map([...results.mine, ...results.community].map((candidate) => [candidate.card.id, candidate]));
    expect(byId.get("m1")?.ownerSymbols?.pictures).toEqual({ "*FIRE": `pic-${ME}` });
    expect(byId.get("c1")?.ownerSymbols?.pictures).toEqual({ "*FIRE": `pic-${THEM}` });
    expect(byId.get("m2")).not.toHaveProperty("ownerSymbols");
    expect(byId.get("c2")).not.toHaveProperty("ownerSymbols");
    expect(byId.get("c1")?.maker).toBe("them");
  });

  it("reads nothing more when no result names a symbol", async () => {
    s.mine = [card("m2", ME, "{2}")];
    s.gallery = [card("c2", PLAIN, "{R}")];
    const results = await searchDeckAddCards(supabase as never, ME, "card");
    expect(s.owners).toEqual([[]]);
    expect([...results.mine, ...results.community].some((candidate) => "ownerSymbols" in candidate)).toBe(false);
  });
});

describe("the add box", () => {
  it("draws the result's cost with its owner's pictures, and the row it adds carries them", () => {
    const box = readFileSync(join(process.cwd(), "components/decks/deck-add-box.tsx"), "utf8");
    expect(box).toContain('<ManaCostGlyphs cost={option.cost} size="sm" overrides={option.costPictures} />');
    expect(box).toContain("...(ownerSymbols ? { costPictures: ownerSymbols.pictures } : {})");
    expect(box).toContain("...(ownerSymbols ? { ownerSymbols } : {})");
  });
});
