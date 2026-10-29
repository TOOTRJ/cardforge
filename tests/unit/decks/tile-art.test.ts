import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// A deck TILE's colours and fan (lib/decks/tile-art.ts, TODO DK8.1) read
// their own rows, so they hold the deck page's rules themselves:
//   * D3 — another creator's card counts and stands in the fan only while
//     it is PUBLIC (an unlisted one is readable through RLS); the deck
//     owner's own as it is, a private one for nobody (lib/decks/cover.ts,
//     featured.ts);
//   * the fan is the first three of the page's fan, a PipGlyph card by its
//     600 px thumb (with its full row read for the thumbnail), never the HD
//     PNG;
//   * ONE embedded read for the page of decks (per-deck row cap, the page's
//     order, the maybeboard out), then one read of the fan cards.
// (Replaces lib/decks/cover-colors.ts's test: the tiles' colour read.)
// ---------------------------------------------------------------------------

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const HOST = "https://auth.pipglyph.com";

type Row = Record<string, unknown>;
type Call = { table: string; ops: Array<[string, ...unknown[]]> };
const s = vi.hoisted(() => ({ decks: [] as Row[], cards: [] as Row[], calls: [] as Call[], fail: false, noRank: false }));

function chain(table: string) {
  const call: Call = { table, ops: [] };
  s.calls.push(call);
  const c: Record<string, unknown> = {};
  for (const op of ["select", "in", "eq", "neq", "order", "limit"]) {
    c[op] = (...args: unknown[]) => {
      call.ops.push([op, ...args]);
      return c;
    };
  }
  c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    if (s.fail) return Promise.reject(new Error("network")).then(resolve, reject);
    // A database 0150 hasn't reached: a select naming featured_rank is 42703.
    const select = String(call.ops.find((op) => op[0] === "select")?.[1] ?? "");
    if (s.noRank && select.includes("featured_rank")) {
      return Promise.resolve({
        data: null,
        error: { code: "42703", message: "column deck_cards_1.featured_rank does not exist" },
      }).then(resolve, reject);
    }
    return Promise.resolve({ data: table === "decks" ? s.decks : s.cards, error: null }).then(resolve, reject);
  };
  return c;
}

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: chain }) }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => ({ from: chain }) }));

import { listDeckTileArt, TILE_FAN_MAX } from "@/lib/decks/tile-art";

const renders = (owner: string, id: string) => ({
  rendered_image_url: `${HOST}/storage/v1/object/public/card-renders/${owner}/${id}.png?v=1`,
  rendered_thumb_url: `${HOST}/storage/v1/object/public/card-renders/${owner}/${id}.thumb.webp?v=1`,
});

const card = (id: string, owner: string, visibility: string, colors: string[] = ["red"]) => ({
  id,
  owner_id: owner,
  title: `Card ${id}`,
  visibility,
  color_identity: colors,
  ...renders(owner, id),
});

const entry = (id: string, board: string, linked: Row | null, extra: Row = {}) => ({
  id,
  board,
  name: linked ? String(linked.title) : `Print ${id}`,
  position: Number(id.replace(/\D/g, "")) || 0,
  card_id: linked ? linked.id : null,
  scryfall_id: linked ? null : `sf-${id}`,
  image_url: linked ? null : `https://cards.scryfall.io/normal/front/a/b/${id}.jpg`,
  type_line: "Creature",
  color_identity: [],
  card: linked,
  ...extra,
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
  s.decks = [];
  s.cards = [];
  s.calls = [];
  s.fail = false;
  s.noRank = false;
});

describe("listDeckTileArt — colours (D3, the page's default cover)", () => {
  it("a commander of another creator's that is UNLISTED tells nothing; a public one tells its colours", async () => {
    s.decks = [
      { id: "d-unlisted", owner_id: OWNER, deck_cards: [entry("e1", "commander", card("c1", OTHER, "unlisted", ["green"]))] },
      { id: "d-public", owner_id: OWNER, deck_cards: [entry("e2", "commander", card("c2", OTHER, "public", ["red"]))] },
      { id: "d-own", owner_id: OWNER, deck_cards: [entry("e3", "commander", card("c3", OWNER, "unlisted", ["blue"]))] },
      { id: "d-private", owner_id: OWNER, deck_cards: [entry("e4", "main", card("c4", OWNER, "private", ["black"]))] },
    ];
    const art = await listDeckTileArt(s.decks.map((d) => ({ id: String(d.id), owner_id: OWNER })), { anonymous: true });
    expect(art.get("d-public")?.colors).toEqual(["R"]);
    expect(art.get("d-own")?.colors).toEqual(["U"]);
    // Nothing the deck may show: no colours (the neutral pair), never green
    // or black.
    expect(art.get("d-unlisted")?.colors).toBeNull();
    expect(art.get("d-private")?.colors).toBeNull();
  });
});

