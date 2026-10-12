import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 4.21e — the text alignment through the card ACTIONS, on the real
// profiles (the holo-stamp-save pattern; tests/unit/cards/rules-align.test.ts
// holds the pure rules). The round trip, save path by save path:
//   • createCardAction — the one insert behind the creator, a remix, the
//     import and every AI job — stores `rulesAlign: "center"` where the saved
//     template offers the choice, NEVER "left" and never a default, and no
//     key on a walker frame, the saga or a textless frame;
//   • updateCardAction never touches a stored card's frame_style unless the
//     payload names it; a locked card changes its alignment through
//     `frame_anatomy` alone — "center" sets the key, "left" REMOVES it, and
//     nothing else in the stored style moves;
//   • the schemas refuse every value but the two — a crafted "right" or
//     "justify" writes nothing;
//   • a remix keeps its parent's, an import stays left.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";
// Every edit also stops pointing at the stored bake, in the same write
// (lib/cards/bake-core.ts REBAKE_PENDING_RENDER; rebake-pending-save.test.ts).
const REBAKE_PENDING = {
  rendered_image_url: null,
  rendered_thumb_url: null,
  rendered_back_image_url: null,
  rendered_back_thumb_url: null,
  rendered_at: null,
  layout_version: null,
};


const state = vi.hoisted(() => ({
  verified: [] as string[],
  existing: null as unknown,
  client: null as unknown,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminConfigured: () => false }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => state.verified }));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.existing,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ premiumFrames: true, removeWatermark: false, cardCapacity: -1 }),
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
import { importedAnatomy, importedFormAnatomy } from "@/lib/cards/anatomy";
import { defaultValuesFor, remixValuesFrom } from "@/lib/creator/card-fields";
import { frameAnatomyPatchFor } from "@/lib/creator/revise";
import type { Card } from "@/types/card";

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && (called(calls, "insert") || called(calls, "update"))) {
      return { data: { id: CARD, slug: "kesh" }, error: null };
    }
    return { data: null, error: null, count: 0 };
  });
  state.client = stub.client;
  return stub;
}

const written = (stub: ReturnType<typeof db>, op: "insert" | "update") => {
  const entry = stub.forTable("cards").find((e) => called(e.calls, op));
  return payloadOf(entry?.calls ?? [], op) as Record<string, unknown> | undefined;
};
const styleOf = (stub: ReturnType<typeof db>, op: "insert" | "update") =>
  written(stub, op)?.frame_style as Record<string, unknown> | undefined;

function payload(over: Record<string, unknown> = {}) {
  return {
    title: "Kesh, Emberforge Warden",
    game_system_id: GAME,
    cost: "{2}{R}{R}",
    color_identity: ["red"],
    card_type: "creature",
    rarity: "rare",
    power: "3",
    toughness: "4",
    rules_text: "Flying\nWhen Kesh enters, draw a card.",
    art_url: "https://example.com/art.png",
    visibility: "unlisted",
    ...over,
  };
}

function stored(over: Record<string, unknown> = {}) {
  return {
    id: CARD,
    owner_id: USER,
    title: "Kesh",
    slug: "kesh",
    game_system_id: GAME,
    cost: "{2}{R}{R}",
    color_identity: ["red"],
    card_type: "creature",
    rarity: "rare",
    supertype: null,
    subtypes: [],
    tags: [],
    rules_text: "Flying",
    flavor_text: null,
    power: "3",
    toughness: "4",
    loyalty: null,
    defense: null,
    artist_credit: "A. Painter",
    art_position: {},
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: null,
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content: null,
    watermark: null,
    footer_text: null,
    set_code: null,
    collector_number: null,
    lang: "en",
    frame_preview: false,
    frame_style: { template: "m15", finish: "regular" },
    ...over,
  };
}

beforeEach(() => {
  state.verified = ["m15/r", "m15/c", "m15borderless/r", "saga/r", "m15pw/r", "m15token/r", "m15tokentext/r", "m20token/r", "emblem/c", "modern/r", "retro/r", "m15land/c", "split/r"];
  state.existing = null;
});

