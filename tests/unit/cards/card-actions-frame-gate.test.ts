import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The server-side verification gate in the card actions (TODO 0.13; tests
// TODO 0.18). A (template, colour) pair saves only when the admin has
// published it in /admin/frame-compare — the server twin of the picker's
// chips, so a stale page or a crafted payload can't get past:
//
//   * create: the gate reads the card's OWN colour the way the renderer
//     does (none → colourless, two or more → multicolour) and resolves a
//     missing template to the default frame;
//   * update: the gate runs only when the patch CHANGES the frame or the
//     colour, so a card saved on a since-withdrawn frame (the picker's
//     "legacy pin") stays editable while its frame and colour are left
//     alone — and the same colours in another order, or the same template
//     sent again by the full edit form, are not a change; a stored legacy
//     template ("regular") is judged as the default frame.
//
// Every account here is a plain user (the admin preview path has its own
// tests in card-actions-frame-preview.test.ts).
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  verified: [] as string[],
  verifiedReads: 0,
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
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
  isAdminConfigured: () => true,
}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () => {
    state.verifiedReads += 1;
    return state.verified;
  },
}));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.existing,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ premiumFrames: true, removeWatermark: true, cardCapacity: -1 }),
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
  const stub = chainClient((table): ChainAnswer =>
    table === "cards" ? { data: { id: CARD, slug: "test" }, error: null } : { error: null },
  );
  state.client = stub.client;
  return stub;
}

const cardWrites = (stub: ReturnType<typeof chainClient>) => stub.forTable("cards");
const updateOf = (stub: ReturnType<typeof chainClient>) =>
  payloadOf(stub.forTable("cards").at(-1)!.calls, "update") as Record<string, unknown>;

/** A plain creature — the kind gate has nothing to say about it. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Gatekeeper",
    game_system_id: GAME,
    card_type: "creature",
    color_identity: ["white"],
    subtypes: ["Human"],
    power: "2",
    toughness: "2",
    frame_style: { template: "m15" },
    visibility: "public",
    art_url: "https://example.com/art.png",
    ...overrides,
  };
}

/** A stored card on the Ring frame in blue — withdrawn in these tests. */
function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CARD,
    owner_id: USER,
    slug: "gatekeeper",
    title: "Gatekeeper",
    card_type: "creature",
    supertype: null,
    subtypes: ["Human"],
    rules_text: null,
    power: "2",
    toughness: "2",
    color_identity: ["blue"],
    frame_style: { template: "lotr" },
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: null,
    ...overrides,
  };
}

const refusal = (colourWord: string) => ({
  ok: false,
  fieldErrors: { frame_style: `That frame isn't available in ${colourWord} yet — pick another frame or colour.` },
});

beforeEach(() => {
  // Published: the M15 frame in white, blue and gold; the Ring frame in white.
  state.verified = ["m15/w", "m15/u", "m15/m", "lotr/w"];
  state.verifiedReads = 0;
  state.existing = null;
});

describe("createCardAction — verification gate", () => {
  it("saves a published pair", async () => {
    const stub = db();
    expect(await createCardAction(payload())).toMatchObject({ ok: true, cardId: CARD });
    expect(cardWrites(stub)).toHaveLength(1);
    expect(state.verifiedReads).toBe(1);
  });

  it("refuses an unpublished colour of a published frame, naming the colour, and writes nothing", async () => {
    const stub = db();
    expect(await createCardAction(payload({ color_identity: ["red"] }))).toEqual(refusal("red"));
    expect(cardWrites(stub)).toHaveLength(0);
  });

  it("refuses a frame published in no colour at all", async () => {
    const stub = db();
    expect(
      await createCardAction(payload({ frame_style: { template: "battle" }, color_identity: ["white"] })),
    ).toMatchObject({ ok: false, fieldErrors: { frame_style: expect.stringMatching(/isn't available in white/) } });
    expect(cardWrites(stub)).toHaveLength(0);
  });

  it("reads the colour like the renderer: two colours are the gold frame, none is colourless", async () => {
    db();
    expect(await createCardAction(payload({ color_identity: ["white", "blue"] }))).toMatchObject({ ok: true });
    state.verified = ["m15/w", "m15/u"];
    expect(await createCardAction(payload({ color_identity: ["white", "blue"] }))).toEqual(refusal("multicolor"));
    expect(await createCardAction(payload({ color_identity: [] }))).toEqual(refusal("colorless"));
  });

  it("resolves a card with no template to the default frame", async () => {
    db();
    const noTemplate = payload();
    delete (noTemplate as { frame_style?: unknown }).frame_style;
    expect(await createCardAction(noTemplate)).toMatchObject({ ok: true });

    state.verified = ["lotr/w"];
    expect(await createCardAction(noTemplate)).toEqual(refusal("white"));
  });
});

describe("updateCardAction — verification gate", () => {
  beforeEach(() => {
    state.existing = storedRow();
  });

  it("keeps a card on a withdrawn frame editable while its frame and colour are left alone", async () => {
    const stub = db();
    expect(await updateCardAction(CARD, { title: "Renamed" })).toMatchObject({ ok: true });
    expect(updateOf(stub).title).toBe("Renamed");
    // Nothing to check: the gate isn't consulted at all.
    expect(state.verifiedReads).toBe(0);
  });

  it("treats the same template sent again, or the same colours in another order, as no change", async () => {
    const stub = db();
    expect(
      await updateCardAction(CARD, { title: "Resaved", frame_style: { template: "lotr" }, color_identity: ["blue"] }),
    ).toMatchObject({ ok: true });

    state.existing = storedRow({ color_identity: ["blue", "red"] });
    expect(await updateCardAction(CARD, { color_identity: ["red", "blue"] })).toMatchObject({ ok: true });
    expect(cardWrites(stub)).toHaveLength(2);
    expect(state.verifiedReads).toBe(0);
  });

  it("refuses a colour change onto an unpublished colour of the card's frame", async () => {
    const stub = db();
    expect(await updateCardAction(CARD, { color_identity: ["green"] })).toEqual(refusal("green"));
    expect(cardWrites(stub)).toHaveLength(0);
  });

  it("refuses a frame change onto an unpublished pair, judged in the card's stored colour", async () => {
    const stub = db();
    // The stored colour is blue; the Ring frame is only published in white.
    state.existing = storedRow({ frame_style: { template: "m15" } });
    expect(await updateCardAction(CARD, { frame_style: { template: "lotr" } })).toEqual(refusal("blue"));
    expect(cardWrites(stub)).toHaveLength(0);
  });

  it("judges a stored legacy template as the default frame when the colour changes", async () => {
    const stub = db();
    // "regular" predates the picker; the renderers draw it as M15.
    state.existing = storedRow({ frame_style: { template: "regular" }, color_identity: ["white"] });
    expect(await updateCardAction(CARD, { color_identity: ["blue"] })).toMatchObject({ ok: true });
    expect(await updateCardAction(CARD, { color_identity: ["red"] })).toEqual(refusal("red"));
    expect(cardWrites(stub)).toHaveLength(1);
  });

  it("lets a card move OFF a withdrawn pair onto a published one", async () => {
    const stub = db();
    expect(await updateCardAction(CARD, { color_identity: ["white"] })).toMatchObject({ ok: true });
    expect(await updateCardAction(CARD, { frame_style: { template: "m15" } })).toMatchObject({ ok: true });
    expect(cardWrites(stub)).toHaveLength(2);
  });
});
