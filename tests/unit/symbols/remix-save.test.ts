import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// New pips PR 5, the save's side: createCardAction copies a remix's symbols
// (adoptRemixSymbols) BEFORE its symbol check, says what it did, and takes
// the copies back on every path where the card itself is not saved.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const THEM = "99999999-9999-4999-8999-999999999999";
const PARENT = "55555555-5555-4555-8555-555555555555";
const NOTICE = { copied: ["FIRE"], copiedRemoved: [], keptYours: [] };

const state = vi.hoisted(() => ({
  parent: null as unknown,
  client: null as unknown,
  undo: vi.fn(async () => undefined),
  adopt: null as unknown,
  unknown: null as null | { field: string; message: string },
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}), isAdminConfigured: () => false }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => ["m15/w"] }));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.parent,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ premiumFrames: true, removeWatermark: true, cardCapacity: -1 }),
}));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn() }));
vi.mock("@/lib/decks/membership", () => ({ addCustomCardEntryToDeck: async () => undefined }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: async () => undefined }));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCard: vi.fn(),
  purgeHiddenCards: vi.fn(),
  revalidateCardListSurfaces: vi.fn(),
  revalidateCardPages: vi.fn(),
  revalidateCardPaths: vi.fn(),
}));
vi.mock("@/lib/cards/remix-media", () => ({
  adoptRemixMedia: vi.fn(async (_user: string, _parent: unknown, media: object) => ({ ok: true, ...media })),
}));
vi.mock("@/lib/symbols/remix-copy", () => ({ adoptRemixSymbols: vi.fn(async () => state.adopt) }));
vi.mock("@/lib/symbols/card-check", () => ({ unknownSymbolFieldError: vi.fn(async () => state.unknown) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { adoptRemixSymbols } from "@/lib/symbols/remix-copy";
import { unknownSymbolFieldError } from "@/lib/symbols/card-check";
import { createCardAction } from "@/lib/cards/actions";

const parentRow = (owner = THEM) => ({
  id: PARENT,
  owner_id: owner,
  slug: "pyre",
  title: "Pyre",
  cost: "{1}{*FIRE}",
  card_type: "creature",
  rules_text: "Flying",
  color_identity: ["white"],
  frame_style: { template: "m15" },
  visibility: "public",
  art_url: "https://example.com/art.png",
  back_face: null,
  moderation_hidden_at: null,
});

const remixPayload = () => ({
  title: "Pyre, Again",
  game_system_id: "33333333-3333-4333-8333-333333333333",
  card_type: "creature",
  color_identity: ["white"],
  subtypes: ["Elemental"],
  cost: "{1}{*FIRE}",
  power: "2",
  toughness: "2",
  rules_text: "Flying",
  frame_style: { template: "m15" },
  visibility: "private",
  art_url: "https://example.com/art.png",
  parent_card_id: PARENT,
});

function db(answer: ChainAnswer = { data: { id: "new-card", slug: "pyre-again" }, error: null }) {
  const stub = chainClient((table): ChainAnswer => (table === "cards" ? answer : { error: null }));
  state.client = stub.client;
  return stub;
}
const inserted = (stub: ReturnType<typeof chainClient>) => stub.forTable("cards").filter((e) => called(e.calls, "insert"));

beforeEach(() => {
  state.parent = parentRow();
  state.undo.mockClear();
  state.adopt = { ok: true, notice: NOTICE, undo: state.undo };
  state.unknown = null;
  vi.mocked(adoptRemixSymbols).mockClear();
  vi.mocked(unknownSymbolFieldError).mockClear();
});

describe("createCardAction — a remix's symbols", () => {
  it("copies them before the symbol check, keeps them on a saved card and says so", async () => {
    const stub = db();
    const result = await createCardAction(remixPayload());
    expect(result).toMatchObject({ ok: true, remixSymbols: NOTICE });
    expect(vi.mocked(adoptRemixSymbols)).toHaveBeenCalledWith(USER, expect.objectContaining({ id: PARENT }), expect.objectContaining({ owner_id: USER, cost: "{1}{*FIRE}" }));
    expect(vi.mocked(adoptRemixSymbols).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(unknownSymbolFieldError).mock.invocationCallOrder[0],
    );
    expect(inserted(stub)).toHaveLength(1);
    expect(state.undo).not.toHaveBeenCalled();
  });

  it("says nothing when there was nothing to say", async () => {
    state.adopt = { ok: true, notice: null, undo: state.undo };
    db();
    const result = await createCardAction(remixPayload());
    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("remixSymbols");
  });

  it("copies nothing for a remix of your own card", async () => {
    state.parent = parentRow(USER);
    db();
    expect((await createCardAction(remixPayload())).ok).toBe(true);
    expect(vi.mocked(adoptRemixSymbols)).not.toHaveBeenCalled();
  });

  it("a refused copy refuses the save before anything is written", async () => {
    state.adopt = { ok: false, error: "Couldn't copy the original card's mana symbols — try again." };
    const stub = db();
    expect(await createCardAction(remixPayload())).toEqual({
      ok: false,
      formError: "Couldn't copy the original card's mana symbols — try again.",
      code: undefined,
    });
    expect(inserted(stub)).toHaveLength(0);
  });

  it("takes the copies back when the symbol check still refuses", async () => {
    state.unknown = { field: "cost", message: "{*NOPE} isn't one of your mana symbols." };
    const stub = db();
    expect(await createCardAction(remixPayload())).toEqual({ ok: false, fieldErrors: { cost: "{*NOPE} isn't one of your mana symbols." } });
    expect(state.undo).toHaveBeenCalledTimes(1);
    expect(inserted(stub)).toHaveLength(0);
  });

  it("takes the copies back when the capacity trigger refuses the card", async () => {
    db({ data: null, error: { message: "card_capacity_exceeded" } });
    expect(await createCardAction(remixPayload())).toMatchObject({ ok: false, code: "UPGRADE_REQUIRED" });
    expect(state.undo).toHaveBeenCalledTimes(1);
  });

  it("takes the copies back when the insert fails", async () => {
    db({ data: null, error: { message: "boom" } });
    expect(await createCardAction(remixPayload())).toEqual({ ok: false, formError: "boom" });
    expect(state.undo).toHaveBeenCalledTimes(1);
  });
});
