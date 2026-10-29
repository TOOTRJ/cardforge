import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  called,
  chainClient,
  payloadOf,
  type ChainAnswer,
} from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// Strong language makes a card private (owner policy 2026-10-28,
// lib/moderation/profanity.ts) — in BOTH card actions, which every save
// path goes through (the creator, the AI jobs, the deck remix, an import),
// and in My Cards' bulk publish. Never a refusal; a typed notice says why. A
// clean card saves exactly as before. An EDIT that makes a public card
// private this way leaves view through the one existing path (the purge
// after the write, the deferred bake removing a private card's render), and
// an edit of a card already in view that adds no strong language is left
// alone (no retroactive change). The word is ROT13'd: the repo is public.
// ---------------------------------------------------------------------------

const rot13 = (text: string) =>
  text.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const STRONG = rot13("fuvg");

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

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
  getVerifiedFrameKeys: async () => ["m15/w", "split/w"],
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { after } from "next/server";
import { bakeAndPersistCardRender } from "@/lib/cards/bake-render";
import { purgeHiddenCard } from "@/lib/cards/revalidate";
import { createCardAction, updateCardAction, updateCardsVisibilityAction } from "@/lib/cards/actions";

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
    title: "Grim Tidings",
    game_system_id: GAME,
    card_type: "creature",
    color_identity: ["white"],
    subtypes: ["Human"],
    power: "2",
    toughness: "2",
    rules_text: "Flying",
    frame_style: { template: "m15" },
    visibility: "public",
    art_url: "https://example.com/art.png",
    ...overrides,
  };
}

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
  visibility: "public",
  art_url: "https://example.com/art.png",
  back_face: null,
  ...overrides,
});

beforeEach(() => {
  state.existing = null;
  vi.mocked(purgeHiddenCard).mockClear();
  vi.mocked(after).mockClear();
  vi.mocked(bakeAndPersistCardRender).mockClear();
});

describe("createCardAction — strong language", () => {
  it("a clean card saves exactly as asked, with no notice", async () => {
    const stub = db();
    const result = await createCardAction(payload({ rules_text: "Damnation awaits. Go to hell." }));
    expect(result).toEqual({ ok: true, cardId: CARD, slug: "test" });
    expect(insertOf(stub).visibility).toBe("public");
  });

  it.each(["public", "unlisted"])("a %s save whose text holds it is stored private, and says why", async (visibility) => {
    const stub = db();
    const result = await createCardAction(payload({ visibility, rules_text: `Flying. ${STRONG}.` }));
    expect(result).toEqual({
      ok: true,
      cardId: CARD,
      slug: "test",
      forcedPrivate: { reason: "profanity", fields: ["rules_text"] },
    });
    expect(insertOf(stub).visibility).toBe("private");
  });

  it("reads every field: name, type line, flavour, tags, a second face", async () => {
    db();
    const result = await createCardAction(
      payload({
        title: `${STRONG} Lord`,
        subtypes: ["Human", STRONG],
        flavor_text: STRONG,
        tags: [STRONG],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      forcedPrivate: { fields: ["title", "type_line", "flavor_text", "tags"] },
    });
  });

  it("a walker's rows count as its rules text", async () => {
    db();
    const result = await createCardAction(
      payload({
        card_type: "planeswalker",
        subtypes: ["Ajani"],
        power: undefined,
        toughness: undefined,
        loyalty: "3",
        frame_style: { template: "m15" },
        face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: `Gain 1 life, ${STRONG}.` }] } },
      }),
    );
    expect(result).toMatchObject({ ok: true, forcedPrivate: { fields: ["rules_text"] } });
  });

  it("a private save (a draft) is never 'forced' — no notice", async () => {
    const stub = db();
    const result = await createCardAction(payload({ visibility: "private", rules_text: STRONG }));
    expect(result).toEqual({ ok: true, cardId: CARD, slug: "test" });
    expect(insertOf(stub).visibility).toBe("private");
  });
});

// A save the rule makes private is a draft's: an unnamed second face (a
// draft's privilege, TODO 3b.5) never refuses it.
const splitPayload = (overrides: Record<string, unknown> = {}) =>
  payload({
    card_type: "instant",
    subtypes: [],
    power: undefined,
    toughness: undefined,
    frame_style: { template: "split" },
    rules_text: `Deal 2 damage, ${STRONG}.`,
    back_face: { title: "", card_type: "instant", rules_text: "Tap two target permanents." },
    ...overrides,
  });

