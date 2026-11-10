import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import { unknownSymbolsMessage } from "@/lib/symbols/symbols";

// ---------------------------------------------------------------------------
// New pips PR 3 — both card actions refuse a save that ADDS a `{*CODE}` its
// owner has no symbol for (it would draw a blank disc for every viewer), on
// its field, for every caller (lib/symbols/card-check.ts). A removed symbol
// is still the owner's; an edit is never asked about a code its stored card
// already named; a card that names none reads nothing. Harness:
// tests/unit/cards/print-typography-save.test.ts.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  existing: null as unknown,
  client: null as unknown,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminConfigured: () => false }));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () => ["m15/r", "m15/m", "m15/b", "m15pw/r"],
}));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.existing,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ premiumFrames: false, removeWatermark: false, cardCapacity: -1 }),
}));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn() }));
vi.mock("@/lib/decks/membership", () => ({ addCustomCardEntryToDeck: vi.fn() }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCard: vi.fn(),
  purgeHiddenCards: vi.fn(),
  revalidateCardListSurfaces: vi.fn(),
  revalidateCardPaths: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createCardAction, updateCardAction } from "@/lib/cards/actions";

const symbols = vi.hoisted(() => ({ rows: [] as Array<{ code: string }>, error: null as { message: string } | null }));

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && (called(calls, "insert") || called(calls, "update"))) {
      return { data: { id: CARD, slug: "kesh" }, error: null };
    }
    if (table === "custom_symbols") {
      expect(called(calls, "eq", "owner_id")).toBe(true);
      return symbols.error ? { data: null, error: symbols.error } : { data: symbols.rows, error: null };
    }
    return { data: null, error: null, count: 0 };
  });
  state.client = stub.client;
  return stub;
}

function payload(over: Record<string, unknown> = {}) {
  return {
    title: "Kesh, Emberforge Warden",
    game_system_id: GAME,
    cost: "{2}{R}{R}",
    color_identity: ["red"],
    supertype: "Legendary",
    card_type: "creature",
    power: "3",
    toughness: "4",
    art_url: "https://example.com/art.png",
    visibility: "public",
    frame_style: { template: "m15", finish: "regular" },
    ...over,
  };
}

function stored(over: Record<string, unknown> = {}) {
  return {
    id: CARD,
    owner_id: USER,
    title: "Kesh",
    slug: "kesh",
    color_identity: ["red"],
    card_type: "creature",
    supertype: "Legendary",
    subtypes: [],
    rules_text: null,
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: null,
    frame_preview: false,
    frame_style: { template: "m15", finish: "regular" },
    set_code: "DMU",
    collector_number: "107/281",
    lang: "en",
    ...over,
  };
}

beforeEach(() => {
  state.existing = null;
  // FIRE is live, OLD removed: both the owner's.
  symbols.rows = [{ code: "FIRE" }, { code: "OLD" }];
  symbols.error = null;
});

const wrote = (stub: ReturnType<typeof db>) =>
  stub.forTable("cards").some((e) => called(e.calls, "insert") || called(e.calls, "update"));
const readSymbols = (stub: ReturnType<typeof db>) => stub.forTable("custom_symbols").length > 0;

describe("createCardAction", () => {
  it("saves the owner's codes — removed ones too", async () => {
    const stub = db();
    const result = await createCardAction(payload({ cost: "{1}{*FIRE}", rules_text: "{*old}, {T}: Draw a card." }));
    expect(result.ok).toBe(true);
    expect(wrote(stub)).toBe(true);
  });

  it("refuses a code the owner has none for, on its field, before writing anything", async () => {
    for (const [over, field, codes] of [
      [{ cost: "{1}{*NOPE}" }, "cost", ["NOPE"]],
      [{ rules_text: "{*NOPE}{*ZAP}: Draw." }, "rules_text", ["NOPE", "ZAP"]],
      [{ card_type: "planeswalker", power: undefined, toughness: undefined, loyalty: "3", frame_style: { template: "m15pw", finish: "regular" }, rules_text: "+1: Draw.", face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: "Add {*NOPE}." }] } } }, "rules_text", ["NOPE"]],
    ] as const) {
      const stub = db();
      const result = await createCardAction(payload(over as Record<string, unknown>));
      expect(result, JSON.stringify(over)).toMatchObject({ ok: false, fieldErrors: { [field]: unknownSymbolsMessage(codes) } });
      expect(wrote(stub)).toBe(false);
    }
  });

  it("a card that names no code reads no symbols", async () => {
    const stub = db();
    await createCardAction(payload({ rules_text: "A star * and {T}." }));
    expect(readSymbols(stub)).toBe(false);
  });

  it("a failed read lets the save through (the blank disc is the fallback)", async () => {
    symbols.error = { message: "boom" };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stub = db();
    const result = await createCardAction(payload({ cost: "{*NOPE}" }));
    expect(result.ok).toBe(true);
    expect(wrote(stub)).toBe(true);
    errors.mockRestore();
  });
});

describe("updateCardAction", () => {
  it("refuses a code the edit ADDS", async () => {
    state.existing = stored({ rules_text: "Flying" });
    const stub = db();
    const result = await updateCardAction(CARD, { rules_text: "Flying. {*NOPE}: Draw." });
    expect(result).toMatchObject({ ok: false, fieldErrors: { rules_text: unknownSymbolsMessage(["NOPE"]) } });
    expect(wrote(stub)).toBe(false);
  });

  it("never asks about a code its stored card already named — anywhere in it (its name too)", async () => {
    for (const before of [{ rules_text: "{*GONE}: Draw." }, { title: "Kesh {*GONE}" }]) {
      state.existing = stored(before);
      const stub = db();
      const result = await updateCardAction(CARD, { rules_text: "{*GONE}: Draw a card.", rarity: "rare" });
      expect(result.ok, JSON.stringify(before)).toBe(true);
      expect(readSymbols(stub)).toBe(false);
    }
  });

  it("a back face's code, on its own field", async () => {
    state.existing = stored();
    db();
    const result = await updateCardAction(CARD, { back_face: { title: "Back", cost: "{*NOPE}" } });
    expect(result).toMatchObject({ ok: false, fieldErrors: { "back_face.cost": unknownSymbolsMessage(["NOPE"]) } });
  });
});
