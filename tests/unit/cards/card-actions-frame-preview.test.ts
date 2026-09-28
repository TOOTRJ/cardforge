import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chainClient,
  payloadOf,
  type ChainAnswer,
} from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// Admin frame previews in the card actions (TODO 2.3). A save that asks for
// `frame_preview` skips the verification gate ONLY for an admin (read from
// the profile, never the payload) and then lands private + flagged, never in
// a deck and never counted as product activity. Anyone else's request is
// ignored — the gate refuses as usual. An ordinary save never names the
// column (so it can't depend on migration 0121). A flagged card stays
// private on every edit; an admin's edit that moves a card onto an
// unverified frame makes it a preview.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";
const DECK = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({
  profile: null as null | { id: string; is_admin: boolean },
  verified: [] as string[],
  existing: null as unknown,
  client: null as unknown,
  deckAdds: 0,
  activity: 0,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => state.profile,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
  isAdminConfigured: () => true,
}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () => state.verified,
}));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.existing,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({
    premiumFrames: true,
    removeWatermark: true,
    cardCapacity: -1,
  }),
}));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn() }));
vi.mock("@/lib/decks/membership", () => ({
  addCustomCardEntryToDeck: async () => {
    state.deckAdds += 1;
  },
}));
vi.mock("@/lib/analytics/funnel-server", () => ({
  recordActivity: async () => {
    state.activity += 1;
  },
}));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCard: vi.fn(),
  purgeHiddenCards: vi.fn(),
  revalidateCardListSurfaces: vi.fn(),
  revalidateCardPaths: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import {
  createCardAction,
  updateCardAction,
  updateCardsVisibilityAction,
} from "@/lib/cards/actions";

function db() {
  const stub = chainClient((table): ChainAnswer =>
    table === "cards" ? { data: { id: CARD, slug: "test" }, error: null } : { error: null },
  );
  state.client = stub.client;
  return stub;
}

const insertOf = (stub: ReturnType<typeof chainClient>) =>
  payloadOf(stub.forTable("cards").at(-1)!.calls, "insert") as Record<string, unknown>;
const updateOf = (stub: ReturnType<typeof chainClient>) =>
  payloadOf(stub.forTable("cards").at(-1)!.calls, "update") as Record<string, unknown>;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Walked Battle",
    game_system_id: GAME,
    card_type: "battle",
    color_identity: ["white"],
    subtypes: ["Siege"],
    defense: "5",
    // Unverified in every test below: only m15/w is published.
    frame_style: { template: "battle" },
    visibility: "public",
    art_url: "https://example.com/art.png",
    ...overrides,
  };
}

beforeEach(() => {
  state.profile = { id: USER, is_admin: true };
  state.verified = ["m15/w"];
  state.existing = null;
  state.deckAdds = 0;
  state.activity = 0;
});

