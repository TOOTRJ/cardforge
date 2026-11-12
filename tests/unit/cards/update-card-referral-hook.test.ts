import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// An EDIT that puts a NEW PICTURE on a card runs the referral step (owner
// 2026-11-11, migration 0208). A referral qualifies on the friend's cards
// WITH ARTWORK OF THEIR OWN, each picture once (the database's
// `referral_qualifying_cards`), so the save that meets the bar can be an
// edit: a card saved without art and given its picture afterwards. The
// creation hook never sees that save, and the hourly sweep would be late for
// a friend near the end of their window.
//
// updateCardAction therefore schedules `qualifyReferral(admin, <the maker>,
// { stripe })` AFTER the response (next/server `after`) — only when the edit
// sets a new, non-empty `art_url`:
//
//   a new picture            the step runs, once, for the maker;
//   the same picture again   nothing (the editor resends every field);
//   the picture removed      nothing (null, or sent empty);
//   no art_url in the edit   nothing;
//   an admin's frame preview nothing — tooling, never a card made;
//   no admin client          nothing (the step is the service role's).
//
// The step can never fail the save: it runs after the answer, and whatever
// it throws is logged and swallowed — the deferred bake still runs.
// What qualifyReferral itself does is tests/unit/referrals/server.test.ts.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "99999999-9999-4999-8999-999999999999";
const CARD = "22222222-2222-4222-8222-222222222222";
const ART = `https://storage.test/storage/v1/object/public/card-art/${USER}/first.png`;
const NEW_ART = `https://storage.test/storage/v1/object/public/card-art/${USER}/second.png`;

