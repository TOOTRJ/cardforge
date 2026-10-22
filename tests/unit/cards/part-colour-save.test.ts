import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 4.26 through updateCardAction (N2): an edit that flips each part in
// its own colour changes the master the first half paints — Fire // Ice
// (stored "multicolor", its first half red on frame_style.firstPartColor)
// paints red with the look on and the gold with it off — so the flip is
// gated in the colour it will DRAW, as a frame change is:
//   • on, with the first part's colour (red) not verified → refused;
//   • off, with the card's whole colour (gold) not verified → refused;
//   • either, where that colour is verified → saved;
//   • a flip that draws the same masters (no first part of its own) is
//     not gated: a card pinned on a withdrawn frame stays editable.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  verified: [] as string[],
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
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => state.verified }));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.existing,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ premiumFrames: true, removeWatermark: false, cardCapacity: -1 }),
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

import { updateCardAction } from "@/lib/cards/actions";

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && (called(calls, "insert") || called(calls, "update"))) {
      return { data: { id: CARD, slug: "fire" }, error: null };
    }
    return { data: null, error: null, count: 0 };
  });
  state.client = stub.client;
  return stub;
}

const styleWritten = (stub: ReturnType<typeof db>) => {
  const entry = stub.forTable("cards").find((e) => called(e.calls, "update"));
  return (payloadOf(entry?.calls ?? [], "update") as Record<string, unknown> | undefined)?.frame_style as Record<string, unknown> | undefined;
};

function fireIce(frameStyle: Record<string, unknown>) {
  return {
    id: CARD,
    owner_id: USER,
    title: "Fire",
    slug: "fire",
    game_system_id: GAME,
    cost: "{1}{R}",
    color_identity: ["multicolor"],
    card_type: "instant",
    rarity: "uncommon",
    supertype: null,
    subtypes: [],
    tags: [],
    rules_text: "Fire deals 2 damage divided as you choose among one or two targets.",
    flavor_text: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artist_credit: "A. Painter",
    art_position: {},
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: { title: "Ice", cost: "{1}{U}", card_type: "instant", rules_text: "Tap target permanent.", color_identity: ["blue"], art_url: "https://example.com/art2.png" },
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content: null,
    watermark: null,
    footer_text: null,
    set_code: null,
    collector_number: null,
    lang: "en",
    frame_preview: false,
    frame_style: { template: "split", finish: "regular", ...frameStyle },
  };
}

beforeEach(() => {
  state.existing = null;
});

describe("an edit flipping each part in its own colour is gated in the colour it draws (N2)", () => {
  it("ON: refused while the first part's colour (red) isn't verified; saved once it is", async () => {
    state.existing = fireIce({ partColor: false, firstPartColor: ["red"] });
    state.verified = ["split/m", "split/u"];
    db();
    const refused = await updateCardAction(CARD, { frame_anatomy: { partColor: true } });
    expect(refused.ok).toBe(false);
    expect((refused as { fieldErrors?: Record<string, string> }).fieldErrors?.frame_style).toMatch(/red/);
    state.verified = ["split/m", "split/u", "split/r"];
    const stub = db();
    expect((await updateCardAction(CARD, { frame_anatomy: { partColor: true } })).ok).toBe(true);
    expect(styleWritten(stub)).toMatchObject({ template: "split", partColor: true, firstPartColor: ["red"] });
  });

  it("OFF: refused while the card's whole colour (the gold) isn't verified; saved once it is", async () => {
    state.existing = fireIce({ partColor: true, firstPartColor: ["red"] });
    state.verified = ["split/r", "split/u"];
    db();
    const refused = await updateCardAction(CARD, { frame_anatomy: { partColor: false } });
    expect(refused.ok).toBe(false);
    expect((refused as { fieldErrors?: Record<string, string> }).fieldErrors?.frame_style).toMatch(/multicolor/);
    state.verified = ["split/r", "split/u", "split/m"];
    const stub = db();
    expect((await updateCardAction(CARD, { frame_anatomy: { partColor: false } })).ok).toBe(true);
    expect(styleWritten(stub)).toMatchObject({ template: "split", partColor: false });
  });

  it("a flip that draws the same first-half master isn't gated (a card on a withdrawn frame stays editable)", async () => {
    // No first part of its own: the first half paints the card's red either way.
    state.existing = { ...fireIce({ partColor: true }), color_identity: ["red"] };
    state.verified = [];
    db();
    expect((await updateCardAction(CARD, { frame_anatomy: { partColor: false } })).ok).toBe(true);
  });
});