describe("strong language before the second-face-name refusal", () => {
  it("create: a public save the text makes private saves, unnamed half and all", async () => {
    const stub = db();
    const result = await createCardAction(splitPayload());
    expect(result).toMatchObject({ ok: true, forcedPrivate: { fields: ["rules_text"] } });
    expect(insertOf(stub).visibility).toBe("private");
  });

  it("create: a clean public save with an unnamed half is still refused", async () => {
    db();
    const result = await createCardAction(splitPayload({ rules_text: "Deal 2 damage." }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { "back_face.title": expect.any(String) } });
  });

  it("edit: publishing a draft with an unnamed half whose text holds it saves private", async () => {
    state.existing = row({
      visibility: "private",
      card_type: "instant",
      subtypes: [],
      frame_style: { template: "split" },
      rules_text: `Deal 2 damage, ${STRONG}.`,
      back_face: { title: "", card_type: "instant", rules_text: "Tap two target permanents." },
    });
    const stub = db();
    const result = await updateCardAction(CARD, { visibility: "public" });
    expect(result).toMatchObject({ ok: true, forcedPrivate: { fields: ["rules_text"] } });
    expect(updateOf(stub).visibility).toBe("private");
  });
});

describe("updateCardAction — strong language", () => {
  it("any edit of a field that already held it forces private (no in-field loophole)", async () => {
    state.existing = row({ flavor_text: `A ${STRONG} day.` });
    const stub = db();
    const result = await updateCardAction(CARD, { flavor_text: `A ${STRONG} day, and worse.`, visibility: "public" });
    expect(result).toMatchObject({ ok: true, forcedPrivate: { fields: ["flavor_text"] } });
    expect(updateOf(stub).visibility).toBe("private");
  });

  it("a stat or the collector line counts", async () => {
    state.existing = row();
    const stub = db();
    const result = await updateCardAction(CARD, { collector_number: STRONG });
    expect(result).toMatchObject({ ok: true, forcedPrivate: { fields: ["stats"] } });
    expect(updateOf(stub).visibility).toBe("private");
  });

  it("an edit that types it into a public card makes the card private and takes it out of view", async () => {
    state.existing = row();
    const stub = db();
    const result = await updateCardAction(CARD, { rules_text: `Flying. ${STRONG}.`, visibility: "public" });
    expect(result).toEqual({
      ok: true,
      cardId: CARD,
      slug: "test",
      forcedPrivate: { reason: "profanity", fields: ["rules_text"] },
    });
    const update = updateOf(stub);
    expect(update.visibility).toBe("private");
    // The ONE out-of-view path a hand-made private edit takes: the purge
    // (card page + CDN tag) right after the write, the render pointers
    // cleared in the same update, the deferred bake of a private card
    // removing its objects — and the purge again after it.
    expect(update.rendered_image_url).toBeNull();
    expect(vi.mocked(purgeHiddenCard)).toHaveBeenCalledWith({ id: CARD, slug: "test" }, "tester");
    const deferred = vi.mocked(after).mock.calls[0][0] as () => Promise<void>;
    await deferred();
    expect(vi.mocked(bakeAndPersistCardRender)).toHaveBeenCalledWith(CARD, USER);
    expect(vi.mocked(purgeHiddenCard)).toHaveBeenCalledTimes(2);
  });

  it("publishing a private draft whose text holds it keeps it private", async () => {
    state.existing = row({ visibility: "private", flavor_text: STRONG });
    const stub = db();
    const result = await updateCardAction(CARD, { visibility: "public" });
    expect(result).toMatchObject({ ok: true, forcedPrivate: { fields: ["flavor_text"] } });
    expect(updateOf(stub).visibility).toBe("private");
    expect(vi.mocked(purgeHiddenCard)).not.toHaveBeenCalled();
  });

  it("an edit of a card already in view that adds none is left alone (not retroactive)", async () => {
    state.existing = row({ flavor_text: STRONG });
    const stub = db();
    const result = await updateCardAction(CARD, { title: "Grimmer Tidings", flavor_text: STRONG, visibility: "public" });
    expect(result).toEqual({ ok: true, cardId: CARD, slug: "test" });
    expect(updateOf(stub).visibility).toBe("public");
    expect(vi.mocked(purgeHiddenCard)).not.toHaveBeenCalled();
  });

  it("…but one that asks for a wider audience (unlisted → public) is made private", async () => {
    state.existing = row({ visibility: "unlisted", flavor_text: STRONG });
    const stub = db();
    const result = await updateCardAction(CARD, { visibility: "public" });
    expect(result).toMatchObject({ ok: true, forcedPrivate: { fields: ["flavor_text"] } });
    expect(updateOf(stub).visibility).toBe("private");
  });

  it("…and so is one that adds it to another field", async () => {
    state.existing = row({ flavor_text: STRONG });
    const stub = db();
    const result = await updateCardAction(CARD, { rules_text: STRONG });
    expect(result).toMatchObject({ ok: true, forcedPrivate: { fields: ["rules_text", "flavor_text"] } });
    expect(updateOf(stub).visibility).toBe("private");
  });

  it("a clean edit saves exactly as before", async () => {
    state.existing = row();
    const stub = db();
    const result = await updateCardAction(CARD, { title: "Renamed", visibility: "public" });
    expect(result).toEqual({ ok: true, cardId: CARD, slug: "test" });
    expect(updateOf(stub).visibility).toBe("public");
  });
});

