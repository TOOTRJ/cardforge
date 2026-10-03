import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 4.9c — the holofoil stamp's switch through the card ACTIONS, on the
// REAL profiles (the collector-save pattern; tests/unit/cards/holo-stamp
// .test.ts holds the pure rules). The owner's rule, save path by save path:
//   • createCardAction — the one insert behind the creator, a remix, the
//     import and every AI job — stamps `stamp: "auto"` where the saved
//     template has the notch (the walker included), keeps an explicit
//     "oval" / "triangle" / "none", and stores no key on a template without
//     the notch (a token frame, the emblem, a borderless frame), whatever
//     the payload says;
//   • updateCardAction never touches a stored card's frame_style unless the
//     payload names it: a key-less card stays key-less byte for byte (cards
//     saved between 4.9b and 4.9c included); a LOCKED card flips the stamp
//     through `frame_anatomy` alone; a whole frame_style (a non-revise
//     update) is normalised to its template and never switched on by
//     default;
//   • the schema refuses every value but the four — a crafted payload writes
//     nothing;
//   • a remix keeps the parent's explicit value and starts a key-less
//     parent's remix on "auto".
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

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
    art_url: "https://example.com/art.png",
    visibility: "public",
    ...over,
  };
}

function stored(over: Record<string, unknown> = {}) {
  return {
    id: CARD,
    owner_id: USER,
    title: "Kesh",
    slug: "kesh",
    color_identity: ["red"],
    card_type: "creature",
    rarity: "rare",
    supertype: null,
    subtypes: [],
    rules_text: null,
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: null,
    frame_preview: false,
    frame_style: { template: "m15", finish: "regular" },
    ...over,
  };
}

beforeEach(() => {
  state.verified = ["m15/r", "m15/c", "m15borderless/r", "saga/r", "m15snow/r", "m15devoid/r", "m15pw/r", "m15token/r", "emblem/c", "modern/r", "m15land/c"];
  state.existing = null;
});

describe("createCardAction — the new-card default", () => {
  it("a frame with the notch gets stamp 'auto' (the walker too); a frame without stores no key, whatever the payload says", async () => {
    for (const template of ["m15", "m15snow", "m15devoid", "m15pw"] as const) {
      const stub = db();
      const cardType = template === "m15pw" ? "planeswalker" : "creature";
      const result = await createCardAction(payload({ card_type: cardType, frame_style: { template } }));
      expect(result.ok, template).toBe(true);
      expect((written(stub, "insert")?.frame_style as Record<string, unknown>).stamp, template).toBe("auto");
    }
    for (const template of ["m15token", "emblem", "m15borderless", "saga", "modern"] as const) {
      const stub = db();
      const cardType = template === "m15token" ? "token" : template === "emblem" ? "emblem" : template === "saga" ? "enchantment" : "creature";
      const result = await createCardAction(payload({ card_type: cardType, rarity: "rare", frame_style: { template, stamp: "oval" } }));
      expect(result.ok, template).toBe(true);
      expect("stamp" in (written(stub, "insert")?.frame_style as Record<string, unknown>), template).toBe(false);
    }
  });

  it("keeps an explicit Always, Never and an import's triangle", async () => {
    for (const stamp of ["oval", "none", "triangle"] as const) {
      const stub = db();
      await createCardAction(payload({ frame_style: { template: "m15", stamp } }));
      expect(written(stub, "insert")?.frame_style, stamp).toMatchObject({ template: "m15", stamp });
    }
  });

  it("a token TYPE on the m15 frame keeps the key (the renderers draw nothing for it)", async () => {
    // The kind gate puts tokens on token frames; a crafted token on m15
    // stores the frame's default and prints no stamp (holoStampWanted).
    const stub = db();
    await createCardAction(payload({ card_type: "token", frame_style: { template: "m15" } }));
    expect(written(stub, "insert")?.frame_style).toMatchObject({ template: "m15", stamp: "auto" });
  });

  it.each([
    ["stamp true", { stamp: true }],
    ["stamp false", { stamp: false }],
    ["stamp 'acorn'", { stamp: "acorn" }],
    ["stamp 'Oval'", { stamp: "Oval" }],
    ["stamp 1", { stamp: 1 }],
    ["stamp an object", { stamp: { shape: "oval" } }],
    ["stamp an array", { stamp: ["oval"] }],
    ["stamp a URL", { stamp: "https://evil.example/hologram.png" }],
    ["an unknown key beside it", { stamp: "oval", stampArt: "data:image/png;base64,AAAA" }],
  ])("refuses %s and writes nothing", async (_name, bad) => {
    const stub = db();
    const result = await createCardAction(payload({ frame_style: { template: "m15", ...bad } }));
    expect(result.ok).toBe(false);
    expect(written(stub, "insert")).toBeUndefined();
  });
});

