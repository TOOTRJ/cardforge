import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// commitDeckImportAction (DK0.3, migration 0143):
//   (a) it spends the `deck_import` quota like the resolve step, and a
//       limited user calls neither Scryfall nor the database;
//   (c) of the browser's card data only the printing id is read — a uuid —
//       and what is stored is Scryfall's own answer for it; an id Scryfall
//       doesn't know becomes a name-only placeholder;
//   (d) the write is ONE call of import_deck_entries (the transaction and
//       the lock live in the database), and its refusals read as words.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const DECK = "22222222-2222-4222-8222-222222222222";
const BOLT_ID = "e3285e6b-3e79-4d7c-bf96-d920f973b80c";
const GONE_ID = "00000000-0000-4000-8000-0000000000ff";

const s = vi.hoisted(() => ({
  rate: { ok: true } as { ok: true } | { ok: false; message: string; retryAfterSeconds: number },
  logged: 0,
  collectionCalls: [] as unknown[][],
  collection: [] as Record<string, unknown>[] | null,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: { added: 2, merged: 1 } as unknown, error: null as null | { message: string; details?: string } },
  deck: { id: "", owner_id: "", slug: "my-deck" } as { id: string; owner_id: string; slug: string } | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/profile/username", () => ({ revalidateProfilePage: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: USER }),
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      s.rpcCalls.push({ fn, args });
      return s.rpcResult;
    },
  }),
}));
vi.mock("@/lib/decks/queries", () => ({ getDeckById: async () => s.deck }));
vi.mock("@/lib/scryfall/rate-limit", () => ({
  checkScryfallRateLimit: async () => s.rate,
  logScryfallCall: async () => {
    s.logged += 1;
  },
}));
vi.mock("@/lib/scryfall/client", () => ({
  SCRYFALL_COLLECTION_MAX: 75,
  getCardByName: async () => null,
  getCardCollection: async (identifiers: unknown[]) => {
    s.collectionCalls.push(identifiers);
    return s.collection === null ? null : { cards: s.collection, notFound: [] };
  },
}));

import { commitDeckImportAction } from "@/lib/decks/import";

const scryfallBolt = {
  id: BOLT_ID,
  name: "Lightning Bolt",
  set: "2xm",
  collector_number: "141",
  cmc: 1,
  mana_cost: "{R}",
  type_line: "Instant",
  color_identity: ["R"],
  rarity: "uncommon",
  image_uris: { normal: "https://cards.scryfall.io/normal/front/e/3/e3285e6b.jpg?1599707000" },
};

/** What the review dialog posts back: the whole resolved object — here a
 *  tampered one whose every field but the id lies. */
const spoofed = (scryfall_id: string) => ({
  scryfall_id,
  name: "Black Lotus",
  set_code: "lea",
  collector_number: "232",
  type_line: "Artifact — Totally Real",
  mana_cost: "{0}",
  mana_value: 0,
  color_identity: ["W", "U", "B", "R", "G"],
  rarity: "mythic",
  image_url: "https://cards.scryfall.io/normal/front/x/y/spoof.jpg",
});

beforeEach(() => {
  s.rate = { ok: true };
  s.logged = 0;
  s.collectionCalls = [];
  s.collection = [scryfallBolt];
  s.rpcCalls = [];
  s.rpcResult = { data: { added: 2, merged: 1 }, error: null };
  s.deck = { id: DECK, owner_id: USER, slug: "my-deck" };
});

