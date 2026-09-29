import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  called,
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
// unverified frame makes it a preview. A bulk publish / unlist in My Cards
// skips the previews and changes the rest (owner, 2026-09-28).
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
  admin: {} as unknown,
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
  createAdminClient: () => state.admin,
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

import { after } from "next/server";
import { bakeAndPersistCardRender } from "@/lib/cards/bake-render";
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


describe("updateCardsVisibilityAction — frame previews in the batch", () => {
  // Owner, 2026-09-28: a publish / unlist SKIPS the previews (they stay
  // private — 0121's CHECK keeps them so anyway) and changes the rest. The
  // action reads the flag itself; the client only ever sends ids.
  const PREVIEW = "55555555-5555-4555-8555-555555555555";
  const PREVIEW_2 = "66666666-6666-4666-8666-666666666666";
  const ORDINARY = "77777777-7777-4777-8777-777777777777";
  const rowOf = (id: string, framePreview: boolean, owner = USER) => ({
    id,
    owner_id: owner,
    title: `Card ${id.slice(0, 4)}`,
    back_face: null,
    rendered_image_url: null,
    frame_preview: framePreview,
  });

  /** A chain client answering the pre-flight read with `rows` (optionally
   *  failing the first read first) and the update with `updateError`. */
  function bulkDb(
    rows: unknown[],
    opts: { updateError?: { code: string; message: string }; firstReadError?: string } = {},
  ) {
    let reads = 0;
    const stub = chainClient((table, calls): ChainAnswer => {
      if (called(calls, "update")) return { error: opts.updateError ?? null };
      reads += 1;
      if (reads === 1 && opts.firstReadError) {
        return { error: { code: "42703", message: opts.firstReadError } };
      }
      return { data: rows, error: null };
    });
    const removed: string[][] = [];
    state.client = stub.client;
    // Render objects are removed with the service role (migration 0126).
    state.admin = {
      storage: {
        from: () => ({
          remove: async (paths: string[]) => {
            removed.push(paths);
            return { error: null };
          },
        }),
      },
    };
    return { stub, removed };
  }

  const updates = (stub: ReturnType<typeof chainClient>) =>
    stub.forTable("cards").filter((entry) => called(entry.calls, "update"));
  const updatedIds = (stub: ReturnType<typeof chainClient>) =>
    updates(stub)[0].calls.find((c) => c.method === "in")!.args[1] as string[];

  it("publishes the ordinary cards and skips the previews, saying how many", async () => {
    const { stub } = bulkDb([rowOf(ORDINARY, false), rowOf(PREVIEW, true), rowOf(PREVIEW_2, true)]);
    const result = await updateCardsVisibilityAction([ORDINARY, PREVIEW, PREVIEW_2], "public");
    expect(result).toEqual({ ok: true, count: 1, skippedPreviews: 2 });
    // The pre-flight read asked for the flag; the write names only the rest.
    const read = stub.forTable("cards")[0].calls.find((c) => c.method === "select")!;
    expect(read.args[0]).toMatch(/frame_preview/);
    expect(updatedIds(stub)).toEqual([ORDINARY]);
    expect(payloadOf(updates(stub)[0].calls, "update")).toEqual({ visibility: "public" });
  });

  it("a skipped preview's unnamed second face doesn't block publishing the rest", async () => {
    // A preview is saved as a draft (a title is enough), so its second face
    // may be unnamed — it isn't going out, so the name gate mustn't read it.
    const { stub } = bulkDb([
      rowOf(ORDINARY, false),
      { ...rowOf(PREVIEW, true), back_face: { title: "", card_type: "instant" } },
    ]);
    expect(await updateCardsVisibilityAction([ORDINARY, PREVIEW], "public")).toEqual({
      ok: true,
      count: 1,
      skippedPreviews: 1,
    });
    expect(updatedIds(stub)).toEqual([ORDINARY]);
  });

  it("an unlist skips the previews the same way", async () => {
    const { stub } = bulkDb([rowOf(ORDINARY, false), rowOf(PREVIEW, true)]);
    expect(await updateCardsVisibilityAction([ORDINARY, PREVIEW], "unlisted")).toEqual({
      ok: true,
      count: 1,
      skippedPreviews: 1,
    });
    expect(updatedIds(stub)).toEqual([ORDINARY]);
  });

  it("only the published cards are baked — never a skipped preview", async () => {
    vi.mocked(after).mockClear();
    vi.mocked(bakeAndPersistCardRender).mockClear();
    bulkDb([rowOf(ORDINARY, false), rowOf(PREVIEW, true)]);
    await updateCardsVisibilityAction([ORDINARY, PREVIEW], "public");
    const deferred = vi.mocked(after).mock.calls[0][0] as () => Promise<void>;
    await deferred();
    expect(vi.mocked(bakeAndPersistCardRender).mock.calls.map((c) => c[0])).toEqual([ORDINARY]);
  });

  it("all selected are previews → nothing is written, and the message says why", async () => {
    const { stub } = bulkDb([rowOf(PREVIEW, true), rowOf(PREVIEW_2, true)]);
    const result = await updateCardsVisibilityAction([PREVIEW, PREVIEW_2], "public");
    expect(result).toEqual({
      ok: false,
      error: "Nothing was published: all 2 selected cards are frame previews, and frame previews stay private.",
    });
    expect(updates(stub)).toHaveLength(0);
  });

  it("a single preview says so in the singular", async () => {
    bulkDb([rowOf(PREVIEW, true)]);
    const result = await updateCardsVisibilityAction([PREVIEW], "unlisted");
    expect(!result.ok && result.error).toBe(
      "Nothing was made unlisted: the selected card is a frame preview, and frame previews stay private.",
    );
  });

  it("making cards private includes the previews (nothing to skip)", async () => {
    const { stub, removed } = bulkDb([rowOf(ORDINARY, false), rowOf(PREVIEW, true)]);
    expect(await updateCardsVisibilityAction([ORDINARY, PREVIEW], "private")).toEqual({
      ok: true,
      count: 2,
      skippedPreviews: 0,
    });
    expect(updatedIds(stub)).toEqual([ORDINARY, PREVIEW]);
    // Both public render objects of both cards, in the caller's folder.
    expect(removed).toEqual([
      [ORDINARY, PREVIEW].flatMap((id) => [`${USER}/${id}.png`, `${USER}/${id}.thumb.webp`]),
    ]);
  });

  it("the ownership check still refuses the whole batch first", async () => {
    const { stub } = bulkDb([rowOf(ORDINARY, false), rowOf(PREVIEW, true, "someone-else")]);
    const result = await updateCardsVisibilityAction([ORDINARY, PREVIEW], "public");
    expect(result).toEqual({ ok: false, error: "Some cards aren't yours to edit." });
    expect(updates(stub)).toHaveLength(0);
  });

  it("a missing card still refuses the whole batch", async () => {
    const { stub } = bulkDb([rowOf(ORDINARY, false)]);
    const result = await updateCardsVisibilityAction([ORDINARY, PREVIEW], "public");
    expect(result).toEqual({ ok: false, error: "Some cards weren't found." });
    expect(updates(stub)).toHaveLength(0);
  });

  it("before migration 0121 lands (no column) it reads without the flag and carries on", async () => {
    const ordinary = { ...rowOf(ORDINARY, false) } as Record<string, unknown>;
    delete ordinary.frame_preview;
    const { stub } = bulkDb([ordinary], {
      firstReadError: "column cards.frame_preview does not exist",
    });
    expect(await updateCardsVisibilityAction([ORDINARY], "public")).toEqual({
      ok: true,
      count: 1,
      skippedPreviews: 0,
    });
    const reads = stub
      .forTable("cards")
      .filter((entry) => called(entry.calls, "select"))
      .map((entry) => entry.calls.find((c) => c.method === "select")!.args[0] as string);
    expect(reads).toHaveLength(2);
    expect(reads[1]).not.toMatch(/frame_preview/);
    expect(updatedIds(stub)).toEqual([ORDINARY]);
  });

  it("any other read error is returned as itself", async () => {
    state.client = chainClient((): ChainAnswer => ({
      error: { code: "42501", message: "permission denied for table cards" },
    })).client;
    expect(await updateCardsVisibilityAction([ORDINARY], "public")).toEqual({
      ok: false,
      error: "permission denied for table cards",
    });
  });

  it("a card flagged after the read (the CHECK refuses the batch) reads in words", async () => {
    bulkDb([rowOf(ORDINARY, false)], {
      updateError: {
        code: "23514",
        message: 'new row for relation "cards" violates check constraint "cards_frame_preview_private"',
      },
    });
    const result = await updateCardsVisibilityAction([ORDINARY], "public");
    expect(result).toEqual({
      ok: false,
      error: "Frame previews stay private, and nothing was changed — try again and they'll be skipped.",
    });
  });

  it("any other database error on the write still reads as itself", async () => {
    bulkDb([rowOf(ORDINARY, false)], {
      updateError: { code: "42501", message: "permission denied for table cards" },
    });
    expect(await updateCardsVisibilityAction([ORDINARY], "public")).toEqual({
      ok: false,
      error: "permission denied for table cards",
    });
  });
});
