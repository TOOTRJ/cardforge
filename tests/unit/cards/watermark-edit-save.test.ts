import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import { PIPGLYPH_ROSE_WATERMARK, sameWatermark } from "@/lib/cards/watermark";

// ---------------------------------------------------------------------------
// The PipGlyph Rose on an EDIT (owner decision 2026-09-17; the 2026-11 save
// audit): createCardAction gives a free account's creature / spell the Rose
// whatever the payload says, and updateCardAction wrote any watermark an edit
// sent — none included. Now the rule holds for what an edit SENDS: a
// watermark the row doesn't hold is stored as the Rose for a free account.
// The creator resends the STORED watermark on every edit (its control is a
// subscriber's): that is left as stored — an edit never changes what its
// maker did not touch, and no stored card is rewritten by an edit of
// something else. A subscriber keeps whatever they send.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  existing: null as unknown,
  client: null as unknown,
  paid: false,
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
  getEntitlements: async () => ({ premiumFrames: state.paid, removeWatermark: state.paid, cardCapacity: -1 }),
}));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn() }));
vi.mock("@/lib/decks/membership", () => ({ addCustomCardEntryToDeck: vi.fn() }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCard: vi.fn(),
  purgeHiddenCards: vi.fn(),
  revalidateCardListSurfaces: vi.fn(),
  revalidateCardPaths: vi.fn(),
  revalidateCardPages: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { updateCardAction } from "@/lib/cards/actions";

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && called(calls, "update")) return { data: { id: CARD, slug: "wyrm" }, error: null };
    return { data: null, error: null, count: 0 };
  });
  state.client = stub.client;
  return stub;
}
const written = (stub: ReturnType<typeof db>) => {
  const entry = stub.forTable("cards").find((e) => called(e.calls, "update"));
  return payloadOf(entry?.calls ?? [], "update") as Record<string, unknown> | undefined;
};

const SUN = { kind: "preset", key: "order-sun", size: "normal" } as const;

function stored(over: Record<string, unknown> = {}) {
  return {
    id: CARD,
    owner_id: USER,
    title: "Emberbound Wyrm",
    slug: "wyrm",
    color_identity: ["red"],
    card_type: "creature",
    rarity: "rare",
    supertype: null,
    subtypes: ["Dragon"],
    rules_text: "Flying",
    flavor_text: null,
    power: "5",
    toughness: "4",
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: null,
    face_content: null,
    frame_preview: false,
    frame_style: { template: "m15" },
    watermark: PIPGLYPH_ROSE_WATERMARK,
    ...over,
  };
}

async function editWatermark(watermark: unknown) {
  const stub = db();
  const result = await updateCardAction(CARD, { title: "Emberbound Wyrm, Reborn", watermark });
  expect(result).toMatchObject({ ok: true });
  return written(stub)?.watermark;
}

beforeEach(() => {
  state.paid = false;
  state.existing = stored();
});

