import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 4.9b — the collector line's switches through the card ACTIONS, on the
// REAL profiles (the skeptic's pass; tests/unit/cards/collector-anatomy
// .test.ts holds the pure helpers, anatomy-save.test.ts the 4.6 switches).
// The owner's rule, save path by save path:
//   • createCardAction — the one insert behind the creator, a remix, the
//     import and every AI job — stamps `collector: "2023"` where the saved
//     template has the slot, keeps an explicit style / "off" / ★, and stores
//     neither key on a template without the slot, whatever the payload says;
//   • updateCardAction never touches a stored card's frame_style unless the
//     payload names it: a key-less card stays key-less byte for byte; a
//     LOCKED card flips the line and the ★ through `frame_anatomy` alone;
//     a whole frame_style (a non-revise update) is normalised to its template
//     and never switched on by default;
//   • the schema refuses every value but the three switch values and a
//     `true` ★ — a crafted payload writes nothing.
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
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
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
  state.verified = ["m15/r", "m15borderless/r", "saga/r", "m15snow/r", "m15pw/r", "m15token/r", "emblem/c", "modern/r"];
  state.existing = null;
});

describe("createCardAction — the new-card default", () => {
  it("a slotted template gets collector '2023' and no ★; a template without the slot gets neither key", async () => {
    for (const template of ["m15", "m15snow", "m15pw", "m15token"] as const) {
      const stub = db();
      const cardType = template === "m15pw" ? "planeswalker" : template === "m15token" ? "token" : "creature";
      const result = await createCardAction(payload({ card_type: cardType, frame_style: { template } }));
      expect(result.ok, template).toBe(true);
      const style = written(stub, "insert")?.frame_style as Record<string, unknown>;
      expect((COLLECTOR_TEMPLATES as readonly string[]).includes(template), template).toBe(true);
      expect(style.collector, template).toBe("2023");
      expect("star" in style, template).toBe(false);
    }
    for (const template of ["m15borderless", "saga", "modern"] as const) {
      const stub = db();
      const result = await createCardAction(payload({ card_type: template === "saga" ? "enchantment" : "creature", frame_style: { template } }));
      expect(result.ok, template).toBe(true);
      const style = written(stub, "insert")?.frame_style as Record<string, unknown>;
      expect("collector" in style, template).toBe(false);
      expect("star" in style, template).toBe(false);
    }
  });

  it("a crafted payload can't switch the line on where the template has no slot", async () => {
    const stub = db();
    const result = await createCardAction(payload({ frame_style: { template: "m15borderless", finish: "regular", collector: "2015", star: true } }));
    expect(result.ok).toBe(true);
    expect(written(stub, "insert")?.frame_style).toEqual({ template: "m15borderless", finish: "regular" });
  });

  it("keeps an explicit style, the owner's off and an import's ★", async () => {
    const a = db();
    await createCardAction(payload({ frame_style: { template: "m15", collector: "2015", star: true } }));
    expect(written(a, "insert")?.frame_style).toMatchObject({ template: "m15", collector: "2015", star: true });
    const b = db();
    await createCardAction(payload({ frame_style: { template: "m15", collector: "off" } }));
    expect(written(b, "insert")?.frame_style).toMatchObject({ template: "m15", collector: "off" });
  });

  it.each([
    ["collector '2024'", { collector: "2024" }],
    ["collector true", { collector: true }],
    ["collector an object", { collector: { style: "2023" } }],
    ["collector an array", { collector: ["2023"] }],
    ["collector a sentence", { collector: "DMU • EN — Wizards of the Coast" }],
    ["star 'yes'", { star: "yes" }],
    ["star false", { star: false }],
    ["star 1", { star: 1 }],
    ["an unknown key", { collector: "2023", stamp: "oval" }],
    ["text smuggled beside the switch", { collector: "2023", collectorText: "™ & © Wizards" }],
  ])("refuses %s and writes nothing", async (_name, bad) => {
    const stub = db();
    const result = await createCardAction(payload({ frame_style: { template: "m15", ...bad } }));
    expect(result.ok).toBe(false);
    expect(written(stub, "insert")).toBeUndefined();
  });
});