const state = vi.hoisted(() => ({
  existing: null as unknown,
  client: null as unknown,
  adminConfigured: true,
  stripeConfigured: false,
  /** What the row write answers; null = saved. */
  updateError: null as null | { message: string },
  /** The callbacks handed to `after()`, in order. */
  deferred: [] as Array<() => Promise<void> | void>,
  /** What happened, in order. */
  order: [] as string[],
}));
const hook = vi.hoisted(() => ({
  qualifyReferral: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  createAdminClient: vi.fn<() => unknown>(),
  /** Stand-ins the step is handed: identity is what the tests compare. */
  adminClient: { name: "the service-role client" },
  stripeClient: { name: "the Stripe client" },
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: hook.createAdminClient,
  isAdminConfigured: () => state.adminConfigured,
}));
vi.mock("@/lib/stripe/client", () => ({
  isStripeConfigured: () => state.stripeConfigured,
  getStripe: () => hook.stripeClient,
}));
vi.mock("@/lib/referrals/server", () => ({ qualifyReferral: hook.qualifyReferral }));
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
  revalidateCardPaths: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void> | void) => void state.deferred.push(fn) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { updateCardAction } from "@/lib/cards/actions";

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
    art_url: ART,
    art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    // A draft: no rule about what a public card needs is in play here.
    visibility: "private",
    back_face: null,
    back_card_id: null,
    frame_preview: false,
    frame_style: { template: "saga", finish: "regular" },
    rendered_image_url: null,
    rendered_thumb_url: null,
    rendered_back_image_url: null,
    rendered_back_thumb_url: null,
    rendered_at: null,
    layout_version: null,
    ...over,
  };
}

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && called(calls, "update")) {
      state.order.push("update");
      return state.updateError ? { data: null, error: state.updateError } : { data: { id: CARD, slug: "the-long-night" }, error: null };
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

/** Everything `after()` was handed, run in order — as Next does once the
 *  response is out. A callback that throws would reject here. */
async function runDeferred() {
  for (const fn of state.deferred) await fn();
}

beforeEach(() => {
  state.existing = stored();
  state.adminConfigured = true;
  state.stripeConfigured = false;
  state.updateError = null;
  state.deferred.length = 0;
  state.order.length = 0;
  hook.qualifyReferral.mockReset().mockImplementation(async () => {
    state.order.push("referral step");
    return { status: "none" };
  });
  hook.createAdminClient.mockReset().mockImplementation(() => hook.adminClient);
});

describe("updateCardAction — a new picture runs the referral step, after the response", () => {
  it("a NEW picture on a card that had another: the step is scheduled, and runs once for the maker with the service-role client", async () => {
    const stub = db();
    const result = await updateCardAction(CARD, { art_url: NEW_ART });
    expect(result).toEqual({ ok: true, cardId: CARD, slug: "the-long-night" });
    expect(updatesOf(stub)).toHaveLength(1);
    expect(updatesOf(stub)[0]).toMatchObject({ art_url: NEW_ART });
    // Nothing of it ran inside the request: the save does not wait for it.
    expect(hook.qualifyReferral).not.toHaveBeenCalled();
    expect(hook.createAdminClient).not.toHaveBeenCalled();
    expect(state.order).toEqual(["update"]);
    // Two callbacks wait: the referral step, then the bake.
    expect(state.deferred).toHaveLength(2);

    await runDeferred();
    expect(hook.qualifyReferral.mock.calls).toEqual([[hook.adminClient, USER, { stripe: null }]]);
    expect(hook.createAdminClient).toHaveBeenCalledTimes(1);
    expect(state.order).toEqual(["update", "referral step", "bake"]);
  });

  it("the FIRST picture on a card saved without one — the save that can meet a referral's bar", async () => {
    state.existing = stored({ art_url: null });
    db();
    expect((await updateCardAction(CARD, { art_url: NEW_ART })).ok).toBe(true);
    await runDeferred();
    expect(hook.qualifyReferral.mock.calls).toEqual([[hook.adminClient, USER, { stripe: null }]]);
    // …and one stored with an empty picture is the same card.
    hook.qualifyReferral.mockClear();
    state.deferred.length = 0;
    state.existing = stored({ art_url: "" });
    db();
    expect((await updateCardAction(CARD, { art_url: NEW_ART })).ok).toBe(true);
    await runDeferred();
    expect(hook.qualifyReferral).toHaveBeenCalledTimes(1);
  });

  it("a new picture among other edited fields is still a new picture", async () => {
    db();
    const result = await updateCardAction(CARD, {
      art_url: NEW_ART,
      art_position: { focalX: 0.2, focalY: 0.8, scale: 1.4 },
      artist_credit: "B. Painter",
    });
    expect(result.ok).toBe(true);
    await runDeferred();
    expect(hook.qualifyReferral.mock.calls).toEqual([[hook.adminClient, USER, { stripe: null }]]);
  });

  it("the step is handed the Stripe client only where Stripe is configured (its same-card check), else null", async () => {
    state.stripeConfigured = true;
    db();
    await updateCardAction(CARD, { art_url: NEW_ART });
    await runDeferred();
    expect(hook.qualifyReferral.mock.calls).toEqual([[hook.adminClient, USER, { stripe: hook.stripeClient }]]);
  });

  it("the maker is the signed-in user who owns the card — the id the step is given is theirs, never the card's", async () => {
    db();
    await updateCardAction(CARD, { art_url: NEW_ART });
    await runDeferred();
    const [, refereeId] = hook.qualifyReferral.mock.calls[0];
    expect(refereeId).toBe(USER);
    expect(refereeId).not.toBe(CARD);
  });

  it("every edit with a new picture runs it again: the step itself is what makes a second run a no-op", async () => {
    db();
    await updateCardAction(CARD, { art_url: NEW_ART });
    state.existing = stored({ art_url: NEW_ART });
    await updateCardAction(CARD, { art_url: ART });
    await runDeferred();
    expect(hook.qualifyReferral).toHaveBeenCalledTimes(2);
  });
});

describe("updateCardAction — an edit that puts no new picture on the card never runs the step", () => {
  const moved = { focalX: 1, focalY: 0.5, scale: 1.3 };

  it.each<[string, Record<string, unknown>]>([
    ["the same picture re-sent alone", { art_url: ART }],
    ["the same picture re-sent with every other field the editor resends", { art_url: ART, art_position: moved, artist_credit: "B. Painter", rules_text: "Draw a card." }],
    ["the picture removed (null)", { art_url: null }],
    ["the picture removed (null) beside another change", { art_url: null, artist_credit: "B. Painter" }],
    ["the picture sent empty", { art_url: "", artist_credit: "B. Painter" }],
    ["an edit with no art_url key: the art moved", { art_position: moved }],
    ["an edit with no art_url key: a text changed", { artist_credit: "B. Painter" }],
  ])("%s", async (_name, patch) => {
    const stub = db();
    const result = await updateCardAction(CARD, patch);
    expect(result.ok).toBe(true);
    expect(updatesOf(stub)).toHaveLength(1);
    // Only the bake waits.
    expect(state.deferred).toHaveLength(1);
    await runDeferred();
    expect(hook.qualifyReferral).not.toHaveBeenCalled();
    expect(hook.createAdminClient).not.toHaveBeenCalled();
    expect(state.order).toEqual(["update", "bake"]);
  });

  it("a card that never had a picture, edited without one: nothing", async () => {
    state.existing = stored({ art_url: null });
    for (const patch of [{ artist_credit: "B. Painter" }, { art_url: null, artist_credit: "B. Painter" }]) {
      db();
      expect((await updateCardAction(CARD, patch)).ok).toBe(true);
    }
    await runDeferred();
    expect(hook.qualifyReferral).not.toHaveBeenCalled();
  });

  it("an admin's FRAME PREVIEW is tooling, not a card made: a new picture on one runs nothing", async () => {
    state.existing = stored({ frame_preview: true });
    const stub = db();
    const result = await updateCardAction(CARD, { art_url: NEW_ART });
    expect(result.ok).toBe(true);
    // The edit itself is saved — with its new picture.
    expect(updatesOf(stub)[0]).toMatchObject({ art_url: NEW_ART });
    expect(state.deferred).toHaveLength(1);
    await runDeferred();
    expect(hook.qualifyReferral).not.toHaveBeenCalled();
    expect(hook.createAdminClient).not.toHaveBeenCalled();
  });

  it("no service-role client configured: the step is not scheduled, and no client is asked for", async () => {
    state.adminConfigured = false;
    const stub = db();
    const result = await updateCardAction(CARD, { art_url: NEW_ART });
    expect(result).toEqual({ ok: true, cardId: CARD, slug: "the-long-night" });
    expect(updatesOf(stub)[0]).toMatchObject({ art_url: NEW_ART });
    expect(state.deferred).toHaveLength(1);
    await runDeferred();
    expect(hook.qualifyReferral).not.toHaveBeenCalled();
    expect(hook.createAdminClient).not.toHaveBeenCalled();
  });

  it("an edit that is NOT saved schedules nothing: the database refused the write, or the card is not the caller's", async () => {
    state.updateError = { message: "connection reset" };
    db();
    const refused = await updateCardAction(CARD, { art_url: NEW_ART });
    expect(refused.ok).toBe(false);
    expect(state.deferred).toEqual([]);

    state.updateError = null;
    state.existing = stored({ owner_id: OTHER_USER });
    const stub = db();
    const notMine = await updateCardAction(CARD, { art_url: NEW_ART });
    expect(notMine.ok).toBe(false);
    expect(updatesOf(stub)).toEqual([]);
    expect(state.deferred).toEqual([]);

    // A patch the schema refuses (a picture that is no https address).
    db();
    const invalid = await updateCardAction(CARD, { art_url: "javascript:alert(1)" });
    expect(invalid.ok).toBe(false);
    expect(state.deferred).toEqual([]);

    await runDeferred();
    expect(hook.qualifyReferral).not.toHaveBeenCalled();
    expect(hook.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("updateCardAction — the referral step can never fail the save", () => {
  it("a step that REJECTS: the save's answer is unchanged, the failure is logged with the maker's id, and the bake still runs", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      hook.qualifyReferral.mockReset().mockRejectedValue(new Error("the claim timed out"));
      const stub = db();
      const result = await updateCardAction(CARD, { art_url: NEW_ART });
      // Answered before the step ran, and exactly as a save with no referral.
      expect(result).toEqual({ ok: true, cardId: CARD, slug: "the-long-night" });
      expect(updatesOf(stub)).toHaveLength(1);
      // The deferred callback swallows the failure: nothing rejects.
      await expect(runDeferred()).resolves.toBeUndefined();
      expect(hook.qualifyReferral).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
      const [message, cause] = error.mock.calls[0];
      expect(String(message)).toContain("[referrals]");
      expect(String(message)).toContain(USER);
      expect(cause).toBeInstanceOf(Error);
      expect((cause as Error).message).toBe("the claim timed out");
      // The card's own deferred work is untouched.
      expect(state.order).toEqual(["update", "bake"]);
      // No second write to the card because of it.
      expect(updatesOf(stub)).toHaveLength(1);
    } finally {
      error.mockRestore();
    }
  });

  it("a step that THROWS at once, and a service-role client that cannot be made: the same — logged, swallowed, the bake runs", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      hook.qualifyReferral.mockReset().mockImplementation(() => {
        throw new Error("sync failure");
      });
      db();
      expect((await updateCardAction(CARD, { art_url: NEW_ART })).ok).toBe(true);
      await expect(runDeferred()).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
      expect(state.order).toEqual(["update", "bake"]);

      state.deferred.length = 0;
      state.order.length = 0;
      hook.qualifyReferral.mockReset().mockResolvedValue({ status: "none" });
      hook.createAdminClient.mockReset().mockImplementation(() => {
        throw new Error("SUPABASE_SECRET_KEY is missing");
      });
      db();
      expect(await updateCardAction(CARD, { art_url: NEW_ART })).toEqual({ ok: true, cardId: CARD, slug: "the-long-night" });
      await expect(runDeferred()).resolves.toBeUndefined();
      expect(hook.qualifyReferral).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(2);
      expect(state.order).toEqual(["update", "bake"]);
    } finally {
      error.mockRestore();
    }
  });

  it("whatever the step answers — rewarded, waiting, expired — the save's answer is the same", async () => {
    for (const answer of [{ status: "rewarded", step: 1 }, { status: "waiting", reason: "not_qualified" }, { status: "expired" }, undefined]) {
      state.deferred.length = 0;
      hook.qualifyReferral.mockReset().mockResolvedValue(answer);
      db();
      expect(await updateCardAction(CARD, { art_url: NEW_ART })).toEqual({ ok: true, cardId: CARD, slug: "the-long-night" });
      await expect(runDeferred()).resolves.toBeUndefined();
      expect(hook.qualifyReferral).toHaveBeenCalledTimes(1);
    }
  });
});
