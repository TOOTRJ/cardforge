import { beforeEach, describe, expect, it, vi } from "vitest";
import dfcPrintings from "../scryfall/fixtures/dfc-import-printings.json";
import importPrintings from "../scryfall/fixtures/import-printings.json";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.4 (owner Q4) — the AI deck remix's cost estimate
// (lib/ai/remix-estimate.ts): the deck's Scryfall entries resolved through
// the collection endpoint and mapped through the remix's own frame choice,
// a double-faced printing on its bodies priced at two credits. The jobs
// route sizes its pre-check and the plan from it; the remix dialog shows it
// before the confirm. Supabase, Scryfall and the verified set are stubbed;
// the mapper and the resolver are the real ones, on real printings.
// ---------------------------------------------------------------------------

const ALL = { ...dfcPrintings, ...importPrintings, ...signaturePrintings } as unknown as Record<string, { id: string }>;
const idOf = (key: string) => ALL[key]!.id;

const s = vi.hoisted(() => ({
  items: [] as Array<{ entry: Record<string, unknown>; card: null }>,
  verified: [] as string[],
  collectionCalls: [] as Array<Array<{ id: string }>>,
  collectionFails: false,
  /** The signed-in viewer and the deck's row (RLS lets a public deck be
   *  read; only its OWNER may remix it). */
  user: { id: "user-1" } as { id: string } | null,
  deck: { id: "deck-1", owner_id: "user-1" } as { id: string; owner_id: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({ getCurrentUser: async () => s.user }));

vi.mock("@/lib/decks/queries", () => ({ listDeckCards: async () => s.items, getDeckById: async () => s.deck }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => s.verified }));
vi.mock("@/lib/scryfall/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/scryfall/client")>();
  // The fixtures, read inside the factory (hoisted above the imports).
  const fixtures = await Promise.all([
    import("../scryfall/fixtures/dfc-import-printings.json"),
    import("../scryfall/fixtures/import-printings.json"),
    import("../scryfall/fixtures/signature-printings.json"),
  ]);
  const byId = new Map<string, unknown>();
  for (const file of fixtures) {
    for (const [key, card] of Object.entries(file.default as Record<string, { id?: string }>)) {
      if (!key.startsWith("_") && card.id) byId.set(card.id, card);
    }
  }
  return {
    ...real,
    getCardCollection: async (identifiers: Array<{ id: string }>) => {
      s.collectionCalls.push(identifiers);
      if (s.collectionFails) return null;
      return {
        cards: identifiers.flatMap(({ id }) => {
          const raw = byId.get(id);
          return raw ? [real.scryfallCardSchema.parse(raw)] : [];
        }),
        notFound: [],
      };
    },
  };
});

import { estimateDeckRemix } from "@/lib/ai/remix-estimate";

const entry = (id: string, over: Record<string, unknown>) => ({
  entry: { id, board: "main", quantity: 1, name: "x", card_id: null, scryfall_id: null, ...over },
  card: null,
});
const keys = (...combos: [string, string][]) =>
  combos.map(([template, colour]) => frameComboKey(template as FrameTemplate, colour));

beforeEach(() => {
  s.items = [];
  s.verified = [];
  s.collectionCalls = [];
  s.collectionFails = false;
  s.user = { id: "user-1" };
  s.deck = { id: "deck-1", owner_id: "user-1" };
});

describe("estimateDeckRemix", () => {
  it("prices a double-faced printing on its bodies at two credits, everything else at one", async () => {
    s.verified = keys(["m15dfcfront", "w"], ["m15dfcbackleft", "r"], ["m15", "g"], ["m15", "w"]);
    s.items = [
      entry("e-cathar", { name: "Brutal Cathar", scryfall_id: idOf("mid-7") }),
      entry("e-elves", { name: "Llanowar Elves", scryfall_id: idOf("dom-168") }),
      entry("e-own", { name: "My Card", card_id: "11111111-1111-4111-8111-111111111111" }),
      // No source at all: never remixed, never counted.
      entry("e-none", { name: "Nothing" }),
    ];
    const estimate = await estimateDeckRemix("deck-1", 100);
    expect(estimate).toEqual({
      cards: 3,
      credits: 4,
      doubleFaced: 1,
      skipped: 0,
      unresolved: 0,
      creditsByEntry: { "e-cathar": 2, "e-elves": 1, "e-own": 1 },
    });
    // One collection call for the deck's Scryfall ids, ids once each.
    expect(s.collectionCalls).toEqual([[{ id: idOf("mid-7") }, { id: idOf("dom-168") }]]);
  });

  it("prices the same printing at one credit while either body isn't ticked", async () => {
    s.items = [entry("e-cathar", { name: "Brutal Cathar", scryfall_id: idOf("mid-7") })];
    for (const verified of [keys(["m15", "w"]), keys(["m15", "w"], ["m15dfcfront", "w"]), keys(["m15", "w"], ["m15dfcbackleft", "r"])]) {
      s.verified = verified;
      expect(await estimateDeckRemix("deck-1", 100)).toMatchObject({ cards: 1, credits: 1, doubleFaced: 0 });
    }
  });

  it("applies the batch cap and reports the skipped entries", async () => {
    s.verified = keys(["m15", "g"]);
    s.items = ["a", "b", "c"].map((id) => entry(`e-${id}`, { name: "Llanowar Elves", scryfall_id: idOf("dom-168") }));
    expect(await estimateDeckRemix("deck-1", 2)).toMatchObject({ cards: 2, credits: 2, skipped: 1 });
  });

  it("a Scryfall failure leaves the entries unresolved — priced one credit (the step fails and refunds them)", async () => {
    s.collectionFails = true;
    s.items = [entry("e-cathar", { name: "Brutal Cathar", scryfall_id: idOf("mid-7") })];
    expect(await estimateDeckRemix("deck-1", 100)).toMatchObject({ cards: 1, credits: 1, doubleFaced: 0, unresolved: 1 });
  });

  it("an empty (or unreadable) deck is zero cards, and never asks Scryfall", async () => {
    expect(await estimateDeckRemix("deck-1", 100)).toMatchObject({ cards: 0, credits: 0 });
    expect(s.collectionCalls).toEqual([]);
  });

  it("a deck that isn't the caller's (a public one RLS lets them read) is zero cards, and never asks Scryfall", async () => {
    s.items = [entry("e-cathar", { name: "Brutal Cathar", scryfall_id: idOf("mid-7") })];
    s.deck = { id: "deck-1", owner_id: "someone-else" };
    expect(await estimateDeckRemix("deck-1", 100)).toEqual({ cards: 0, credits: 0, doubleFaced: 0, skipped: 0, unresolved: 0, creditsByEntry: {} });
    s.deck = null;
    expect(await estimateDeckRemix("deck-1", 100)).toMatchObject({ cards: 0 });
    s.deck = { id: "deck-1", owner_id: "user-1" };
    s.user = null;
    expect(await estimateDeckRemix("deck-1", 100)).toMatchObject({ cards: 0 });
    expect(s.collectionCalls).toEqual([]);
  });
});