describe("updateCardAction — a stored card keeps its look", () => {
  it("a key-less card saved without touching the switch stays key-less: no frame_style is written at all", async () => {
    const card = stored({ frame_style: { template: "m15", finish: "regular" } });
    state.existing = card;
    // What the editor sends: the hydrated form's patch is nothing.
    const values = defaultValuesFor(card as unknown as Card, []);
    expect(values.frame_style).toEqual({ finish: "regular", template: "m15" });
    expect(frameAnatomyPatchFor(card as unknown as Card, values)).toBeUndefined();
    const stub = db();
    const result = await updateCardAction(CARD, { title: "Kesh the Second", frame_anatomy: frameAnatomyPatchFor(card as unknown as Card, values) });
    expect(result.ok).toBe(true);
    expect(written(stub, "update")).not.toHaveProperty("frame_style");
  });

  it("the 272 rows stored with an EMPTY frame_style stay empty through an edit", async () => {
    const card = stored({ frame_style: {} });
    state.existing = card;
    const values = defaultValuesFor(card as unknown as Card, []);
    expect("collector" in values.frame_style).toBe(false);
    const stub = db();
    await updateCardAction(CARD, { rules_text: "Haste", frame_anatomy: frameAnatomyPatchFor(card as unknown as Card, values) });
    expect(written(stub, "update")).not.toHaveProperty("frame_style");
  });

  it("a LOCKED card flips the line through frame_anatomy alone: only the switch changes, on a template it never names", async () => {
    state.existing = stored({ frame_style: { template: "m15", finish: "foil", crown: false } });
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: { collector: "2015" } });
    expect(result.ok).toBe(true);
    expect(written(stub, "update")).toEqual({ frame_style: { template: "m15", finish: "foil", crown: false, collector: "2015" } });
  });

  it("on → off stores the explicit off; the ★ goes on and comes off again", async () => {
    state.existing = stored({ frame_style: { template: "m15", collector: "2023" } });
    const off = db();
    await updateCardAction(CARD, { frame_anatomy: { collector: "off" } });
    expect(written(off, "update")?.frame_style).toEqual({ template: "m15", collector: "off" });

    // A key-less card switched on then off in one edit: the editor's form
    // holds "off", so the explicit off is stored (owner 2026-10-01).
    const keyless = stored({ frame_style: { template: "m15" } });
    state.existing = keyless;
    const values = defaultValuesFor(keyless as unknown as Card, []);
    const patch = frameAnatomyPatchFor(keyless as unknown as Card, { ...values, frame_style: { ...values.frame_style, collector: "off" } });
    expect(patch).toEqual({ collector: "off" });
    const explicit = db();
    await updateCardAction(CARD, { frame_anatomy: patch });
    expect(written(explicit, "update")?.frame_style).toEqual({ template: "m15", collector: "off" });

    state.existing = stored({ frame_style: { template: "m15", collector: "2015" } });
    const starOn = db();
    await updateCardAction(CARD, { frame_anatomy: { star: true } });
    expect(written(starOn, "update")?.frame_style).toEqual({ template: "m15", collector: "2015", star: true });
    state.existing = stored({ frame_style: { template: "m15", collector: "2015", star: true } });
    const starOff = db();
    await updateCardAction(CARD, { frame_anatomy: { star: false } });
    expect(written(starOff, "update")?.frame_style).toEqual({ template: "m15", collector: "2015" });
  });

  it("a flip on a template without the slot stores neither key", async () => {
    state.existing = stored({ frame_style: { template: "m15borderless", finish: "etched" } });
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: { collector: "2023", star: true } });
    expect(result.ok).toBe(true);
    expect(written(stub, "update")?.frame_style).toEqual({ template: "m15borderless", finish: "etched" });
  });

  it.each([
    ["collector '2024'", { collector: "2024" }],
    ["collector true", { collector: true }],
    ["collector null", { collector: null }],
    ["star 'yes'", { star: "yes" }],
    ["a template beside the switch", { collector: "2023", template: "m15borderless" }],
    ["a finish beside the switch", { collector: "2023", finish: "foil" }],
    ["footer text beside the switch", { collector: "2023", footer_text: "™ & © Wizards" }],
  ])("refuses a crafted frame_anatomy with %s and writes nothing", async (_name, bad) => {
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: bad });
    expect(result.ok).toBe(false);
    expect(written(stub, "update")).toBeUndefined();
  });

  it("a whole frame_style (a non-revise update): slotted → slot-less drops both keys; slot-less → slotted never switches the card on", async () => {
    state.existing = stored({ frame_style: { template: "m15", collector: "2015", star: true } });
    const toBorderless = db();
    const moved = await updateCardAction(CARD, { frame_style: { template: "m15borderless", collector: "2015", star: true } });
    expect(moved.ok).toBe(true);
    expect(written(toBorderless, "update")?.frame_style).toEqual({ template: "m15borderless" });

    state.existing = stored({ frame_style: { template: "m15borderless", finish: "regular" } });
    const toM15 = db();
    const back = await updateCardAction(CARD, { frame_style: { template: "m15", finish: "regular" } });
    expect(back.ok).toBe(true);
    // No default is stamped on an update: the existing card stays key-less.
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
      rarity: "rare",
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
      set_code: "DMU",
      collector_number: "107/281",
      lang: "en",
    }) as unknown as Card;

  it("starts ON for a key-less parent, stays OFF for a parent that turned it off, and keeps a parent's style and ★", async () => {
    for (const [parentStyle, expected] of [
      [{ template: "m15", finish: "regular" }, { collector: "2023" }],
      [{ template: "m15", collector: "off" }, { collector: "off" }],
      [{ template: "m15", collector: "2015", star: true }, { collector: "2015", star: true }],
    ] as const) {
      const values = remixValuesFrom(parent(parentStyle), []);
      state.existing = parent(parentStyle); // the parent lookup
      const stub = db();
      const result = await createCardAction(payload({ frame_style: values.frame_style, parent_card_id: CARD }));
      expect(result.ok, JSON.stringify(parentStyle)).toBe(true);
      const style = written(stub, "insert")?.frame_style as Record<string, unknown>;
      expect(style, JSON.stringify(parentStyle)).toMatchObject(expected);
      expect("star" in style, JSON.stringify(parentStyle)).toBe("star" in expected);
    }
  });
});
