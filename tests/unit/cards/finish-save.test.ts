import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// Foil and etched finishes, end to end on the server side (TODO 6.5, owner
// decision 2026-09-26: shipped, free on every plan):
//   * a FREE account saves a foil / etched card on a verified frame — the
//     finish is not a premium feature, and the frame gate is per template +
//     colour (frame_reviews), never per finish;
//   * the stored frame_style round-trips into the editor, a remix and the
//     preview/bake data;
//   * an edit never carries frame_style (the finish is locked structure);
//   * a fresh bake is stamped current, so a new foil/etched card gets no
//     "newer look" badge and owes no sweep (v26 etched / v28 foil scopes).
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const GAME = "22222222-2222-4222-8222-222222222222";
const CARD_ID = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  client: null as unknown,
  verified: [] as string[],
  entitlements: {
    tier: "free",
    effectiveTier: "free",
    isPaid: false,
    status: null,
    credits: 5,
    removeWatermark: false,
    maxExportPreset: "default",
    allowBatchExport: false,
    premiumFrames: false,
    cardCapacity: 50,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
  isAdminConfigured: () => false,
}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () => state.verified,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => state.entitlements,
}));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => null,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn() }));
vi.mock("@/lib/decks/membership", () => ({ addCustomCardEntryToDeck: vi.fn() }));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCard: vi.fn(),
  purgeHiddenCards: vi.fn(),
  revalidateCardListSurfaces: vi.fn(),
  revalidateCardPaths: vi.fn(),
}));
vi.mock("@/lib/profile/username", () => ({ lookupUsername: async () => "tester" }));

import { createCardAction } from "@/lib/cards/actions";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { defaultValuesFor, remixValuesFrom } from "@/lib/creator/card-fields";
import { pickRevisablePayload } from "@/lib/creator/revise";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import {
  CARD_LAYOUT_VERSION,
  classifyForSweep,
  hasNewerLook,
  hasPendingCorrection,
  storedLookIsOlder,
} from "@/lib/cards/layout-version";
import type { Card, CardFinish } from "@/types/card";

/** A database that accepts the insert and hands back the new row's id. */
function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && called(calls, "insert")) {
      return { data: { id: CARD_ID, slug: "sunforged-paladin" }, error: null };
    }
    // The capacity pre-check (`select id, count exact, head`).
    return { data: null, error: null, count: 0 };
  });
  state.client = stub.client;
  return stub;
}

/** What the creator sends for a new white m15 creature in `finish` (the
 *  same frame_style object the form holds: runSubmit passes it through). */
function payload(finish: CardFinish) {
  const values = defaultValuesFor(null, []);
  return {
    title: "Sunforged Paladin",
    game_system_id: GAME,
    cost: "{2}{W}{W}",
    color_identity: ["white"],
    card_type: "creature",
    subtypes: ["Human", "Knight"],
    rarity: "rare",
    rules_text: "Vigilance",
    power: "4",
    toughness: "4",
    art_url: "https://example.com/art.png",
    art_position: values.art_position,
    frame_style: { ...values.frame_style, finish },
    visibility: "public",
  };
}

function insertOf(stub: ReturnType<typeof db>) {
  const insert = stub.forTable("cards").find((e) => called(e.calls, "insert"));
  return payloadOf(insert?.calls ?? [], "insert") as Record<string, unknown> | undefined;
}

/** The row the insert stored, as the editor / gallery read it back. */
function storedRow(frameStyle: unknown, over: Partial<Card> = {}): Card {
  return {
    id: CARD_ID,
    owner_id: USER,
    title: "Sunforged Paladin",
    slug: "sunforged-paladin",
    game_system_id: GAME,
    cost: "{2}{W}{W}",
    color_identity: ["white"],
    supertype: null,
    card_type: "creature",
    subtypes: ["Human", "Knight"],
    tags: [],
    rarity: "rare",
    rules_text: "Vigilance",
    flavor_text: null,
    power: "4",
    toughness: "4",
    loyalty: null,
    defense: null,
    artist_credit: null,
    art_url: "https://example.com/art.png",
    art_position: {},
    frame_style: frameStyle,
    visibility: "public",
    ...over,
  } as unknown as Card;
}

beforeEach(() => {
  state.verified = [frameComboKey("m15", "w")];
  state.entitlements = { ...state.entitlements, premiumFrames: false, tier: "free", effectiveTier: "free" };
});

describe("saving a finish (free account, verified frame)", () => {
  it.each(["foil", "etched"] as const)("saves a card in %s with the finish stored on frame_style", async (finish) => {
    const stub = db();
    const result = await createCardAction(payload(finish));
    expect(result).toEqual({ ok: true, cardId: CARD_ID, slug: "sunforged-paladin" });
    expect(insertOf(stub)?.frame_style).toEqual({ finish, template: "m15" });
  });

  it("gates on the frame, not the finish: an unverified colour is refused in foil exactly as in regular", async () => {
    state.verified = [frameComboKey("m15", "u")];
    for (const finish of ["regular", "foil"] as const) {
      const stub = db();
      const result = await createCardAction(payload(finish));
      expect(result.ok, finish).toBe(false);
      if (!result.ok) {
        expect(result.code, finish).toBeUndefined();
        expect(result.fieldErrors?.frame_style, finish).toMatch(/isn't available in white yet/);
      }
      expect(insertOf(stub), finish).toBeUndefined();
    }
  });

  it("still rejects a finish that doesn't exist", async () => {
    const stub = db();
    const result = await createCardAction({
      ...payload("foil"),
      frame_style: { finish: "rainbow", template: "m15" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.frame_style).toBeTruthy();
    expect(insertOf(stub)).toBeUndefined();
  });
});

describe("a saved foil card round-trips", () => {
  it("into the editor, a remix and the preview/bake data; an edit never sends it", async () => {
    const stub = db();
    await createCardAction(payload("foil"));
    const row = storedRow(insertOf(stub)?.frame_style);

    const edit = defaultValuesFor(row, []);
    expect(edit.frame_style).toEqual({ finish: "foil", template: "m15" });
    expect(remixValuesFrom(row, []).frame_style.finish).toBe("foil");
    expect(cardToPreviewData(row).frameStyle).toEqual({ finish: "foil", template: "m15" });

    // Edit mode: the finish is locked structure — the payload has no key to
    // change it with, so the update action leaves the stored finish alone.
    const editPayload = pickRevisablePayload({ ...payload("regular"), title: "Renamed" });
    expect(editPayload).not.toHaveProperty("frame_style");
  });
});

describe("a freshly baked foil / etched card", () => {
  it.each(["foil", "etched"] as const)("is current: no newer-look badge, no pending sweep (%s)", (finish) => {
    const baked = {
      visibility: "public",
      layout_version: CARD_LAYOUT_VERSION,
      rendered_image_url: "https://example.com/render.png",
      frame_style: { finish, template: "m15" },
      rarity: "rare",
      set_icon_url: null,
      set_icon_code: null,
    };
    expect(classifyForSweep(baked)).toBe("current");
    expect(hasNewerLook(baked)).toBe(false);
    expect(hasPendingCorrection(baked)).toBe(false);
    expect(storedLookIsOlder(baked)).toBe(false);
  });
});