describe("createCardAction — a new card starts left, and stores \"center\" only", () => {
  it("no payload key → no stored key (the creator, an import, every AI job)", async () => {
    for (const frame_style of [{ template: "m15" }, { template: "m15", crown: true, collector: "2023" }, undefined]) {
      const stub = db();
      const result = await createCardAction(payload(frame_style ? { frame_style } : {}));
      expect(result.ok, JSON.stringify(frame_style)).toBe(true);
      const style = styleOf(stub, "insert") ?? {};
      expect("rulesAlign" in style, JSON.stringify(frame_style)).toBe(false);
    }
  });

  it("the form's \"left\" is never stored; \"center\" is, where the frame offers the choice", async () => {
    const left = db();
    expect((await createCardAction(payload({ frame_style: { template: "m15", rulesAlign: "left" } }))).ok).toBe(true);
    expect("rulesAlign" in styleOf(left, "insert")!).toBe(false);

    for (const [template, cardType] of [
      ["m15", "creature"],
      ["m15borderless", "creature"],
      ["modern", "creature"],
      ["retro", "creature"],
      ["m15tokentext", "token"],
      ["m15token", "token"],
      ["emblem", "emblem"],
    ] as const) {
      const stub = db();
      const over: Record<string, unknown> = { card_type: cardType, frame_style: { template, rulesAlign: "center" } };
      if (cardType === "emblem") Object.assign(over, { cost: "", color_identity: [], power: undefined, toughness: undefined });
      if (cardType === "token") Object.assign(over, { supertype: "Creature", rarity: "common" });
      const result = await createCardAction(payload(over));
      expect(result.ok, `${template}: ${JSON.stringify(result)}`).toBe(true);
      expect(styleOf(stub, "insert")?.rulesAlign, template).toBe("center");
    }
  });

  it("a walker frame, the saga and a textless frame store no key, whatever the payload says", async () => {
    for (const [template, cardType] of [
      ["m15pw", "planeswalker"],
      ["saga", "enchantment"],
      ["m20token", "token"],
    ] as const) {
      const stub = db();
      const over: Record<string, unknown> = { card_type: cardType, frame_style: { template, rulesAlign: "center" } };
      if (cardType === "token") Object.assign(over, { supertype: "Creature", rarity: "common", rules_text: undefined });
      if (cardType === "planeswalker") Object.assign(over, { power: undefined, toughness: undefined, loyalty: "4" });
      if (cardType === "enchantment") Object.assign(over, { power: undefined, toughness: undefined });
      const result = await createCardAction(payload(over));
      expect(result.ok, `${template}: ${JSON.stringify(result)}`).toBe(true);
      expect("rulesAlign" in styleOf(stub, "insert")!, template).toBe(false);
    }
  });

  it.each([
    ["\"right\"", { rulesAlign: "right" }],
    ["\"justify\"", { rulesAlign: "justify" }],
    ["\"Center\"", { rulesAlign: "Center" }],
    ["\"centre\"", { rulesAlign: "centre" }],
    ["true", { rulesAlign: true }],
    ["null", { rulesAlign: null }],
    ["1", { rulesAlign: 1 }],
    ["an object", { rulesAlign: { align: "center" } }],
    ["an array", { rulesAlign: ["center"] }],
    ["an unknown key beside it", { rulesAlign: "center", rulesAlignSecond: "left" }],
  ])("refuses rulesAlign %s and writes nothing", async (_name, bad) => {
    const stub = db();
    const result = await createCardAction(payload({ frame_style: { template: "m15", ...bad } }));
    expect(result.ok).toBe(false);
    expect(written(stub, "insert")).toBeUndefined();
  });
});

