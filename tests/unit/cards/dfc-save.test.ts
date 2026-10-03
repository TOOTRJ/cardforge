import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 5.0a — the double-faced plumbing through the card ACTIONS, on the
// REAL profiles (no template is a DFC body yet): a crafted payload can't
// put a transform icon family or a back BODY on any stored card.
//   • createCardAction / updateCardAction drop `dfcIcon` at the save on
//     every template (normalizeAnatomy: nothing draws it), whether it comes
//     in frame_style or in an edit's frame_anatomy; a value outside the
//     five families is refused outright by the schema;
//   • backFaceSchema takes the back's own body and colour (strict: an extra
//     key is refused) — and the actions refuse ANY body today, since no
//     front has a back face (lib/cards/dfc.ts backBodyError), on create and
//     on update, while a body-less legacy back saves as it always has;
//   • the imported-card shape (a `back_face` with content only) round-trips
//     the schema unchanged.
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
import { backFaceSchema, createCardSchema, updateCardSchema } from "@/lib/validation/card";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && (called(calls, "insert") || called(calls, "update"))) {
      return { data: { id: CARD, slug: "cathar" }, error: null };
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

/** The shape production's imported double-faced cards store (a back with
 *  content only — tests/unit/cards/fixtures/dfc-legacy-backs.json). */
const LEGACY_BACK = {
  title: "Moonrage Brute",
  card_type: "creature",
  subtypes: ["Werewolf"],
  power: "3",
  toughness: "3",
  rules_text: "Daybound",
  artist_credit: "Artist",
  art_position: { scale: 1, focalX: 0.5, focalY: 0.5 },
};

function payload(over: Record<string, unknown> = {}) {
  return {
    title: "Brutal Cathar",
    game_system_id: GAME,
    cost: "{2}{W}",
    color_identity: ["white"],
    card_type: "creature",
    power: "2",
    toughness: "2",
    art_url: "https://example.com/art.png",
    visibility: "public",
    ...over,
  };
}

function stored(over: Record<string, unknown> = {}) {
  return {
    id: CARD,
    owner_id: USER,
    title: "Brutal Cathar",
    slug: "cathar",
    color_identity: ["white"],
    card_type: "creature",
    supertype: null,
    subtypes: [],
    rules_text: null,
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: LEGACY_BACK,
    frame_preview: false,
    frame_style: { template: "m15", finish: "regular" },
    ...over,
  };
}

beforeEach(() => {
  state.verified = ["m15/w", "m15borderless/w", "m15land/w", "m15artifact/w", "m15devoid/w", "saga/w"];
  state.existing = null;
});

describe("the schema: a back face's own body and colour", () => {
  it("accepts a body and a colour; the imported shape round-trips unchanged", () => {
    const body = backFaceSchema.parse({ ...LEGACY_BACK, frame_style: { template: "m15artifact" }, color_identity: ["red"] });
    expect(body.frame_style).toEqual({ template: "m15artifact" });
    expect(body.color_identity).toEqual(["red"]);
    const legacy = backFaceSchema.parse(LEGACY_BACK);
    expect(legacy).not.toHaveProperty("frame_style");
    expect(legacy).not.toHaveProperty("color_identity");
    expect(legacy).toMatchObject(LEGACY_BACK);
  });

  it.each([
    ["a finish beside the template", { frame_style: { template: "m15artifact", finish: "foil" } }],
    ["a switch beside the template", { frame_style: { template: "m15artifact", crown: true } }],
    ["a family beside the template", { frame_style: { template: "m15artifact", dfcIcon: "arrows" } }],
    ["an unknown template", { frame_style: { template: "m15dfcback" } }],
    ["an empty body", { frame_style: { template: "" } }],
    ["a body with no template", { frame_style: { finish: "foil" } }],
    ["a body that is a string", { frame_style: "m15artifact" }],
    ["a colour outside the vocabulary", { color_identity: ["orange"] }],
    ["too many colours", { color_identity: ["white", "blue", "black", "red", "green", "multicolor", "colorless", "white"] }],
    ["a colour that is a string", { color_identity: "red" }],
    ["rarity on the back (card-level)", { rarity: "rare" }],
    ["finish on the back (card-level)", { finish: "foil" }],
    ["a dfcIcon on the back (card-level)", { dfcIcon: "arrows" }],
  ])("refuses %s", (_label, bad) => {
    expect(backFaceSchema.safeParse({ ...LEGACY_BACK, ...bad }).success).toBe(false);
    expect(createCardSchema.safeParse(payload({ back_face: { ...LEGACY_BACK, ...bad } })).success).toBe(false);
    expect(updateCardSchema.safeParse({ back_face: { ...LEGACY_BACK, ...bad } }).success).toBe(false);
  });

  it("the front's frame_style and the edit's frame_anatomy take a family, and nothing but a family", () => {
    expect(createCardSchema.safeParse(payload({ frame_style: { template: "m15", dfcIcon: "sunmoon" } })).success).toBe(true);
    expect(updateCardSchema.safeParse({ frame_anatomy: { dfcIcon: "compass" } }).success).toBe(true);
    for (const bad of ["spark", "Arrows", "", true, 1, null, ["arrows"], { family: "arrows" }]) {
      expect(createCardSchema.safeParse(payload({ frame_style: { template: "m15", dfcIcon: bad } })).success, String(bad)).toBe(false);
      expect(updateCardSchema.safeParse({ frame_anatomy: { dfcIcon: bad } }).success, String(bad)).toBe(false);
    }
  });
});

describe("createCardAction", () => {
  it("drops a crafted dfcIcon on every template (no transform front exists); the rest of the style is kept", async () => {
    for (const template of ["m15", "m15borderless", "m15land", "m15artifact", "saga"] as const) {
      const stub = db();
      const result = await createCardAction(
        payload({ card_type: template === "m15land" ? "land" : template === "saga" ? "enchantment" : "creature", frame_style: { template, finish: "foil", dfcIcon: "sunmoon" } }),
      );
      expect(result.ok, template).toBe(true);
      const style = written(stub, "insert")?.frame_style as Record<string, unknown>;
      expect(style, template).not.toHaveProperty("dfcIcon");
      expect(style, template).toMatchObject({ template, finish: "foil" });
    }
  });

  it("a payload naming no template (the 272 stored on m15 by default) drops it too", async () => {
    const stub = db();
    const result = await createCardAction(payload({ frame_style: { dfcIcon: "fan" } }));
    expect(result.ok).toBe(true);
    expect(written(stub, "insert")?.frame_style).not.toHaveProperty("dfcIcon");
  });

  it("refuses a family outside the five and writes nothing", async () => {
    const stub = db();
    const result = await createCardAction(payload({ frame_style: { template: "m15", dfcIcon: "spark" } }));
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.fieldErrors).toHaveProperty("frame_style");
    expect(written(stub, "insert")).toBeUndefined();
  });

  it("a legacy back face (content only) saves as it always has", async () => {
    const stub = db();
    const result = await createCardAction(payload({ back_face: LEGACY_BACK }));
    expect(result.ok).toBe(true);
    expect(written(stub, "insert")?.back_face).toEqual(LEGACY_BACK);
  });

  it("refuses a back BODY under every front (no front has a back face today) and writes nothing", async () => {
    for (const front of ["m15", "m15borderless", "m15artifact", "m15devoid", "saga"] as const) {
      const stub = db();
      const result = await createCardAction(
        payload({ card_type: front === "saga" ? "enchantment" : "creature", frame_style: { template: front }, back_face: { ...LEGACY_BACK, frame_style: { template: "m15artifact" }, color_identity: ["red"] } }),
      );
      expect(result.ok, front).toBe(false);
      expect(result.ok ? null : result.fieldErrors, front).toEqual({ "back_face.frame_style": "This frame has no back face of its own." });
      expect(written(stub, "insert"), front).toBeUndefined();
    }
  });

  it("a back colour alone (no body) is stored but draws nothing — faces.ts reads it only with a body", async () => {
    const stub = db();
    const result = await createCardAction(payload({ back_face: { ...LEGACY_BACK, color_identity: ["red"] } }));
    expect(result.ok).toBe(true);
    expect(written(stub, "insert")?.back_face).toEqual({ ...LEGACY_BACK, color_identity: ["red"] });
  });
});

