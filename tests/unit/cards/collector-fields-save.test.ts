import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 4.9a — the collector fields through the card ACTIONS (skeptic
// 2026-09-30: the builder's write path, held to its claims):
//   • createCardAction writes set_code (upper-cased before the CHECK),
//     collector_number and lang; a payload naming no language sends no
//     `lang` at all, so the column's default (English) applies;
//   • updateCardAction writes exactly what the edit names — null clears a
//     code or number, an omitted lang leaves the column alone, an ordinary
//     edit sends none of the three;
//   • a crafted value the CHECKs would refuse (a 7-letter code, a number
//     with a space, an unknown or null language) is refused by zod with a
//     field error and NO write reaches the database.
// Harness: tests/unit/cards/anatomy-save.test.ts.
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
  getVerifiedFrameKeys: async () => ["m15/r", "m15/m", "m15/b"],
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

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && (called(calls, "insert") || called(calls, "update"))) {
      return { data: { id: CARD, slug: "kesh" }, error: null };
    }
    return { data: null, error: null, count: 0 };
  });
  state.client = stub.client;
  return stub;
}

const written = (stub: ReturnType<typeof db>, op: "insert" | "update") => {
  const entry = stub.forTable("cards").find((e) => called(e.calls, op));
  return payloadOf(entry?.calls ?? [], op) as Record<string, unknown> | undefined;
};

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
});

describe("createCardAction — the collector fields", () => {
  it("writes the three as the import or the step sends them, the set code upper-cased", async () => {
    const stub = db();
    const result = await createCardAction(payload({ set_code: "dmu", collector_number: "107/281", lang: "es" }));
    expect(result.ok).toBe(true);
    expect(written(stub, "insert")).toMatchObject({ set_code: "DMU", collector_number: "107/281", lang: "es" });
  });

  it("a payload naming none (an AI job, an old client) inserts null codes and NO lang — the column's default applies", async () => {
    const stub = db();
    await createCardAction(payload());
    const insert = written(stub, "insert");
    expect(insert).toMatchObject({ set_code: null, collector_number: null });
    expect(insert).not.toHaveProperty("lang");
  });

  it("refuses a code the CHECK would refuse, with a field error and no insert", async () => {
    const stub = db();
    const result = await createCardAction(payload({ set_code: "toolongcode" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.set_code).toMatch(/2–6 letters or digits/);
    expect(written(stub, "insert")).toBeUndefined();
  });
});

describe("updateCardAction — the collector fields are revisable content", () => {
  it("writes what the edit names: null clears, a value replaces, an omitted lang is untouched", async () => {
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, { set_code: null, collector_number: "108/281" });
    expect(result.ok).toBe(true);
    const update = written(stub, "update");
    expect(update).toMatchObject({ set_code: null, collector_number: "108/281" });
    expect(update).not.toHaveProperty("lang");
  });

  it("a language alone, and a lower-case code, store as the column wants them", async () => {
    state.existing = stored();
    const stub = db();
    await updateCardAction(CARD, { lang: "he", set_code: " fdn " });
    expect(written(stub, "update")).toMatchObject({ lang: "he", set_code: "FDN" });
    expect(written(stub, "update")).not.toHaveProperty("collector_number");
  });

  it("an ordinary edit sends none of the three", async () => {
    state.existing = stored();
    const stub = db();
    await updateCardAction(CARD, { title: "Kesh the Second" });
    const update = written(stub, "update");
    expect(update).toBeDefined();
    for (const key of ["set_code", "collector_number", "lang"]) expect(update).not.toHaveProperty(key);
  });

  it.each([
    [{ set_code: "toolongcode" }, "set_code"],
    [{ set_code: "" }, "set_code"],
    [{ collector_number: "107/281 M" }, "collector_number"],
    [{ collector_number: "1".repeat(13) }, "collector_number"],
    [{ lang: "xx" }, "lang"],
    [{ lang: "EN" }, "lang"],
    [{ lang: null }, "lang"],
  ] as const)("refuses a crafted %j with a field error on %s and writes nothing", async (crafted, field) => {
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, { title: "Kesh", ...crafted });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.[field]).toBeTruthy();
    expect(written(stub, "update")).toBeUndefined();
  });
});