describe("createCardAction — frame previews", () => {
  it("an admin's preview skips the gate and lands private + flagged, outside decks and the funnel", async () => {
    const stub = db();
    const result = await createCardAction(payload({ frame_preview: true, deck_id: DECK }));
    expect(result).toMatchObject({ ok: true, cardId: CARD });
    const insert = insertOf(stub);
    expect(insert.visibility).toBe("private");
    expect(insert.frame_preview).toBe(true);
    expect(state.deckAdds).toBe(0);
    expect(state.activity).toBe(0);
  });

  it("a non-admin's request is ignored: the verification gate refuses", async () => {
    state.profile = { id: USER, is_admin: false };
    const stub = db();
    const result = await createCardAction(payload({ frame_preview: true }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { frame_style: expect.stringMatching(/isn't available/) } });
    expect(stub.forTable("cards")).toHaveLength(0);
  });

  it("an admin without the request gets the gate like everyone", async () => {
    const stub = db();
    const result = await createCardAction(payload());
    expect(result).toMatchObject({ ok: false, fieldErrors: { frame_style: expect.any(String) } });
    expect(stub.forTable("cards")).toHaveLength(0);
  });

  it("the kind gate still applies to a preview", async () => {
    db();
    const result = await createCardAction(
      payload({ frame_preview: true, card_type: "planeswalker", subtypes: [], frame_style: { template: "fullart" } }),
    );
    expect(result).toMatchObject({ ok: false, fieldErrors: { frame_style: expect.stringMatching(/doesn't dress Planeswalker/) } });
  });

  it("an ordinary save never names the column", async () => {
    const stub = db();
    const result = await createCardAction(
      payload({ card_type: "creature", subtypes: [], defense: undefined, frame_style: { template: "m15" } }),
    );
    expect(result).toMatchObject({ ok: true });
    const insert = insertOf(stub);
    expect("frame_preview" in insert).toBe(false);
    expect(insert.visibility).toBe("public");
    expect(state.activity).toBe(1);
  });
});

describe("updateCardAction — frame previews", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: CARD,
    owner_id: USER,
    slug: "walked",
    title: "Walked",
    card_type: "creature",
    supertype: null,
    subtypes: [],
    rules_text: null,
    color_identity: ["white"],
    frame_style: { template: "m15" },
    visibility: "private",
    art_url: "https://example.com/art.png",
    back_face: null,
    ...overrides,
  });

  it("a flagged card stays private whatever the patch says", async () => {
    state.existing = row({ frame_preview: true, frame_style: { template: "battle" }, card_type: "battle" });
    const stub = db();
    const result = await updateCardAction(CARD, { visibility: "public", title: "Walked again" });
    expect(result).toMatchObject({ ok: true });
    const update = updateOf(stub);
    expect(update.visibility).toBe("private");
    expect("frame_preview" in update).toBe(false);
  });

  it("an admin's preview-mode move onto an unverified frame flags the card", async () => {
    state.existing = row({ visibility: "public" });
    const stub = db();
    const result = await updateCardAction(CARD, {
      frame_style: { template: "m15snow" },
      frame_preview: true,
    });
    expect(result).toMatchObject({ ok: true });
    const update = updateOf(stub);
    expect(update.frame_preview).toBe(true);
    expect(update.visibility).toBe("private");
  });

  it("a non-admin's move onto an unverified frame is refused even when it asks", async () => {
    state.profile = { id: USER, is_admin: false };
    state.existing = row();
    const stub = db();
    const result = await updateCardAction(CARD, {
      frame_style: { template: "m15snow" },
      frame_preview: true,
    });
    expect(result).toMatchObject({ ok: false, fieldErrors: { frame_style: expect.any(String) } });
    expect(stub.forTable("cards")).toHaveLength(0);
  });

  it("an ordinary edit of an ordinary card never names the column", async () => {
    state.existing = row({ visibility: "public" });
    const stub = db();
    await updateCardAction(CARD, { title: "Renamed", visibility: "public" });
    const update = updateOf(stub);
    expect("frame_preview" in update).toBe(false);
    expect(update.visibility).toBe("public");
  });
});

describe("updateCardsVisibilityAction — a preview in the batch", () => {
  const owned = [{ id: CARD, owner_id: USER, title: "Walked", back_face: null, rendered_image_url: null }];

  it("names the reason when 0121's CHECK refuses the batch (nothing changed)", async () => {
    state.client = chainClient((table, calls): ChainAnswer =>
      calls.some((c) => c.method === "update")
        ? {
            error: {
              code: "23514",
              message: 'new row for relation "cards" violates check constraint "cards_frame_preview_private"',
            },
          }
        : { data: owned, error: null },
    ).client;
    const result = await updateCardsVisibilityAction([CARD], "public");
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/^Frame previews stay private .*Nothing was changed\.$/),
    });
  });

  it("any other database error still reads as itself", async () => {
    state.client = chainClient((table, calls): ChainAnswer =>
      calls.some((c) => c.method === "update")
        ? { error: { code: "42501", message: "permission denied for table cards" } }
        : { data: owned, error: null },
    ).client;
    expect(await updateCardsVisibilityAction([CARD], "public")).toEqual({
      ok: false,
      error: "permission denied for table cards",
    });
  });
});