describe("commitDeckImportAction", () => {
  it("stores Scryfall's own data for each id, never the browser's; an unknown id is a placeholder", async () => {
    const result = await commitDeckImportAction({
      deckId: DECK,
      lines: [
        { name: "Lightning Bolt", quantity: 4, board: "main", resolved: spoofed(BOLT_ID) },
        { name: "Mystery", quantity: 1, board: "side", resolved: spoofed(GONE_ID) },
        { name: "Typo Card", quantity: 2, board: "main", resolved: null },
      ],
    });
    expect(result).toEqual({ ok: true, added: 2, merged: 1, placeholders: 2 });

    // One collection request, by id only.
    expect(s.collectionCalls).toEqual([[{ id: BOLT_ID }, { id: GONE_ID }]]);
    expect(s.logged).toBe(1);

    expect(s.rpcCalls).toHaveLength(1);
    const { fn, args } = s.rpcCalls[0]!;
    expect(fn).toBe("import_deck_entries");
    expect(args.p_deck_id).toBe(DECK);
    expect(args.p_entries).toEqual([
      {
        board: "main",
        quantity: 4,
        name: "Lightning Bolt",
        scryfall_id: BOLT_ID,
        set_code: "2xm",
        collector_number: "141",
        type_line: "Instant",
        mana_cost: "{R}",
        mana_value: 1,
        color_identity: ["R"],
        rarity: "uncommon",
        image_url: "https://cards.scryfall.io/normal/front/e/3/e3285e6b.jpg?1599707000",
      },
      expect.objectContaining({ board: "side", name: "Mystery", scryfall_id: null, type_line: null, image_url: null }),
      expect.objectContaining({ board: "main", name: "Typo Card", scryfall_id: null, quantity: 2 }),
    ]);
    expect(JSON.stringify(args.p_entries)).not.toContain("Lotus");
  });

  it("refuses a Scryfall id that isn't a uuid before anything runs", async () => {
    const result = await commitDeckImportAction({
      deckId: DECK,
      lines: [{ name: "Bolt", quantity: 1, board: "main", resolved: { scryfall_id: "x'); drop table--" } }],
    });
    expect(result.ok).toBe(false);
    expect(s.collectionCalls).toEqual([]);
    expect(s.rpcCalls).toEqual([]);
  });

  it("is rate-limited like the resolve step: no Scryfall call, no write, no log row", async () => {
    s.rate = { ok: false, message: "Slow down", retryAfterSeconds: 60 };
    const result = await commitDeckImportAction({
      deckId: DECK,
      lines: [{ name: "Bolt", quantity: 1, board: "main", resolved: { scryfall_id: BOLT_ID } }],
    });
    expect(result).toEqual({ ok: false, error: "Slow down", retryAfterSeconds: 60 });
    expect(s.collectionCalls).toEqual([]);
    expect(s.rpcCalls).toEqual([]);
    expect(s.logged).toBe(0);
  });

  it("writes nothing when Scryfall doesn't answer", async () => {
    s.collection = null;
    const result = await commitDeckImportAction({
      deckId: DECK,
      lines: [{ name: "Bolt", quantity: 1, board: "main", resolved: { scryfall_id: BOLT_ID } }],
    });
    expect(result.ok).toBe(false);
    expect(s.rpcCalls).toEqual([]);
  });

  it("asks Scryfall 75 ids at a time", async () => {
    const ids = Array.from({ length: 80 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    s.collection = [];
    await commitDeckImportAction({
      deckId: DECK,
      lines: ids.map((id, i) => ({ name: `Card ${i}`, quantity: 1, board: "main", resolved: { scryfall_id: id } })),
    });
    expect(s.collectionCalls.map((c) => c.length)).toEqual([75, 5]);
  });

  it("merges the list's own duplicates before the write (the database refuses two entries with one key)", async () => {
    await commitDeckImportAction({
      deckId: DECK,
      lines: [
        { name: "Lightning Bolt", quantity: 2, board: "main", resolved: { scryfall_id: BOLT_ID } },
        { name: "Lightning Blot", quantity: 1, board: "main", resolved: { scryfall_id: BOLT_ID } },
      ],
    });
    const entries = s.rpcCalls[0]?.args.p_entries as Array<{ quantity: number }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.quantity).toBe(3);
  });

  it("refuses another user's deck without calling Scryfall", async () => {
    s.deck = { id: DECK, owner_id: "someone-else", slug: "theirs" };
    const result = await commitDeckImportAction({
      deckId: DECK,
      lines: [{ name: "Bolt", quantity: 1, board: "main", resolved: { scryfall_id: BOLT_ID } }],
    });
    expect(result).toEqual({ ok: false, error: "Deck not found or not yours." });
    expect(s.collectionCalls).toEqual([]);
  });

  it("turns the 500-entry cap into words with the database's numbers", async () => {
    s.rpcResult = {
      data: null,
      error: { message: "deck_entry_limit: a deck holds at most 500 entries", details: "existing=450,adding=80" },
    };
    const result = await commitDeckImportAction({
      deckId: DECK,
      lines: [{ name: "Bolt", quantity: 1, board: "main", resolved: { scryfall_id: BOLT_ID } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/at most 500/);
      expect(result.error).toMatch(/530/);
    }
  });

  it("never shows a raw database message", async () => {
    s.rpcResult = { data: null, error: { message: "relation \"deck_cards\" does not exist" } };
    const result = await commitDeckImportAction({
      deckId: DECK,
      lines: [{ name: "Bolt", quantity: 1, board: "main", resolved: { scryfall_id: BOLT_ID } }],
    });
    expect(result).toEqual({ ok: false, error: "Couldn't save the import — nothing was added. Try again." });
  });
});