describe("updateCardAction — the edit's round trip", () => {
  it("an unrelated edit of a centred card writes no frame_style: the key stays as stored", async () => {
    const card = stored({ frame_style: { template: "m15", finish: "regular", rulesAlign: "center" } });
    state.existing = card;
    const values = defaultValuesFor(card as unknown as Card, []);
    expect(values.frame_style.rulesAlign).toBe("center");
    const patch = frameAnatomyPatchFor(card as unknown as Card, values);
    expect(patch).toBeUndefined();
    const stub = db();
    const result = await updateCardAction(CARD, { title: "Kesh the Second", rules_text: "Flying, haste", frame_anatomy: patch });
    expect(result.ok).toBe(true);
    expect(written(stub, "update")).not.toHaveProperty("frame_style");
  });

  it("an unrelated edit of a left card (no key) writes no frame_style either", async () => {
    const card = stored();
    state.existing = card;
    const values = defaultValuesFor(card as unknown as Card, []);
    expect("rulesAlign" in values.frame_style).toBe(false);
    expect(frameAnatomyPatchFor(card as unknown as Card, values)).toBeUndefined();
    // …and the control's "Left" on a card that is already left is no change.
    expect(frameAnatomyPatchFor(card as unknown as Card, { ...values, frame_style: { ...values.frame_style, rulesAlign: "left" } })).toBeUndefined();
  });

  it("Left → Centred: the editor's patch is the alignment alone, and only that key is added", async () => {
    const card = stored({ frame_style: { template: "m15", finish: "foil", collector: "2023", stamp: "none" } });
    state.existing = card;
    const values = defaultValuesFor(card as unknown as Card, []);
    const patch = frameAnatomyPatchFor(card as unknown as Card, { ...values, frame_style: { ...values.frame_style, rulesAlign: "center" } });
    expect(patch).toEqual({ rulesAlign: "center" });
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: patch });
    expect(result.ok).toBe(true);
    expect(written(stub, "update")).toEqual({
      frame_style: { template: "m15", finish: "foil", collector: "2023", stamp: "none", rulesAlign: "center" },
      ...REBAKE_PENDING,
    });
  });

  it("Centred → Left REMOVES the key, and nothing else moves", async () => {
    const card = stored({ frame_style: { template: "m15", finish: "foil", collector: "2023", rulesAlign: "center" } });
    state.existing = card;
    const values = defaultValuesFor(card as unknown as Card, []);
    const patch = frameAnatomyPatchFor(card as unknown as Card, { ...values, frame_style: { ...values.frame_style, rulesAlign: "left" } });
    expect(patch).toEqual({ rulesAlign: "left" });
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: patch });
    expect(result.ok).toBe(true);
    expect(written(stub, "update")).toEqual({ frame_style: { template: "m15", finish: "foil", collector: "2023" }, ...REBAKE_PENDING });
    // The form with the key cleared (undefined) asks for the same.
    expect(
      frameAnatomyPatchFor(card as unknown as Card, { ...values, frame_style: { ...values.frame_style, rulesAlign: undefined } }),
    ).toEqual({ rulesAlign: "left" });
  });

  it("a flip on a frame without the choice stores no key (a crafted patch on a walker, the saga, a textless token)", async () => {
    for (const [template, cardType] of [
      ["m15pw", "planeswalker"],
      ["saga", "enchantment"],
      ["m20token", "token"],
    ] as const) {
      state.existing = stored({ card_type: cardType, frame_style: { template, finish: "regular" } });
      const stub = db();
      const result = await updateCardAction(CARD, { frame_anatomy: { rulesAlign: "center" } });
      expect(result.ok, template).toBe(true);
      expect(styleOf(stub, "update"), template).toEqual({ template, finish: "regular" });
    }
  });

  it("a stray stored key on a frame without the choice is dropped by the next switch flip, never kept", async () => {
    state.existing = stored({ card_type: "planeswalker", frame_style: { template: "m15pw", rulesAlign: "center" } });
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: { stamp: "none" } });
    expect(result.ok).toBe(true);
    expect(styleOf(stub, "update")).toEqual({ template: "m15pw", stamp: "none" });
  });

  it("a stored value that is not \"center\" (a row written past the actions) is dropped by the next switch flip", async () => {
    for (const bad of ["right", "justify", "left", true]) {
      state.existing = stored({ frame_style: { template: "m15", rulesAlign: bad } });
      const stub = db();
      const result = await updateCardAction(CARD, { frame_anatomy: { stamp: "none" } });
      expect(result.ok, String(bad)).toBe(true);
      expect(styleOf(stub, "update"), String(bad)).toEqual({ template: "m15", stamp: "none" });
      // …and the editor opens it on Left.
      expect("rulesAlign" in defaultValuesFor(state.existing as Card, []).frame_style, String(bad)).toBe(false);
    }
  });

  it.each([
    ["\"right\"", { rulesAlign: "right" }],
    ["\"justify\"", { rulesAlign: "justify" }],
    ["true", { rulesAlign: true }],
    ["null", { rulesAlign: null }],
    ["a template beside it", { rulesAlign: "center", template: "saga" }],
  ])("refuses a crafted frame_anatomy with rulesAlign %s and writes nothing", async (_name, bad) => {
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: bad });
    expect(result.ok).toBe(false);
    expect(written(stub, "update")).toBeUndefined();
  });

  it("a whole frame_style (a non-revise update): \"left\" is dropped, a move to a frame without the choice drops \"center\"", async () => {
    state.existing = stored({ frame_style: { template: "m15", rulesAlign: "center" } });
    const left = db();
    expect((await updateCardAction(CARD, { frame_style: { template: "m15", rulesAlign: "left" } })).ok).toBe(true);
    expect(styleOf(left, "update")).toEqual({ template: "m15" });

    state.existing = stored({ card_type: "enchantment", power: null, toughness: null, frame_style: { template: "m15", rulesAlign: "center" } });
    const saga = db();
    const moved = await updateCardAction(CARD, { frame_style: { template: "saga", rulesAlign: "center" } });
    expect(moved.ok, JSON.stringify(moved)).toBe(true);
    expect(styleOf(saga, "update")).toEqual({ template: "saga" });
  });
});

describe("a remix keeps its parent's; an import stays left", () => {
  it("the remix form opens on the parent's alignment and createCardAction stores it", async () => {
    for (const [parentStyle, expected] of [
      [{ template: "m15", finish: "regular" }, undefined],
      [{ template: "m15", rulesAlign: "center" }, "center"],
    ] as const) {
      const parent = stored({ frame_style: parentStyle }) as unknown as Card;
      const values = remixValuesFrom(parent, []);
      expect(values.frame_style.rulesAlign, JSON.stringify(parentStyle)).toBe(expected);
      state.existing = parent;
      const stub = db();
      const result = await createCardAction(payload({ frame_style: values.frame_style, parent_card_id: CARD }));
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(styleOf(stub, "insert")?.rulesAlign, JSON.stringify(parentStyle)).toBe(expected);
    }
  });

  it("an import names no alignment: the form's key is cleared and the save stores none", async () => {
    const imported = importedAnatomy({ frame: "2015", color_identity: ["red"] } as never, "m15");
    expect("rulesAlign" in imported.style).toBe(false);
    const form = importedFormAnatomy(imported.style);
    expect("rulesAlign" in form).toBe(false);
    const stub = db();
    const result = await createCardAction(payload({ frame_style: { template: "m15", ...form } }));
    expect(result.ok).toBe(true);
    expect("rulesAlign" in styleOf(stub, "insert")!).toBe(false);
  });
});
