import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// card-renders after migration 0126: the owner holds no write policy there any
// more (before it, anyone could upsert their own picture over their card's
// watermarked bake — the gallery tile, OG image and free download). The save
// bake and the delete / go-private clean-ups write with the SERVICE ROLE,
// only at `{verified owner}/{card}.png` + its `.thumb.webp`, and never through
// the user's cookie client (whose `.storage` throws here).
//
// The row's POINTER to the bake moved too: 0126's cards_guard_render_columns
// lets an API role only clear rendered_image_url / rendered_thumb_url /
// rendered_at / layout_version (an owner used to be able to PATCH them at any
// picture), so a new URL is persisted with the service role, pinned to the
// verified owner — while a clear still works on the owner's own client, even
// without the service-role key.
//
// Since migration 0134 (TODO 5.0a) a card has FOUR render names — the back
// face's `.back.png` / `.back.thumb.webp` beside the front's — and two more
// pointers (rendered_back_image_url / rendered_back_thumb_url): every
// remove takes all four names (a missing object is not an error), and every
// clear takes every pointer, so a back bake (5.3) can never outlive its
// card's front. The front bake still writes its own pair only.
// ---------------------------------------------------------------------------

const RENDER_NAMES = (id: string) => [`${USER}/${id}.png`, `${USER}/${id}.thumb.webp`, `${USER}/${id}.back.png`, `${USER}/${id}.back.thumb.webp`];
const CLEARED = {
  rendered_image_url: null,
  rendered_thumb_url: null,
  rendered_back_image_url: null,
  rendered_back_thumb_url: null,
  rendered_at: null,
  layout_version: null,
};

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const CARD = "22222222-2222-4222-8222-222222222222";
const CARD_2 = "33333333-3333-4333-8333-333333333333";

type Op = { bucket: string; op: "upload" | "remove"; keys: string[] };
type RowWrite = { via: "user" | "admin"; payload: unknown; filters: [string, unknown][] };

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  adminConfigured: true,
  ops: [] as Op[],
  adminClients: 0,
  card: null as Record<string, unknown> | null,
  rows: [] as { id: string; owner_id: string }[],
  updates: [] as unknown[],
  writes: [] as RowWrite[],
  png: null as Buffer | null,
}));

function recordWrite(via: RowWrite["via"], calls: { method: string; args: unknown[] }[]) {
  const payload = calls.find((c) => c.method === "update")!.args[0];
  state.writes.push({
    via,
    payload,
    filters: calls.filter((c) => c.method === "eq").map((c) => [c.args[0] as string, c.args[1]]),
  });
  if (via === "user") state.updates.push(payload);
}

function cookieClient() {
  const db = chainClient((table, calls): ChainAnswer => {
    if (called(calls, "update")) {
      recordWrite("user", calls);
      return { data: [{ id: CARD }], error: null };
    }
    if (called(calls, "delete")) return { error: null };
    if (table === "cards" && called(calls, "maybeSingle")) return { data: state.card };
    if (table === "cards") return { data: state.rows };
    return { data: null };
  });
  const client = { from: db.client.from, rpc: db.client.rpc };
  Object.defineProperty(client, "storage", {
    get() {
      throw new Error("the user's cookie client must never touch storage (migration 0126)");
    },
  });
  return client;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cookieClient(),
  getCurrentUser: async () => state.user,
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => state.adminConfigured,
  createAdminClient: () => {
    state.adminClients += 1;
    const db = chainClient((_table, calls): ChainAnswer => {
      if (called(calls, "update")) {
        recordWrite("admin", calls);
        return { data: [{ id: CARD }], error: null };
      }
      return { data: null };
    });
    return {
      from: db.client.from,
      storage: {
        from: (bucket: string) => ({
          upload: async (key: string) => {
            state.ops.push({ bucket, op: "upload", keys: [key] });
            return { data: null, error: null };
          },
          remove: async (keys: string[]) => {
            state.ops.push({ bucket, op: "remove", keys });
            return { data: [], error: null };
          },
          getPublicUrl: (key: string) => ({ data: { publicUrl: `https://storage.test/${bucket}/${key}` } }),
        }),
      },
    };
  },
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/render/card-image", () => ({
  renderCardImage: async () => new Response(new Uint8Array(state.png!)),
}));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => false }));
vi.mock("@/lib/pips/queries", () => ({ getPipOverrides: async () => null }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: async () => ({}) }));
// lib/cards/actions.ts imports the whole card-save world; the delete paths
// need none of it.
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => [] }));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => (state.card ? { ...state.card, slug: "a-card" } : null),
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({ getEntitlements: async () => ({}) }));
vi.mock("@/lib/decks/membership", () => ({ addCustomCardEntryToDeck: vi.fn() }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCard: vi.fn(),
  purgeHiddenCards: vi.fn(),
  revalidateCardListSurfaces: vi.fn(),
  revalidateCardPaths: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { bakeAndPersistCardRender } from "@/lib/cards/bake-render";
import { deleteCardAction, deleteCardsAction } from "@/lib/cards/actions";

function cardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CARD,
    owner_id: USER,
    visibility: "public",
    updated_at: "2026-09-29T00:00:00.000Z",
    title: "Storage Test",
    cost: null,
    card_type: "creature",
    supertype: null,
    subtypes: [],
    rarity: "common",
    color_identity: [],
    rules_text: null,
    flavor_text: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artist_credit: null,
    art_url: null,
    art_position: null,
    frame_style: null,
    set_icon_url: null,
    set_icon_code: null,
    back_face: null,
    face_content: null,
    watermark: null,
    ...overrides,
  };
}

