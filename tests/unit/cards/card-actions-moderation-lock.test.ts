import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  called,
  chainClient,
  payloadOf,
  type ChainAnswer,
} from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The moderation lock (migration 0156, lib/moderation/lock.ts): a card the
// moderation hide took out of view stays PRIVATE until an admin unhides it.
// Every go-public path reads the lock first and answers with a typed reason
// — never the database's CHECK error:
//   * updateCardAction saves the edit PRIVATE with `moderationLocked: true`
//     (other fields still editable), and maps a late CHECK violation (the
//     lock landed after the read) to code MODERATION_LOCKED;
//   * updateCardsVisibilityAction (My Cards' bulk bar, the deck's "Make
//     public") leaves a locked card as it is and counts it
//     (`skippedModeration`), refuses a batch of locked cards in words, and
//     may still make one private.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const HIDDEN_AT = "2026-10-29T12:00:00.000Z";

const state = vi.hoisted(() => ({
  existing: null as unknown,
  client: null as unknown,
  admin: {} as unknown,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.admin,
  isAdminConfigured: () => false,
}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () => ["m15/w"],
}));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.existing,
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
  revalidateCardPaths: vi.fn(),
}));
vi.mock("@/lib/cards/remix-media", () => ({ adoptRemixMedia: vi.fn(async () => ({ ok: true, media: {} })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { adoptRemixMedia } from "@/lib/cards/remix-media";
import { createCardAction, updateCardAction, updateCardsVisibilityAction } from "@/lib/cards/actions";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: CARD,
  owner_id: USER,
  slug: "grim",
  title: "Grim Tidings",
  card_type: "creature",
  supertype: null,
  subtypes: ["Human"],
  rules_text: "Flying",
  flavor_text: null,
  tags: [],
  color_identity: ["white"],
  frame_style: { template: "m15" },
  visibility: "private",
  art_url: "https://example.com/art.png",
  back_face: null,
  moderation_hidden_at: HIDDEN_AT,
  moderation_hidden_reason: "report",
  ...overrides,
});

function db(answer: ChainAnswer = { data: { id: CARD, slug: "grim" }, error: null }) {
  const stub = chainClient((table): ChainAnswer => (table === "cards" ? answer : { error: null }));
  state.client = stub.client;
  return stub;
}
const updateOf = (stub: ReturnType<typeof chainClient>) =>
  payloadOf(stub.forTable("cards").at(-1)!.calls, "update") as Record<string, unknown>;

beforeEach(() => {
  state.existing = null;
});

describe("updateCardAction — the moderation lock", () => {
  it("a publish of a locked card saves the edit PRIVATE and says why", async () => {
    state.existing = row();
    const stub = db();
    const result = await updateCardAction(CARD, { title: "Grim Tidings Redux", visibility: "public" });
    expect(result).toEqual({ ok: true, cardId: CARD, slug: "grim", moderationLocked: true });
    const update = updateOf(stub);
    expect(update.visibility).toBe("private");
    expect(update.title).toBe("Grim Tidings Redux");
    // The edit never names the lock's columns (an API role may not).
    expect(update).not.toHaveProperty("moderation_hidden_at");
    expect(update).not.toHaveProperty("moderation_hidden_reason");
  });

  it("unlisted is held back the same way", async () => {
    state.existing = row();
    const stub = db();
    expect(await updateCardAction(CARD, { visibility: "unlisted" })).toMatchObject({ ok: true, moderationLocked: true });
    expect(updateOf(stub).visibility).toBe("private");
  });

  it("an edit that stays private is an ordinary save — no notice", async () => {
    state.existing = row();
    const stub = db();
    expect(await updateCardAction(CARD, { rules_text: "Flying, vigilance" })).toEqual({ ok: true, cardId: CARD, slug: "grim" });
    expect(updateOf(stub)).toMatchObject({ rules_text: "Flying, vigilance" });
    expect(updateOf(stub).visibility).toBeUndefined();
  });

  it("an unlocked card publishes as before", async () => {
    state.existing = row({ moderation_hidden_at: null, moderation_hidden_reason: null });
    const stub = db();
    expect(await updateCardAction(CARD, { visibility: "public" })).toEqual({ ok: true, cardId: CARD, slug: "grim" });
    expect(updateOf(stub).visibility).toBe("public");
  });

  it("a row read without the column (a database before 0156) is unlocked", async () => {
    const legacy = row();
    delete (legacy as Record<string, unknown>).moderation_hidden_at;
    state.existing = legacy;
    const stub = db();
    expect(await updateCardAction(CARD, { visibility: "public" })).toEqual({ ok: true, cardId: CARD, slug: "grim" });
    expect(updateOf(stub).visibility).toBe("public");
  });

  it("the lock landing after the read: the CHECK error becomes a typed refusal in words", async () => {
    state.existing = row({ moderation_hidden_at: null, moderation_hidden_reason: null });
    db({
      data: null,
      error: {
        code: "23514",
        message: 'new row for relation "cards" violates check constraint "cards_moderation_lock_private"',
      },
    });
    const result = await updateCardAction(CARD, { visibility: "public" });
    expect(result).toMatchObject({ ok: false, code: "MODERATION_LOCKED" });
    expect((result as { formError: string }).formError).toMatch(/hidden by moderation/);
    expect((result as { formError: string }).formError).not.toMatch(/check constraint/);
  });
});

describe("updateCardsVisibilityAction — the moderation lock", () => {
  const OPEN = "77777777-7777-4777-8777-777777777777";
  const LOCKED = "88888888-8888-4888-8888-888888888888";
  const bulkRow = (id: string, hiddenAt: string | null, visibility = "private") => ({
    id,
    owner_id: USER,
    title: `Card ${id.slice(0, 4)}`,
    back_face: null,
    rendered_image_url: null,
    frame_preview: false,
    visibility,
    rules_text: "Flying",
    art_url: "https://example.com/art.png",
    moderation_hidden_at: hiddenAt,
  });
  function bulkDb(rows: unknown[], writeError: ChainAnswer["error"] = null) {
    const stub = chainClient((_table, calls): ChainAnswer =>
      called(calls, "update") ? { error: writeError } : { data: rows, error: null },
    );
    state.client = stub.client;
    state.admin = { storage: { from: () => ({ remove: async () => ({ error: null }) }) } };
    return stub;
  }
  const updates = (stub: ReturnType<typeof chainClient>) =>
    stub.forTable("cards").filter((entry) => called(entry.calls, "update"));

  it("publishes the open cards, leaves the locked one private and counts it", async () => {
    const stub = bulkDb([bulkRow(OPEN, null), bulkRow(LOCKED, HIDDEN_AT)]);
    expect(await updateCardsVisibilityAction([OPEN, LOCKED], "public")).toEqual({
      ok: true,
      count: 1,
      skippedPreviews: 0,
      skippedModeration: 1,
    });
    const write = updates(stub)[0].calls;
    expect(write.find((c) => c.method === "in")!.args[1]).toEqual([OPEN]);
    const read = stub.forTable("cards")[0].calls.find((c) => c.method === "select")!;
    expect(read.args[0]).toMatch(/moderation_hidden_at/);
  });

  it("only locked cards → nothing written, a refusal in words with its reason", async () => {
    const stub = bulkDb([bulkRow(LOCKED, HIDDEN_AT)]);
    expect(await updateCardsVisibilityAction([LOCKED], "unlisted")).toEqual({
      ok: false,
      reason: "moderation",
      error: "Nothing was made unlisted: the selected card was hidden by moderation and stays private until our team reviews it.",
    });
    expect(updates(stub)).toHaveLength(0);
  });

  it("making a locked card private is never held back", async () => {
    bulkDb([bulkRow(LOCKED, HIDDEN_AT), bulkRow(OPEN, null, "public")]);
    expect(await updateCardsVisibilityAction([LOCKED, OPEN], "private")).toEqual({ ok: true, count: 2, skippedPreviews: 0 });
  });

  it("the lock landing after the read: the CHECK error becomes a refusal in words", async () => {
    bulkDb([bulkRow(OPEN, null)], {
      code: "23514",
      message: 'new row for relation "cards" violates check constraint "cards_moderation_lock_private"',
    });
    const result = await updateCardsVisibilityAction([OPEN], "public");
    expect(result).toMatchObject({ ok: false, reason: "moderation" });
    expect((result as { error: string }).error).toMatch(/hidden by moderation/);
  });

  it("a database without the column reads again without it", async () => {
    let reads = 0;
    const stub = chainClient((_table, calls): ChainAnswer => {
      if (called(calls, "update")) return { error: null };
      reads += 1;
      if (reads === 1) return { error: { code: "42703", message: "column cards.moderation_hidden_at does not exist" } };
      return { data: [bulkRow(OPEN, null)], error: null };
    });
    state.client = stub.client;
    expect(await updateCardsVisibilityAction([OPEN], "public")).toEqual({ ok: true, count: 1, skippedPreviews: 0 });
    const second = stub.forTable("cards")[1].calls.find((c) => c.method === "select")!.args[0] as string;
    expect(second).not.toMatch(/moderation_hidden_at/);
  });
});

describe("a remix of a card moderation hid (owner decision 2026-10-30)", () => {
  const PARENT = "55555555-5555-4555-8555-555555555555";
  const remixPayload = () => ({
    title: "Grim Tidings, Again",
    game_system_id: "33333333-3333-4333-8333-333333333333",
    card_type: "creature",
    color_identity: ["white"],
    subtypes: ["Human"],
    power: "2",
    toughness: "2",
    rules_text: "Flying",
    frame_style: { template: "m15" },
    visibility: "private",
    art_url: "https://example.com/art.png",
    parent_card_id: PARENT,
  });

  it("createCardAction refuses it in words BEFORE any media is copied or anything is written", async () => {
    state.existing = row({ id: PARENT });
    vi.mocked(adoptRemixMedia).mockClear();
    const stub = db();
    const result = await createCardAction(remixPayload());
    expect(result).toEqual({
      ok: false,
      code: "MODERATION_LOCKED_REMIX",
      formError: "This card was hidden by moderation, so it can't be remixed. Contact us if you think that's a mistake.",
    });
    expect(vi.mocked(adoptRemixMedia)).not.toHaveBeenCalled();
    expect(stub.forTable("cards").filter((e) => called(e.calls, "insert"))).toHaveLength(0);
  });

  it("an unlocked parent remixes as before", async () => {
    state.existing = row({ id: PARENT, moderation_hidden_at: null, moderation_hidden_reason: null });
    const stub = db();
    expect((await createCardAction(remixPayload())).ok).toBe(true);
    expect(stub.forTable("cards").filter((e) => called(e.calls, "insert"))).toHaveLength(1);
  });

  it("an edit can't newly point its parent at a locked card", async () => {
    // getCardById answers the same row for the card and its parent here; the
    // card's own parent is unset, so the link is new.
    state.existing = row({ parent_card_id: null });
    db();
    const result = await updateCardAction(CARD, { parent_card_id: PARENT });
    expect(result).toMatchObject({ ok: false, code: "MODERATION_LOCKED_REMIX" });
  });
});
