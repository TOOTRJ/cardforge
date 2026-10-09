import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// An edit stops pointing at the stored bake IN ITS OWN WRITE (owner report
// 2026-10-08: "on edit the user can correctly adjust the image, but after
// saving, the Gallery does not display the updated image position").
//
// The stored bake shows the card as it was. The re-bake runs after the
// response (next/server `after`), a few seconds; until it had persisted its
// own URL the row kept pointing at the old picture, so every page built in
// that window — the ISR'd /gallery, the payload the owner's browser
// prefetches for the header's Gallery link right after the save — drew the
// previous art position, and kept it for the page's whole ISR window: the
// revalidation after the bake is skipped by Next (an after() callback's
// revalidations run only for paths the request has not already revalidated,
// and the action has just revalidated all of them). Measured on a production
// build of main: the row's thumb moved to the new `?v=` 4 s after the save,
// /gallery served the old one a minute later, through a hard reload.
//
// So: the save's ONE update carries REBAKE_PENDING_RENDER — every pointer
// and the stamp cleared (an API role may clear them, 0126), the state the
// sweep reads as "owes a bake" — and tiles draw the live preview of the
// saved row until the bake lands.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  existing: null as unknown,
  client: null as unknown,
  /** What happened, in order: the row write, then the deferred bake. */
  order: [] as string[],
  deferred: [] as Array<() => Promise<void> | void>,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminConfigured: () => false }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => [] }));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.existing,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ premiumFrames: true, removeWatermark: false, cardCapacity: -1 }),
}));
vi.mock("@/lib/cards/bake-render", () => ({
  bakeAndPersistCardRender: vi.fn(async () => {
    state.order.push("bake");
    return null;
  }),
}));
vi.mock("@/lib/decks/membership", () => ({ addCustomCardEntryToDeck: vi.fn() }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCard: vi.fn(),
  purgeHiddenCards: vi.fn(),
  revalidateCardListSurfaces: vi.fn(),
  revalidateCardPaths: vi.fn(() => void state.order.push("revalidate")),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void> | void) => void state.deferred.push(fn) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { updateCardAction } from "@/lib/cards/actions";
import { CLEARED_RENDER_POINTERS, REBAKE_PENDING_RENDER } from "@/lib/cards/bake-core";

const BAKE = `https://storage.test/storage/v1/object/public/card-renders/${USER}/${CARD}`;

function stored(over: Record<string, unknown> = {}) {
  return {
    id: CARD,
    owner_id: USER,
    title: "The Long Night",
    slug: "the-long-night",
    cost: null,
    color_identity: [],
    card_type: "enchantment",
    rarity: "common",
    supertype: null,
    subtypes: [],
    tags: [],
    rules_text: null,
    flavor_text: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artist_credit: "A. Painter",
    art_url: "https://example.com/art.png",
    art_position: { focalX: 0.2, focalY: 0.5, scale: 1 },
    visibility: "public",
    back_face: null,
    back_card_id: null,
    frame_preview: false,
    frame_style: { template: "saga", finish: "regular" },
    rendered_image_url: `${BAKE}.png?v=1`,
    rendered_thumb_url: `${BAKE}.thumb.webp?v=1`,
    rendered_back_image_url: null,
    rendered_back_thumb_url: null,
    rendered_at: "2026-10-09T00:58:57.000Z",
    layout_version: 49,
    ...over,
  };
}

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && called(calls, "update")) {
      state.order.push("update");
      return { data: { id: CARD, slug: "the-long-night" }, error: null };
    }
    return { data: null, error: null, count: 0 };
  });
  state.client = stub.client;
  return stub;
}

const updatesOf = (stub: ReturnType<typeof db>) =>
  stub
    .forTable("cards")
    .filter((e) => called(e.calls, "update"))
    .map((e) => payloadOf(e.calls, "update") as Record<string, unknown>);

beforeEach(() => {
  state.existing = stored();
  state.order.length = 0;
  state.deferred.length = 0;
});

describe("REBAKE_PENDING_RENDER", () => {
  it("is every render pointer and the stamp, cleared — the state the sweep reads as owing a bake", () => {
    expect(REBAKE_PENDING_RENDER).toEqual({
      rendered_image_url: null,
      rendered_thumb_url: null,
      rendered_back_image_url: null,
      rendered_back_thumb_url: null,
      rendered_at: null,
      layout_version: null,
    });
    expect(REBAKE_PENDING_RENDER).toMatchObject(CLEARED_RENDER_POINTERS);
  });
});

describe("updateCardAction — an edit never leaves the row pointing at the bake of the card as it was", () => {
  it("moving the art (art_position alone): the new position and the cleared pointers are ONE write", async () => {
    const stub = db();
    const moved = { focalX: 1, focalY: 0.5, scale: 1 };
    const result = await updateCardAction(CARD, { art_position: moved });
    expect(result.ok).toBe(true);
    // One update of the row — not a save and then a clear: nothing can be
    // built from a row that has the new art position AND the old picture.
    expect(updatesOf(stub)).toEqual([{ art_position: moved, ...REBAKE_PENDING_RENDER }]);
  });

  it("the write comes before the response's revalidation, and the bake only after the response", async () => {
    db();
    await updateCardAction(CARD, { art_position: { focalX: 1, focalY: 0.5, scale: 1.3 } });
    // Pages rebuilt by the action's own revalidation read the cleared row.
    expect(state.order).toEqual(["update", "revalidate"]);
    expect(state.deferred).toHaveLength(1);
    await state.deferred[0]();
    expect(state.order).toEqual(["update", "revalidate", "bake", "revalidate"]);
  });

  it("any other edit does the same — the bake shows the old text as much as the old art", async () => {
    const stub = db();
    const result = await updateCardAction(CARD, { artist_credit: "B. Painter" });
    expect(result.ok).toBe(true);
    expect(updatesOf(stub)).toEqual([{ artist_credit: "B. Painter", ...REBAKE_PENDING_RENDER }]);
  });

  it("a card with no bake (a private draft) writes the same nulls: nothing to lose", async () => {
    state.existing = stored({
      visibility: "private",
      rendered_image_url: null,
      rendered_thumb_url: null,
      rendered_at: null,
      layout_version: null,
    });
    const stub = db();
    await updateCardAction(CARD, { art_position: { focalX: 0, focalY: 0, scale: 2 } });
    expect(updatesOf(stub)[0]).toMatchObject(REBAKE_PENDING_RENDER);
  });
});