describe("a free account's edit of a creature or spell", () => {
  it("can't take the Rose off, or swap it for another mark", async () => {
    expect(await editWatermark(null)).toEqual(PIPGLYPH_ROSE_WATERMARK);
    expect(await editWatermark(SUN)).toEqual(PIPGLYPH_ROSE_WATERMARK);
    for (const card_type of ["instant", "sorcery", "artifact", "enchantment"]) {
      state.existing = stored({ card_type });
      expect(await editWatermark(null), card_type).toEqual(PIPGLYPH_ROSE_WATERMARK);
    }
  });

  it("a card stored WITHOUT the Rose (made before the rule, or while subscribed) keeps what it has when the edit sends it back", async () => {
    state.existing = stored({ watermark: null });
    expect(await editWatermark(null)).toBeNull();
    state.existing = stored({ watermark: SUN });
    // Sent back in another key order, with the default size spelled out.
    expect(await editWatermark({ size: "normal", key: "order-sun", kind: "preset" })).toEqual({ size: "normal", key: "order-sun", kind: "preset" });
    // …but a change is held to the rule.
    expect(await editWatermark({ kind: "mana", key: "r", size: "normal" })).toEqual(PIPGLYPH_ROSE_WATERMARK);
  });

  it("an edit that sends no watermark leaves the column alone", async () => {
    state.existing = stored({ watermark: null });
    const stub = db();
    expect((await updateCardAction(CARD, { title: "Renamed" })).ok).toBe(true);
    expect("watermark" in (written(stub) ?? {})).toBe(false);
  });

  // The independent check of #826: the watermark compared alone let a crafted
  // TYPE change through — card_type is locked in the editor, so only a
  // crafted payload sends one.
  it("a land turned creature in one edit gets the Rose, its watermark sent unchanged", async () => {
    state.existing = stored({ card_type: "land", watermark: null, power: null, toughness: null });
    const stub = db();
    expect((await updateCardAction(CARD, { card_type: "creature", watermark: null })).ok).toBe(true);
    expect(written(stub)?.card_type).toBe("creature");
    expect(written(stub)?.watermark).toEqual(PIPGLYPH_ROSE_WATERMARK);
  });

  it("…or in two: off to a land without the Rose, then back to a creature with no watermark sent", async () => {
    // Step 1, from a Rose creature: a land may carry none.
    state.existing = stored();
    let stub = db();
    expect((await updateCardAction(CARD, { card_type: "land", watermark: null })).ok).toBe(true);
    expect(written(stub)?.watermark).toBeNull();
    // Step 2, from the stored land: the type alone brings the Rose back.
    state.existing = stored({ card_type: "land", watermark: null });
    stub = db();
    expect((await updateCardAction(CARD, { card_type: "creature" })).ok).toBe(true);
    expect(written(stub)?.watermark).toEqual(PIPGLYPH_ROSE_WATERMARK);
    // Between two Rose types (creature → instant), the same.
    state.existing = stored({ watermark: null });
    stub = db();
    expect((await updateCardAction(CARD, { card_type: "instant", watermark: null })).ok).toBe(true);
    expect(written(stub)?.watermark).toEqual(PIPGLYPH_ROSE_WATERMARK);
  });

  it("untouched: the type sent as stored and the watermark sent back leave an older card as it is", async () => {
    state.existing = stored({ watermark: null });
    let stub = db();
    expect((await updateCardAction(CARD, { title: "Renamed", card_type: "creature", watermark: null })).ok).toBe(true);
    expect(written(stub)?.watermark).toBeNull();
    // A subscriber's type change keeps what they send.
    state.paid = true;
    state.existing = stored({ card_type: "land", watermark: null });
    stub = db();
    expect((await updateCardAction(CARD, { card_type: "creature", watermark: null })).ok).toBe(true);
    expect(written(stub)?.watermark).toBeNull();
  });

  it("a type with no default watermark (a land, a token, a walker) keeps the maker's choice", async () => {
    for (const card_type of ["land", "token", "planeswalker"]) {
      state.existing = stored({ card_type, watermark: null, power: null, toughness: null });
      expect(await editWatermark(SUN), card_type).toEqual(SUN);
    }
  });
});

describe("a subscriber's edit", () => {
  it("stores what it sends", async () => {
    state.paid = true;
    expect(await editWatermark(null)).toBeNull();
    expect(await editWatermark(SUN)).toEqual(SUN);
  });
});

describe("sameWatermark", () => {
  it("compares the mark drawn: kind, key or picture, size (absent = normal), opacity", () => {
    expect(sameWatermark(null, undefined)).toBe(true);
    expect(sameWatermark(null, PIPGLYPH_ROSE_WATERMARK)).toBe(false);
    expect(sameWatermark({ kind: "preset", key: "pipglyph-rose" }, PIPGLYPH_ROSE_WATERMARK)).toBe(true);
    expect(sameWatermark({ kind: "preset", key: "pipglyph-rose", size: "large" }, PIPGLYPH_ROSE_WATERMARK)).toBe(false);
    expect(sameWatermark({ kind: "preset", key: "pipglyph-rose", opacity: 0.3 }, PIPGLYPH_ROSE_WATERMARK)).toBe(false);
    expect(sameWatermark({ kind: "custom", url: "https://a/x.png" }, { kind: "custom", url: "https://a/y.png" })).toBe(false);
    expect(sameWatermark({ kind: "mana", key: "r" }, { kind: "mana", key: "r", size: "normal" })).toBe(true);
  });
});