describe("listDeckTileArt — the fan", () => {
  it("is the first three of the page's fan: the commander first, never a private card or another creator's unlisted one", async () => {
    const commander = card("c10", OWNER, "public");
    const mine = [card("c11", OWNER, "public"), card("c12", OWNER, "unlisted"), card("c13", OWNER, "public")];
    const privateOwn = card("c14", OWNER, "private");
    const theirsUnlisted = card("c15", OTHER, "unlisted");
    const theirsPublic = card("c16", OTHER, "public");
    s.decks = [
      {
        id: "d1",
        owner_id: OWNER,
        deck_cards: [
          entry("e10", "commander", commander),
          ...mine.map((c, i) => entry(`e${11 + i}`, "main", c)),
          entry("e14", "main", privateOwn),
          entry("e15", "main", theirsUnlisted),
          entry("e16", "main", theirsPublic),
          entry("e17", "main", null),
        ],
      },
    ];
    s.cards = [commander, ...mine, privateOwn, theirsUnlisted, theirsPublic].map((c) => ({
      ...c,
      frame_style: { template: "m15" },
      art_position: {},
      subtypes: [],
    }));
    const art = await listDeckTileArt([{ id: "d1", owner_id: OWNER }], { anonymous: true });
    const fan = art.get("d1")!.fan;
    expect(fan).toHaveLength(TILE_FAN_MAX);
    expect(fan[0]).toMatchObject({ kind: "custom", key: "card:c10" });
    const keys = fan.map((f) => f.key);
    expect(keys).not.toContain("card:c14");
    expect(keys).not.toContain("card:c15");
    // Customs fill before printings (the custom work is what a deck shows off).
    expect(fan.every((f) => f.kind === "custom")).toBe(true);
    // A fan card is drawn from its full row, and by its THUMB.
    for (const f of fan) {
      if (f.kind !== "custom") continue;
      expect(f.card.rendered_thumb_url).toContain(".thumb.webp");
      expect(f.card).toHaveProperty("frame_style");
    }
  });

  it("a card turned private between the two reads leaves the fan; printings stand in", async () => {
    const flips = card("c20", OWNER, "public");
    s.decks = [{ id: "d2", owner_id: OWNER, deck_cards: [entry("e20", "main", flips), entry("e21", "main", null)] }];
    s.cards = [{ ...flips, visibility: "private", frame_style: { template: "m15" } }];
    const art = await listDeckTileArt([{ id: "d2", owner_id: OWNER }]);
    expect(art.get("d2")!.fan.map((f) => f.kind)).toEqual(["printing"]);
  });

  it("is ONE embedded read per page (per-deck cap, page order, maybeboard out), then the fan cards", async () => {
    s.decks = [{ id: "d3", owner_id: OWNER, deck_cards: [entry("e30", "main", card("c30", OWNER, "public"))] }];
    s.cards = [{ ...card("c30", OWNER, "public"), frame_style: { template: "m15" } }];
    await listDeckTileArt([{ id: "d3", owner_id: OWNER }, { id: "d4", owner_id: OWNER }], { anonymous: true });
    expect(s.calls.map((c) => c.table)).toEqual(["decks", "cards"]);
    const deckRead = s.calls[0].ops.map((op) => JSON.stringify(op));
    expect(deckRead).toContain(JSON.stringify(["in", "id", ["d3", "d4"]]));
    expect(deckRead).toContain(JSON.stringify(["neq", "deck_cards.board", "maybe"]));
    expect(deckRead).toContain(JSON.stringify(["limit", 1000, { referencedTable: "deck_cards" }]));
    expect(deckRead).toContain(JSON.stringify(["order", "id", { referencedTable: "deck_cards" }]));
    // Never the HD PNG as a column a tile would draw: the thumb is selected.
    expect(String(s.calls[0].ops.find((op) => op[0] === "select")?.[1])).toContain("rendered_thumb_url");
  });

  it("follows the owner's cover picks (DK6.4): the commander, then the picks by rank", async () => {
    const commander = card("c40", OWNER, "public");
    const fill = [card("c41", OWNER, "public"), card("c42", OWNER, "public"), card("c43", OWNER, "public")];
    const picked = card("c44", OWNER, "public");
    s.decks = [
      {
        id: "d6",
        owner_id: OWNER,
        deck_cards: [
          entry("e40", "commander", commander),
          ...fill.map((c, i) => entry(`e${41 + i}`, "main", c)),
          entry("e44", "main", picked, { featured_rank: 2 }),
          entry("e45", "main", null, { featured_rank: 1 }),
        ],
      },
    ];
    s.cards = [commander, ...fill, picked].map((c) => ({ ...c, frame_style: { template: "m15" } }));
    const art = await listDeckTileArt([{ id: "d6", owner_id: OWNER }], { anonymous: true });
    expect(art.get("d6")!.fan.map((f) => f.key)).toEqual(["card:c40", "print:sf-e45", "card:c44"]);
    expect(String(s.calls[0].ops.find((op) => op[0] === "select")?.[1])).toContain("featured_rank");
  });

  it("a database 0150 hasn't reached: the read runs again without the rank — today's fan, never no art", async () => {
    s.noRank = true;
    s.decks = [{ id: "d7", owner_id: OWNER, deck_cards: [entry("e70", "commander", null), entry("e71", "main", null)] }];
    const art = await listDeckTileArt([{ id: "d7", owner_id: OWNER }], { anonymous: true });
    expect(art.get("d7")!.fan.map((f) => f.key)).toEqual(["print:sf-e70", "print:sf-e71"]);
    const deckReads = s.calls.filter((c) => c.table === "decks").map((c) => String(c.ops.find((op) => op[0] === "select")?.[1]));
    expect(deckReads).toHaveLength(2);
    expect(deckReads[0]).toContain("featured_rank");
    expect(deckReads[1]).not.toContain("featured_rank");
  });

  it("no decks, no read; a failed read is no art (the neutral pair), never a thrown page", async () => {
    expect((await listDeckTileArt([])).size).toBe(0);
    expect(s.calls).toHaveLength(0);
    s.fail = true;
    expect((await listDeckTileArt([{ id: "d5", owner_id: OWNER }])).size).toBe(0);
  });
});
