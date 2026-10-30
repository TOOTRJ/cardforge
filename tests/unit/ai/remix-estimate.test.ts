import { beforeEach, describe, expect, it, vi } from "vitest";
import dfcPrintings from "../scryfall/fixtures/dfc-import-printings.json";
import importPrintings from "../scryfall/fixtures/import-printings.json";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";
import tokenPrintings from "../scryfall/fixtures/token-printings.json";
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

const ALL = { ...tokenPrintings, ...dfcPrintings, ...importPrintings, ...signaturePrintings } as unknown as Record<string, { id: string }>;
const idOf = (key: string) => ALL[key]!.id;

const s = vi.hoisted(() => ({
  items: [] as Array<{ entry: Record<string, unknown>; card: Record<string, unknown> | null }>,
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
    import("../scryfall/fixtures/token-printings.json"),
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
      emblems: 0,
      moderationLocked: 0,
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

  // An entry that is one of the user's OWN cards is priced through the
  // step's own frame choice (ownCardRemixFrame): a card on the double-faced
  // bodies keeps both faces — two pictures, two credits — where both are
  // still published; every other own card is one credit, as it always was.
  it("prices an own card on the double-faced bodies at two credits, and only while both bodies are ticked", async () => {
    const ownDfc = {
      title: "Brutal Cathar",
      card_type: "creature",
      supertype: null,
      subtypes: ["Human"],
      color_identity: ["white"],
      rules_text: "Daybound",
      frame_style: { template: "m15dfcfront", dfcIcon: "sunmoon" },
      back_face: { title: "Moonrage Brute", card_type: "creature", frame_style: { template: "m15dfcbackleft" }, color_identity: ["red"] },
    };
    const ownVehicle = {
      title: "Skiff",
      card_type: "artifact",
      supertype: null,
      subtypes: ["Vehicle"],
      color_identity: ["colorless"],
      rules_text: "Crew 1",
      frame_style: { template: "m15vehicle" },
      back_face: null,
    };
    s.items = [
      { ...entry("e-dfc", { name: "Brutal Cathar", card_id: "11111111-1111-4111-8111-111111111111" }), card: ownDfc },
      { ...entry("e-vehicle", { name: "Skiff", card_id: "22222222-2222-4222-8222-222222222222" }), card: ownVehicle },
      // A card the viewer can no longer read: one credit (the step fails it and refunds).
      entry("e-gone", { name: "Gone", card_id: "33333333-3333-4333-8333-333333333333" }),
    ];
    s.verified = keys(["m15dfcfront", "w"], ["m15dfcbackleft", "r"], ["m15vehicle", "c"]);
    expect(await estimateDeckRemix("deck-1", 100)).toEqual({
      cards: 3,
      credits: 4,
      doubleFaced: 1,
      skipped: 0,
      emblems: 0,
      moderationLocked: 0,
      unresolved: 0,
      creditsByEntry: { "e-dfc": 2, "e-vehicle": 1, "e-gone": 1 },
    });
    for (const verified of [keys(["m15dfcfront", "w"]), keys(["m15dfcbackleft", "r"]), []]) {
      s.verified = verified;
      expect(await estimateDeckRemix("deck-1", 100)).toMatchObject({ cards: 3, credits: 3, doubleFaced: 0 });
    }
    // Own cards never ask Scryfall.
    expect(s.collectionCalls).toEqual([]);
  });

  it("an entry with BOTH an own card and a printing is priced as the step remixes it: by its own card", async () => {
    s.verified = keys(["m15dfcfront", "w"], ["m15dfcbackleft", "r"], ["m15", "w"]);
    s.items = [
      {
        ...entry("e-both", { name: "Brutal Cathar", card_id: "11111111-1111-4111-8111-111111111111", scryfall_id: idOf("mid-7") }),
        card: { title: "My Cathar", card_type: "creature", supertype: null, subtypes: [], color_identity: ["white"], rules_text: null, frame_style: { template: "m15" }, back_face: null },
      },
    ];
    expect(await estimateDeckRemix("deck-1", 100)).toMatchObject({ cards: 1, credits: 1, doubleFaced: 0, unresolved: 0 });
    expect(s.collectionCalls).toEqual([]);
  });

  // The independent check's mixed deck: every kind of entry in one estimate,
  // each priced as its step lands it. The price never follows the printing
  // behind an own card — in EITHER direction (the step reads `card_id`
  // first, so that is the card whose pictures are generated).
  it("a mixed deck: each entry priced as its step remixes it, the total their sum", async () => {
    const own = (over: Record<string, unknown>) => ({
      title: "My Card",
      card_type: "creature",
      supertype: null,
      subtypes: ["Human"],
      color_identity: ["white"],
      rules_text: null,
      frame_style: { template: "m15" },
      back_face: null,
      ...over,
    });
    const ownDfc = (backColour: string) =>
      own({
        frame_style: { template: "m15dfcfront", dfcIcon: "sunmoon" },
        back_face: { title: "Other Side", card_type: "creature", frame_style: { template: "m15dfcbackleft" }, color_identity: [backColour] },
      });
    const id = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
    s.verified = keys(
      ["m15dfcfront", "w"],
      ["m15dfcbackleft", "r"],
      ["m15", "w"],
      ["m15", "g"],
      ["m20token", "r"],
    );
    s.items = [
      { ...entry("own-one-faced", { card_id: id(1) }), card: own({}) },
      { ...entry("own-dfc", { card_id: id(2) }), card: ownDfc("red") },
      // Its back's body isn't published in blue: one face, one credit.
      { ...entry("own-dfc-unverified", { card_id: id(3) }), card: ownDfc("blue") },
      entry("scryfall-dfc", { name: "Brutal Cathar", scryfall_id: idOf("mid-7") }),
      {
        ...entry("own-token", { card_id: id(4) }),
        card: own({ card_type: "token", supertype: "Creature", color_identity: ["red"], frame_style: { template: "m20token" } }),
      },
      // Both ids: the own card decides, whatever its printing is.
      { ...entry("both-own-dfc", { card_id: id(5), scryfall_id: idOf("dom-168") }), card: ownDfc("red") },
      { ...entry("both-own-one-faced", { card_id: id(6), scryfall_id: idOf("mid-7") }), card: own({}) },
      // Emblems are left out, own and printed (owner 2026-10-13).
      { ...entry("own-emblem", { card_id: id(7) }), card: own({ card_type: "emblem", color_identity: ["colorless"], frame_style: { template: "emblem" } }) },
      entry("printed-emblem", { name: "Kaito, Cunning Infiltrator Emblem", scryfall_id: idOf("tfdn-24") }),
    ];
    const estimate = await estimateDeckRemix("deck-1", 100);
    expect(estimate.creditsByEntry).toEqual({
      "own-one-faced": 1,
      "own-dfc": 2,
      "own-dfc-unverified": 1,
      "scryfall-dfc": 2,
      "own-token": 1,
      "both-own-dfc": 2,
      "both-own-one-faced": 1,
      "printed-emblem": 0,
    });
    expect(estimate).toMatchObject({ cards: 7, credits: 10, doubleFaced: 3, emblems: 2, unresolved: 0 });
    // Only the entries WITHOUT an own card ask Scryfall.
    expect(s.collectionCalls).toEqual([[{ id: idOf("mid-7") }, { id: idOf("tfdn-24") }]]);
  });

  // Emblems are NOT remixed (owner 2026-10-13): an own emblem card and a
  // printed emblem are both left out — counted, priced nothing, no step.
  it("leaves emblems out: not a card of the remix, no credit, counted for the dialog", async () => {
    const ownEmblem = {
      title: "Kaito, Cunning Infiltrator",
      card_type: "emblem",
      supertype: null,
      subtypes: ["Kaito"],
      color_identity: ["colorless"],
      rules_text: "Ninjas you control get +1/+1.",
      frame_style: { template: "emblem" },
      back_face: null,
    };
    s.verified = keys(["emblem", "c"], ["m15", "g"], ["m15", "c"]);
    s.items = [
      { ...entry("own-emblem", { name: "Kaito", card_id: "11111111-1111-4111-8111-111111111111" }), card: ownEmblem },
      entry("printed-emblem", { name: "Kaito, Cunning Infiltrator Emblem", scryfall_id: idOf("tfdn-24") }),
      entry("elves", { name: "Llanowar Elves", scryfall_id: idOf("dom-168") }),
    ];
    expect(await estimateDeckRemix("deck-1", 100)).toEqual({
      cards: 1,
      credits: 1,
      doubleFaced: 0,
      skipped: 0,
      emblems: 2,
      moderationLocked: 0,
      unresolved: 0,
      // The own emblem is not an entry of the remix at all; the printed one
      // is priced 0 — what tells the plan to make no step for it.
      creditsByEntry: { "printed-emblem": 0, elves: 1 },
    });

    // A deck of emblems alone: nothing to remix, nothing to pay.
    s.items = s.items.slice(0, 2);
    expect(await estimateDeckRemix("deck-1", 100)).toMatchObject({ cards: 0, credits: 0, emblems: 2 });
  });

  it("an own card moderation hid (0156) is left out: no entry, no credit, counted for the dialog, no slot", async () => {
    s.verified = keys(["m15", "g"]);
    s.items = [
      { ...entry("locked", { card_id: "11111111-1111-4111-8111-111111111111" }), card: { card_type: "creature", moderation_hidden_at: "2026-10-29T00:00:00Z" } },
      entry("e-a", { name: "Llanowar Elves", scryfall_id: idOf("dom-168") }),
      entry("e-b", { name: "Llanowar Elves", scryfall_id: idOf("dom-168") }),
    ];
    const estimate = await estimateDeckRemix("deck-1", 2);
    expect(estimate).toMatchObject({ cards: 2, credits: 2, skipped: 0, moderationLocked: 1, emblems: 0 });
    expect(estimate.creditsByEntry).not.toHaveProperty("locked");
  });

  it("an own emblem takes no slot of the batch cap", async () => {
    s.verified = keys(["m15", "g"]);
    s.items = [
      { ...entry("own-emblem", { card_id: "11111111-1111-4111-8111-111111111111" }), card: { card_type: "emblem" } },
      entry("e-a", { name: "Llanowar Elves", scryfall_id: idOf("dom-168") }),
      entry("e-b", { name: "Llanowar Elves", scryfall_id: idOf("dom-168") }),
    ];
    expect(await estimateDeckRemix("deck-1", 2)).toMatchObject({ cards: 2, credits: 2, skipped: 0, emblems: 1 });
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
    expect(await estimateDeckRemix("deck-1", 100)).toEqual({ cards: 0, credits: 0, doubleFaced: 0, skipped: 0, emblems: 0, moderationLocked: 0, unresolved: 0, creditsByEntry: {} });
    s.deck = null;
    expect(await estimateDeckRemix("deck-1", 100)).toMatchObject({ cards: 0 });
    s.deck = { id: "deck-1", owner_id: "user-1" };
    s.user = null;
    expect(await estimateDeckRemix("deck-1", 100)).toMatchObject({ cards: 0 });
    expect(s.collectionCalls).toEqual([]);
  });
});