describe("updateCardsVisibilityAction — strong language in the batch", () => {
  const CLEAN = "77777777-7777-4777-8777-777777777777";
  const ROUGH = "88888888-8888-4888-8888-888888888888";
  const bulkRow = (id: string, rules: string | null, visibility = "private") => ({
    id,
    owner_id: USER,
    title: `Card ${id.slice(0, 4)}`,
    back_face: null,
    rendered_image_url: null,
    frame_preview: false,
    visibility,
    rules_text: rules,
  });
  function bulkDb(rows: unknown[]) {
    const stub = chainClient((_table, calls): ChainAnswer =>
      called(calls, "update") ? { error: null } : { data: rows, error: null },
    );
    state.client = stub.client;
    state.admin = { storage: { from: () => ({ remove: async () => ({ error: null }) }) } };
    return stub;
  }
  const updates = (stub: ReturnType<typeof chainClient>) =>
    stub.forTable("cards").filter((entry) => called(entry.calls, "update"));

  it("publishes the clean cards, leaves the rest as they were and counts them", async () => {
    const stub = bulkDb([bulkRow(CLEAN, "Flying"), bulkRow(ROUGH, STRONG)]);
    const result = await updateCardsVisibilityAction([CLEAN, ROUGH], "public");
    expect(result).toEqual({ ok: true, count: 1, skippedPreviews: 0, skippedLanguage: 1 });
    const write = updates(stub)[0].calls;
    expect(write.find((c) => c.method === "in")!.args[1]).toEqual([CLEAN]);
    // The read asked for the text.
    const read = stub.forTable("cards")[0].calls.find((c) => c.method === "select")!;
    expect(read.args[0]).toMatch(/rules_text/);
  });

  it("nothing to publish → nothing written, and the message says why", async () => {
    const stub = bulkDb([bulkRow(ROUGH, STRONG)]);
    expect(await updateCardsVisibilityAction([ROUGH], "unlisted")).toEqual({
      ok: false,
      error: "Nothing was made unlisted: the selected card's text includes strong language. Remove the strong language to publish.",
    });
    expect(updates(stub)).toHaveLength(0);
  });

  it("an already-public card may still be unlisted (a narrower audience)", async () => {
    bulkDb([bulkRow(ROUGH, STRONG, "public")]);
    expect(await updateCardsVisibilityAction([ROUGH], "unlisted")).toEqual({ ok: true, count: 1, skippedPreviews: 0 });
  });

  it("making cards private is never held back", async () => {
    bulkDb([bulkRow(CLEAN, "Flying", "public"), bulkRow(ROUGH, STRONG, "public")]);
    expect(await updateCardsVisibilityAction([CLEAN, ROUGH], "private")).toEqual({ ok: true, count: 2, skippedPreviews: 0 });
  });

  it("a database without a late text column reads again without it", async () => {
    let reads = 0;
    const stub = chainClient((_table, calls): ChainAnswer => {
      if (called(calls, "update")) return { error: null };
      reads += 1;
      if (reads === 1) return { error: { code: "42703", message: "column cards.nickname does not exist" } };
      return { data: [bulkRow(CLEAN, "Flying")], error: null };
    });
    state.client = stub.client;
    expect(await updateCardsVisibilityAction([CLEAN], "public")).toEqual({ ok: true, count: 1, skippedPreviews: 0 });
    const second = stub.forTable("cards")[1].calls.find((c) => c.method === "select")!.args[0] as string;
    expect(second).not.toMatch(/nickname/);
    expect(second).toMatch(/frame_preview/);
  });
});