beforeEach(async () => {
  state.user = { id: USER };
  state.adminConfigured = true;
  state.ops.length = 0;
  state.adminClients = 0;
  state.card = cardRow();
  state.rows = [];
  state.updates.length = 0;
  state.writes.length = 0;
  state.png ??= await sharp({ create: { width: 30, height: 42, channels: 4, background: "#345" } }).png().toBuffer();
});

describe("the save-time bake writes card-renders with the service role", () => {
  it("a public card: the PNG and its thumb land at {owner}/{card}, and the row gets their URLs", async () => {
    const url = await bakeAndPersistCardRender(CARD, USER);
    expect(state.ops).toEqual([
      { bucket: "card-renders", op: "upload", keys: [`${USER}/${CARD}.png`] },
      { bucket: "card-renders", op: "upload", keys: [`${USER}/${CARD}.thumb.webp`] },
    ]);
    expect(url).toMatch(new RegExp(`^https://storage\\.test/card-renders/${USER}/${CARD}\\.png\\?v=\\d+$`));
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].payload).toMatchObject({ rendered_image_url: url });
  });

  it("the new URL is persisted by the SERVICE ROLE, pinned to the card, its verified owner and the row it rendered", async () => {
    const url = await bakeAndPersistCardRender(CARD, USER);
    expect(state.writes).toEqual([
      {
        via: "admin",
        payload: expect.objectContaining({
          rendered_image_url: url,
          rendered_thumb_url: expect.stringMatching(new RegExp(`/card-renders/${USER}/${CARD}\\.thumb\\.webp\\?v=`)),
          layout_version: expect.any(Number),
        }),
        filters: [
          ["id", CARD],
          ["owner_id", USER],
          ["updated_at", "2026-09-29T00:00:00.000Z"],
        ],
      },
    ]);
    // Never through the owner's own client: 0126's guard would refuse it.
    expect(state.updates).toEqual([]);
  });

  it("a private card: its public render objects (both faces' names) are removed, and every pointer is cleared on the owner's client", async () => {
    state.card = cardRow({ visibility: "private" });
    expect(await bakeAndPersistCardRender(CARD, USER)).toBeNull();
    expect(state.ops).toEqual([{ bucket: "card-renders", op: "remove", keys: RENDER_NAMES(CARD) }]);
    expect(state.writes).toEqual([expect.objectContaining({ via: "user", payload: CLEARED })]);
  });

  it("a successful front bake writes the front's pair and never touches the back's pointers (the back bake is 5.3's)", async () => {
    await bakeAndPersistCardRender(CARD, USER);
    expect(state.ops.map((op) => op.keys).flat()).toEqual([`${USER}/${CARD}.png`, `${USER}/${CARD}.thumb.webp`]);
    const payload = state.writes[0].payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["layout_version", "rendered_at", "rendered_image_url", "rendered_thumb_url"]);
  });

  it("a private card without the service-role key: the missing delete is logged loudly, never skipped silently", async () => {
    state.adminConfigured = false;
    state.card = cardRow({ visibility: "private" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await bakeAndPersistCardRender(CARD, USER)).toBeNull();
      expect(state.ops).toEqual([]);
      expect(error).toHaveBeenCalledWith(expect.stringMatching(/SUPABASE_SECRET_KEY is not set.*publicly fetchable/));
      // The row still loses its render pointers (the clear needs no key).
      expect(state.updates).toEqual([CLEARED]);
    } finally {
      error.mockRestore();
    }
  });

  it("a card that isn't the given owner's is never written", async () => {
    state.card = cardRow({ owner_id: OTHER });
    expect(await bakeAndPersistCardRender(CARD, USER)).toBeNull();
    expect(state.ops).toEqual([]);
    expect(state.adminClients).toBe(0);
  });

  it("without service-role storage the bake stops cleanly (the card falls back to the live preview)", async () => {
    state.adminConfigured = false;
    expect(await bakeAndPersistCardRender(CARD, USER)).toBeNull();
    expect(state.ops).toEqual([]);
    expect(state.updates).toEqual([CLEARED]);
  });
});

describe("deleting cards removes their renders (both faces' names) with the service role, in the caller's folder", () => {
  it("one card", async () => {
    expect(await deleteCardAction(CARD)).toMatchObject({ ok: true });
    expect(state.ops).toEqual([{ bucket: "card-renders", op: "remove", keys: RENDER_NAMES(CARD) }]);
  });

  it("without the service-role key the delete still succeeds, and the render left behind is logged loudly", async () => {
    state.adminConfigured = false;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await deleteCardAction(CARD)).toMatchObject({ ok: true });
      expect(state.ops).toEqual([]);
      expect(error).toHaveBeenCalledWith(expect.stringMatching(/SUPABASE_SECRET_KEY is not set.*publicly fetchable/));
    } finally {
      error.mockRestore();
    }
  });

  it("someone else's card is refused before any storage call", async () => {
    state.card = cardRow({ owner_id: OTHER });
    expect(await deleteCardAction(CARD)).toMatchObject({ ok: false });
    expect(state.ops).toEqual([]);
  });

  it("a batch", async () => {
    state.rows = [
      { id: CARD, owner_id: USER },
      { id: CARD_2, owner_id: USER },
    ];
    expect(await deleteCardsAction([CARD, CARD_2])).toMatchObject({ ok: true, count: 2 });
    expect(state.ops).toEqual([{ bucket: "card-renders", op: "remove", keys: [CARD, CARD_2].flatMap(RENDER_NAMES) }]);
  });
});
