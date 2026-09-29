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
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const CARD = "22222222-2222-4222-8222-222222222222";
const CARD_2 = "33333333-3333-4333-8333-333333333333";

type Op = { bucket: string; op: "upload" | "remove"; keys: string[] };

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  adminConfigured: true,
  ops: [] as Op[],
  adminClients: 0,
  card: null as Record<string, unknown> | null,
  rows: [] as { id: string; owner_id: string }[],
  updates: [] as unknown[],
  png: null as Buffer | null,
}));

function cookieClient() {
  const db = chainClient((table, calls): ChainAnswer => {
    if (called(calls, "update")) {
      state.updates.push(calls.find((c) => c.method === "update")!.args[0]);
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
    return {
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
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ rendered_image_url: url });
  });

  it("a private card: its public render objects are removed, nothing is written", async () => {
    state.card = cardRow({ visibility: "private" });
    expect(await bakeAndPersistCardRender(CARD, USER)).toBeNull();
    expect(state.ops).toEqual([
      { bucket: "card-renders", op: "remove", keys: [`${USER}/${CARD}.png`] },
      { bucket: "card-renders", op: "remove", keys: [`${USER}/${CARD}.thumb.webp`] },
    ]);
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
    expect(state.updates).toEqual([
      { rendered_image_url: null, rendered_thumb_url: null, rendered_at: null, layout_version: null },
    ]);
  });
});

describe("deleting cards removes their renders with the service role, in the caller's folder", () => {
  it("one card", async () => {
    expect(await deleteCardAction(CARD)).toMatchObject({ ok: true });
    expect(state.ops).toEqual([
      { bucket: "card-renders", op: "remove", keys: [`${USER}/${CARD}.png`, `${USER}/${CARD}.thumb.webp`] },
    ]);
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
    expect(state.ops).toEqual([
      {
        bucket: "card-renders",
        op: "remove",
        keys: [CARD, CARD_2].flatMap((id) => [`${USER}/${id}.png`, `${USER}/${id}.thumb.webp`]),
      },
    ]);
  });
});