describe("updateCardAction — a stored card keeps its look", () => {
  it("a key-less card (saved before the stamp, or between 4.9b and 4.9c) edited without the switch stays key-less: no frame_style is written", async () => {
    for (const frame_style of [{ template: "m15", finish: "regular" }, { template: "m15", collector: "2023" }, {}]) {
      const card = stored({ frame_style });
      state.existing = card;
      const values = defaultValuesFor(card as unknown as Card, []);
      expect("stamp" in values.frame_style, JSON.stringify(frame_style)).toBe(false);
      expect(frameAnatomyPatchFor(card as unknown as Card, values)).toBeUndefined();
      const stub = db();
      const result = await updateCardAction(CARD, { title: "Kesh the Second", frame_anatomy: frameAnatomyPatchFor(card as unknown as Card, values) });
      expect(result.ok).toBe(true);
      expect(written(stub, "update"), JSON.stringify(frame_style)).not.toHaveProperty("frame_style");
    }
  });

  it("a LOCKED card flips the stamp through frame_anatomy alone: only the switch changes", async () => {
    state.existing = stored({ frame_style: { template: "m15", finish: "foil", collector: "2023" } });
    const on = db();
    const result = await updateCardAction(CARD, { frame_anatomy: { stamp: "auto" } });
    expect(result.ok).toBe(true);
    expect(written(on, "update")).toEqual({ frame_style: { template: "m15", finish: "foil", collector: "2023", stamp: "auto" } });

    state.existing = stored({ frame_style: { template: "m15", stamp: "auto" } });
    const never = db();
    await updateCardAction(CARD, { frame_anatomy: { stamp: "none" } });
    expect(written(never, "update")?.frame_style).toEqual({ template: "m15", stamp: "none" });

    state.existing = stored({ frame_style: { template: "m15", stamp: "none" } });
    const always = db();
    await updateCardAction(CARD, { frame_anatomy: { stamp: "oval" } });
    expect(written(always, "update")?.frame_style).toEqual({ template: "m15", stamp: "oval" });

    // The editor's own patch for a key-less card switched on then set to Never.
    const keyless = stored({ frame_style: { template: "m15" } });
    state.existing = keyless;
    const values = defaultValuesFor(keyless as unknown as Card, []);
    const patch = frameAnatomyPatchFor(keyless as unknown as Card, { ...values, frame_style: { ...values.frame_style, stamp: "none" } });
    expect(patch).toEqual({ stamp: "none" });
  });

  it("a flip on a template without the notch stores no key", async () => {
    for (const template of ["m15token", "emblem", "m15borderless"] as const) {
      state.existing = stored({ card_type: template === "m15token" ? "token" : template === "emblem" ? "emblem" : "creature", frame_style: { template, finish: "regular" } });
      const stub = db();
      const result = await updateCardAction(CARD, { frame_anatomy: { stamp: "oval" } });
      expect(result.ok, template).toBe(true);
      expect(written(stub, "update")?.frame_style, template).toEqual({ template, finish: "regular" });
    }
  });

  it.each([
    ["stamp true", { stamp: true }],
    ["stamp 'acorn'", { stamp: "acorn" }],
    ["stamp null", { stamp: null }],
    ["a template beside the switch", { stamp: "oval", template: "lotr" }],
    ["a finish beside the switch", { stamp: "oval", finish: "foil" }],
    ["art beside the switch", { stamp: "oval", stampArt: "x" }],
  ])("refuses a crafted frame_anatomy with %s and writes nothing", async (_name, bad) => {
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: bad });
    expect(result.ok).toBe(false);
    expect(written(stub, "update")).toBeUndefined();
  });

  it("a whole frame_style (a non-revise update): notched → notch-less drops the key; notch-less → notched never switches the card on", async () => {
    state.existing = stored({ frame_style: { template: "m15", stamp: "oval" } });
    const toBorderless = db();
    const moved = await updateCardAction(CARD, { frame_style: { template: "m15borderless", stamp: "oval" } });
    expect(moved.ok).toBe(true);
    expect(written(toBorderless, "update")?.frame_style).toEqual({ template: "m15borderless" });

    state.existing = stored({ frame_style: { template: "m15borderless", finish: "regular" } });
    const toM15 = db();
    const back = await updateCardAction(CARD, { frame_style: { template: "m15", finish: "regular" } });
    expect(back.ok).toBe(true);
    expect(written(toM15, "update")?.frame_style).toEqual({ template: "m15", finish: "regular" });
  });
});

describe("a remix (the creator's form → createCardAction)", () => {
  const parent = (frame_style: unknown) =>
    ({
      ...stored({ frame_style }),
      game_system_id: GAME,
      cost: "{2}{R}{R}",
      tags: [],
      flavor_text: null,
      power: "3",
      toughness: "4",
      loyalty: null,
      defense: null,
      artist_credit: "A. Painter",
      art_position: {},
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
    }) as unknown as Card;

  it("starts on auto for a key-less parent, keeps a parent's Never, Always and triangle", async () => {
    for (const [parentStyle, expected] of [
      [{ template: "m15", finish: "regular" }, "auto"],
      [{ template: "m15", stamp: "none" }, "none"],
      [{ template: "m15", stamp: "oval" }, "oval"],
      [{ template: "m15", stamp: "triangle" }, "triangle"],
    ] as const) {
      const values = remixValuesFrom(parent(parentStyle), []);
      expect(values.frame_style.stamp, JSON.stringify(parentStyle)).toBe(expected);
      state.existing = parent(parentStyle);
      const stub = db();
      const result = await createCardAction(payload({ frame_style: values.frame_style, parent_card_id: CARD }));
      expect(result.ok, JSON.stringify(parentStyle)).toBe(true);
      expect((written(stub, "insert")?.frame_style as Record<string, unknown>).stamp, JSON.stringify(parentStyle)).toBe(expected);
    }
  });
});