describe("updateCardAction", () => {
  it("an edit's frame_anatomy with a family stores nothing new on a plain card: the stored style comes back as it was", async () => {
    state.existing = stored({ frame_style: { template: "m15", finish: "foil", collector: "2015" } });
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: { dfcIcon: "moon" } });
    expect(result.ok).toBe(true);
    expect(written(stub, "update")?.frame_style).toEqual({ template: "m15", finish: "foil", collector: "2015" });
  });

  it("a whole frame_style with a family is normalised to its template: the key is dropped", async () => {
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, { frame_style: { template: "m15borderless", finish: "regular", dfcIcon: "compass" } });
    expect(result.ok).toBe(true);
    expect(written(stub, "update")?.frame_style).toEqual({ template: "m15borderless", finish: "regular" });
  });

  it("refuses a crafted frame_anatomy family outside the five, and writes nothing", async () => {
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: { dfcIcon: "spark" } });
    expect(result.ok).toBe(false);
    expect(written(stub, "update")).toBeUndefined();
  });

  it("a legacy back face edited (content only) replaces the stored one as before", async () => {
    state.existing = stored();
    const stub = db();
    const edited = { ...LEGACY_BACK, rules_text: "Daybound\nTrample" };
    const result = await updateCardAction(CARD, { back_face: edited });
    expect(result.ok).toBe(true);
    expect(written(stub, "update")?.back_face).toEqual(edited);
  });

  it("refuses a back body on a stored plain card — against the STORED front when the patch names none, the patched front when it does", async () => {
    state.existing = stored();
    const a = db();
    const stored_front = await updateCardAction(CARD, { back_face: { ...LEGACY_BACK, frame_style: { template: "m15artifact" } } });
    expect(stored_front.ok).toBe(false);
    expect(stored_front.ok ? null : stored_front.fieldErrors).toEqual({ "back_face.frame_style": "This frame has no back face of its own." });
    expect(written(a, "update")).toBeUndefined();

    const b = db();
    const patched_front = await updateCardAction(CARD, {
      frame_style: { template: "m15borderless", finish: "regular" },
      back_face: { ...LEGACY_BACK, frame_style: { template: "m15artifact" } },
    });
    expect(patched_front.ok).toBe(false);
    expect(written(b, "update")).toBeUndefined();
  });

  it("clearing the back face (null) and leaving it alone (omitted) work as before", async () => {
    state.existing = stored();
    const cleared = db();
    expect((await updateCardAction(CARD, { back_face: null })).ok).toBe(true);
    expect(written(cleared, "update")?.back_face).toBeNull();
    const untouched = db();
    expect((await updateCardAction(CARD, { title: "Brutal Cathar II" })).ok).toBe(true);
    expect(written(untouched, "update")).not.toHaveProperty("back_face");
  });
});

describe("every template today", () => {
  it("is neither a DFC front nor a back body, so the family never survives a save on any of them", async () => {
    // Spot-checked above through the actions; here the whole vocabulary,
    // through the save rule the actions call.
    const { normalizeAnatomy } = await import("@/lib/cards/anatomy");
    for (const template of FRAME_TEMPLATE_VALUES) {
      expect(normalizeAnatomy({ template, dfcIcon: "arrows" }, template, "creature"), template).toEqual({ template });
    }
  });
});
