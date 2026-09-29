import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// A remix of someone else's card gets its OWN copy of the parent's pictures
// (lib/cards/remix-media.ts). Migration 0127 lets a user store only their
// own uploads in a picture column, and the creator prefills a remix with the
// parent's art, second-face art and custom watermark — all in the PARENT
// owner's folder. The save copies each (service role, into the remixer's
// folder, counted as one upload) and stores the copy's URL; a picture that
// isn't the parent's is never copied (the database refuses it, and the
// action turns that refusal into a field error).
// ---------------------------------------------------------------------------

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "99999999-9999-4999-8999-999999999999";
const STRANGER = "77777777-7777-4777-8777-777777777777";
const GAME = "33333333-3333-4333-8333-333333333333";
const PARENT = "55555555-5555-4555-8555-555555555555";
const HOST = "https://auth.pipglyph.com";
const art = (owner: string, name: string) => `${HOST}/storage/v1/object/public/card-art/${owner}/${name}`;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const state = vi.hoisted(() => ({
  copies: [] as { from: string; to: string }[],
  copyError: null as null | { message: string },
  limited: false,
  limitChecks: 0,
  parent: null as unknown,
  client: null as unknown,
  insertError: null as null | { message: string; code?: string },
}));

vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        copy: async (from: string, to: string) => {
          state.copies.push({ from: `${bucket}:${from}`, to: `${bucket}:${to}` });
          return state.copyError ? { data: null, error: state.copyError } : { data: { path: to }, error: null };
        },
        getPublicUrl: (key: string) => ({ data: { publicUrl: `${HOST}/storage/v1/object/public/${bucket}/${key}` } }),
      }),
    },
  }),
}));
vi.mock("@/lib/media/upload-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media/upload-rate-limit")>();
  return {
    ...actual,
    checkUploadRateLimit: async () => {
      state.limitChecks += 1;
      return state.limited
        ? { ok: false, code: "UPLOAD_RATE_LIMITED", window: "minute", retryAfterSeconds: 5, message: actual.UPLOAD_TOO_FAST_MESSAGE }
        : { ok: true };
    },
  };
});

import { adoptRemixMedia } from "@/lib/cards/remix-media";

const parentRow = {
  owner_id: THEM,
  art_url: art(THEM, "front.jpg"),
  back_face: { title: "Back", art_url: art(THEM, "back.webp") },
  watermark: { kind: "custom", url: art(THEM, "wm-1.png"), opacity: 0.4 },
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
  state.copies.length = 0;
  state.copyError = null;
  state.limited = false;
  state.limitChecks = 0;
  state.insertError = null;
});

describe("adoptRemixMedia", () => {
  it("copies the parent's art, second-face art and watermark into the remixer's folder and swaps the URLs", async () => {
    const result = await adoptRemixMedia(ME, parentRow, {
      art_url: parentRow.art_url,
      back_face: { title: "Back", art_url: parentRow.back_face.art_url },
      watermark: { kind: "custom", url: parentRow.watermark.url, opacity: 0.4 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(state.copies.map((c) => c.from)).toEqual([
      `card-art:${THEM}/front.jpg`,
      `card-art:${THEM}/back.webp`,
      `card-art:${THEM}/wm-1.png`,
    ]);
    for (const c of state.copies) expect(c.to).toMatch(new RegExp(`^card-art:${ME}/remix-${UUID}\\.(jpg|webp|png)$`));
    const [front, back, wm] = state.copies.map((c) => `${HOST}/storage/v1/object/public/card-art/${c.to.slice("card-art:".length)}`);
    expect(result.art_url).toBe(front);
    expect(result.back_face).toEqual({ title: "Back", art_url: back });
    expect(result.watermark).toEqual({ kind: "custom", url: wm, opacity: 0.4 });
    expect(state.limitChecks).toBe(1); // one save = one upload, however many copies
  });

  it("copies an object once when two slots share it", async () => {
    const result = await adoptRemixMedia(ME, { ...parentRow, back_face: { art_url: parentRow.art_url } }, {
      art_url: parentRow.art_url,
      back_face: { title: "Back", art_url: parentRow.art_url },
      watermark: null,
    });
    expect(state.copies).toHaveLength(1);
    expect(result.ok && result.art_url).toBe(result.ok && result.back_face?.art_url);
  });

  it("leaves the remixer's own uploads, presets and outside values alone — and copies nothing", async () => {
    const data = {
      art_url: art(ME, "mine.jpg"),
      back_face: { title: "Back", art_url: "https://tracker.example/b.png" },
      watermark: { kind: "preset" as const, key: "rose" },
    };
    expect(await adoptRemixMedia(ME, parentRow, data)).toEqual({ ok: true, ...data });
    expect(state.copies).toEqual([]);
    expect(state.limitChecks).toBe(0);
  });

  it("never copies a picture that isn't the parent's, even from our storage", async () => {
    const data = { art_url: art(STRANGER, "theirs.jpg"), back_face: null, watermark: null };
    expect(await adoptRemixMedia(ME, parentRow, data)).toEqual({ ok: true, ...data });
    expect(state.copies).toEqual([]);
  });

  it("a remix of your OWN card copies nothing", async () => {
    const own = { ...parentRow, owner_id: ME, art_url: art(ME, "front.jpg") };
    const data = { art_url: own.art_url, back_face: null, watermark: null };
    expect(await adoptRemixMedia(ME, own, data)).toEqual({ ok: true, ...data });
    expect(state.copies).toEqual([]);
  });

  it("over the upload limit, or when a copy fails, the save is refused", async () => {
    state.limited = true;
    expect(await adoptRemixMedia(ME, parentRow, { art_url: parentRow.art_url, back_face: null, watermark: null })).toEqual({
      ok: false,
      error: "You're uploading too fast — try again in a minute.",
      code: "UPLOAD_RATE_LIMITED",
    });
    expect(state.copies).toEqual([]);
    state.limited = false;
    state.copyError = { message: "Object not found" };
    const failed = await adoptRemixMedia(ME, parentRow, { art_url: parentRow.art_url, back_face: null, watermark: null });
    expect(failed).toMatchObject({ ok: false, error: expect.stringMatching(/copy the original card's artwork/) });
  });
});

// ---------------------------------------------------------------------------
// createCardAction: the remix save stores the copies, and a guard refusal
// from the database comes back as a field error.
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: ME }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: ME, is_admin: false }),
}));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => ["m15/w"] }));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.parent,
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
    table === "cards"
      ? state.insertError
        ? { data: null, error: state.insertError }
        : { data: { id: PARENT, slug: "remix" }, error: null }
      : { error: null },
  );
  state.client = stub.client;
  return stub;
}

const remixPayload = {
  title: "Remix",
  game_system_id: GAME,
  card_type: "creature",
  color_identity: ["white"],
  subtypes: [],
  frame_style: { template: "m15" },
  visibility: "public",
  parent_card_id: PARENT,
  art_url: art(THEM, "front.jpg"),
};

describe("createCardAction — a remix", () => {
  it("inserts the remixer's copy of the parent's art, never the parent's object", async () => {
    state.parent = { id: PARENT, ...parentRow };
    const stub = db();
    const result = await createCardAction(remixPayload as never);
    expect(result).toMatchObject({ ok: true });
    const insertCall = stub.forTable("cards").find((entry) => entry.calls.some((c) => c.method === "insert"))!;
    const insert = payloadOf(insertCall.calls, "insert") as Record<string, string>;
    expect(insert.art_url).toMatch(new RegExp(`^${HOST}/storage/v1/object/public/card-art/${ME}/remix-${UUID}\\.jpg$`));
    expect(state.copies.map((c) => c.from)).toEqual([`card-art:${THEM}/front.jpg`]);
  });

  it("the database's refusal of someone else's picture becomes a field error", async () => {
    state.parent = { id: PARENT, ...parentRow };
    state.insertError = {
      code: "42501",
      message: "media_url_not_allowed: cards.art_url must be one of your own uploads",
    };
    db();
    const result = await createCardAction({ ...remixPayload, art_url: art(STRANGER, "theirs.jpg") } as never);
    expect(result).toEqual({
      ok: false,
      fieldErrors: { art_url: "That picture isn't one of your uploads — upload it again and save." },
    });
    expect(state.copies).toEqual([]);
  });

  it("…on an edit too (the second face's art)", async () => {
    state.parent = { id: PARENT, owner_id: ME, slug: "mine", visibility: "private", frame_style: { template: "m15" }, color_identity: ["white"], card_type: "creature" };
    state.insertError = {
      code: "42501",
      message: "media_url_not_allowed: cards.back_face art_url must be one of your own uploads",
    };
    db();
    const result = await updateCardAction(PARENT, { back_face: { title: "B", art_url: art(STRANGER, "b.jpg") } } as never);
    expect(result).toMatchObject({ ok: false, fieldErrors: { "back_face.art_url": expect.stringMatching(/isn't one of your uploads/) } });
  });
});
