import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 4.6.0 — the anatomy switches through the card ACTIONS, with the
// anatomy 4.6a / 4.6b will declare (tests/unit/cards/anatomy-fixture.ts):
//   • createCardAction (the one insert: creator, AI jobs, remix) stamps a new
//     card's switches on where its template draws the piece, keeps an
//     explicit off, and drops what the template can't draw;
//   • updateCardAction normalises a full frame_style the same way, and
//     merges an edit's frame_anatomy over the STORED frame_style — leaving
//     every other key (a legacy template included) exactly as stored — with
//     a colour pair only as a refinement of a multicolour card.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  verified: [] as string[],
  existing: null as unknown,
  client: null as unknown,
}));

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { declaredGetFrameProfile } = await import("./anatomy-fixture");
  return { ...real, getFrameProfile: declaredGetFrameProfile(real.getFrameProfile) };
});
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
  getEntitlements: async () => ({ premiumFrames: false, removeWatermark: false, cardCapacity: -1 }),
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
import { defaultValuesFor } from "@/lib/creator/card-fields";

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
    supertype: "Legendary",
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
    supertype: "Legendary",
    subtypes: [],
    rules_text: null,
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: null,
    frame_preview: false,
    frame_style: { template: "m15", finish: "foil" },
    ...over,
  };
}

beforeEach(() => {
  state.verified = ["m15/r", "m15/m", "m15snow/r", "m15land/m"];
  state.existing = null;
});

describe("createCardAction — a new card", () => {
  it("the creator's all-on switches: kept where the template draws them", async () => {
    const stub = db();
    const values = defaultValuesFor(null, []);
    await createCardAction(payload({ frame_style: values.frame_style }));
    expect(written(stub, "insert")?.frame_style).toEqual({ finish: "regular", template: "m15", crown: true, twoColor: true });
  });

  it("an AI job's payload names no switch: stamped on", async () => {
    const stub = db();
    await createCardAction(payload());
    expect(written(stub, "insert")?.frame_style).toEqual({ crown: true, twoColor: true });
    const stub2 = db();
    await createCardAction(payload({ frame_style: { template: "m15" } }));
    expect(written(stub2, "insert")?.frame_style).toEqual({ template: "m15", crown: true, twoColor: true });
  });

  it("an import of a crownless printing keeps the crown off", async () => {
    const stub = db();
    await createCardAction(payload({ frame_style: { template: "m15", crown: false, twoColor: false } }));
    expect(written(stub, "insert")?.frame_style).toEqual({ template: "m15", crown: false, twoColor: false });
  });

  it("a template that can't draw the pieces stores no switch at all", async () => {
    const stub = db();
    await createCardAction(payload({ frame_style: { template: "m15snow", finish: "regular", crown: true, twoColor: true } }));
    expect(written(stub, "insert")?.frame_style).toEqual({ template: "m15snow", finish: "regular" });
  });

  it("stores a picked colour pair as the identity", async () => {
    const stub = db();
    await createCardAction(
      payload({ color_identity: ["white", "blue"], cost: "{1}{W}{U}", frame_style: { template: "m15", twoColor: true } }),
    );
    expect(written(stub, "insert")?.color_identity).toEqual(["white", "blue"]);
  });
});

describe("updateCardAction — an edit", () => {
  it("an ordinary edit leaves the stored frame_style alone (no key sent)", async () => {
    state.existing = stored();
    const stub = db();
    await updateCardAction(CARD, { title: "Kesh the Second" });
    expect(written(stub, "update")).not.toHaveProperty("frame_style");
    expect(written(stub, "update")).not.toHaveProperty("color_identity");
  });

  it("merges a switch flip over the stored frame_style, every other key as stored", async () => {
    state.existing = stored({ frame_style: { template: "m15", finish: "foil" } });
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: { crown: true } });
    expect(result.ok).toBe(true);
    expect(written(stub, "update")?.frame_style).toEqual({ template: "m15", finish: "foil", crown: true });

    // A legacy template is never rewritten by a switch flip, and no gate runs.
    state.existing = stored({ frame_style: { template: "regular" } });
    state.verified = [];
    const stub2 = db();
    const legacy = await updateCardAction(CARD, { frame_anatomy: { crown: false } });
    expect(legacy.ok).toBe(true);
    expect(written(stub2, "update")?.frame_style).toEqual({ template: "regular", crown: false });
  });

  it("gives a stored multicolour card the pair its owner confirmed, and refuses a re-colour", async () => {
    state.existing = stored({ color_identity: ["multicolor"], cost: "{1}{W}{U}", frame_style: { template: "m15" } });
    const stub = db();
    const ok = await updateCardAction(CARD, { frame_anatomy: { twoColor: true, pair: ["blue", "white"] } });
    expect(ok.ok).toBe(true);
    expect(written(stub, "update")).toMatchObject({
      frame_style: { template: "m15", twoColor: true },
      color_identity: ["white", "blue"],
    });

    state.existing = stored({ color_identity: ["black"], frame_style: { template: "m15" } });
    const stub2 = db();
    const refused = await updateCardAction(CARD, { frame_anatomy: { twoColor: true, pair: ["blue", "black"] } });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.fieldErrors?.color_identity).toMatch(/only a multicolour card/);
    expect(written(stub2, "update")).toBeUndefined();
  });

  it("a full frame_style (a non-revise update) is normalised to what its template draws", async () => {
    state.existing = stored();
    const stub = db();
    await updateCardAction(CARD, { frame_style: { template: "m15snow", crown: true, twoColor: false } });
    expect(written(stub, "update")?.frame_style).toEqual({ template: "m15snow" });
  });
});

// Owner round 17 (2026-09-30), LAND FIX = HIDE: a LAND wears the two-colour
// frame only on a land frame (lib/cards/anatomy.ts twoColorFits). The creator
// never offers the switch elsewhere, and the actions drop it whatever a
// crafted payload says — Shadowwood Hollow / Sunfade Citadel, two-colour
// lands stored with no template (drawn on m15).
describe("a LAND's two-colour switch through the actions (owner round 17)", () => {
  const land = (over: Record<string, unknown> = {}) =>
    payload({
      title: "Shadowwood Hollow",
      cost: "",
      color_identity: ["black", "green"],
      supertype: "",
      card_type: "land",
      power: undefined,
      toughness: undefined,
      ...over,
    });
  const storedLand = (over: Record<string, unknown> = {}) =>
    stored({
      title: "Shadowwood Hollow",
      color_identity: ["black", "green"],
      card_type: "land",
      supertype: null,
      frame_style: { finish: "regular" },
      ...over,
    });

  it("createCardAction drops it for a land on a nonland frame — a crafted payload or the default stamp", async () => {
    const crafted = db();
    await createCardAction(land({ frame_style: { template: "m15", crown: true, twoColor: true } }));
    expect(written(crafted, "insert")?.frame_style).toEqual({ template: "m15", crown: true });
    // No frame_style (an AI job): the land is drawn on m15, so no stamp.
    const stamped = db();
    await createCardAction(land());
    expect(written(stamped, "insert")?.frame_style).toEqual({ crown: true });
    // On the land frame it is kept.
    const onLandFrame = db();
    await createCardAction(land({ frame_style: { template: "m15land", twoColor: true } }));
    expect(written(onLandFrame, "insert")?.frame_style).toEqual({ template: "m15land", twoColor: true, crown: true });
  });

  it("updateCardAction drops an edit's crafted flip — and its pair — for a land stored with no template", async () => {
    state.existing = storedLand();
    const flip = db();
    const result = await updateCardAction(CARD, { frame_anatomy: { twoColor: true } });
    expect(result.ok).toBe(true);
    expect(written(flip, "update")?.frame_style).toEqual({ finish: "regular" });

    state.existing = storedLand({ color_identity: ["multicolor"] });
    const withPair = db();
    await updateCardAction(CARD, { frame_anatomy: { twoColor: true, pair: ["black", "green"] } });
    expect(written(withPair, "update")?.frame_style).toEqual({ finish: "regular" });
    expect(written(withPair, "update")).not.toHaveProperty("color_identity");

    // A full frame_style saying the same is normalised the same way.
    state.existing = storedLand();
    const full = db();
    await updateCardAction(CARD, { frame_style: { finish: "regular", twoColor: true } });
    expect(written(full, "update")?.frame_style).toEqual({ finish: "regular" });

    // On the land frame the flip is kept.
    state.existing = storedLand({ frame_style: { template: "m15land" } });
    const onLandFrame = db();
    await updateCardAction(CARD, { frame_anatomy: { twoColor: true } });
    expect(written(onLandFrame, "update")?.frame_style).toEqual({ template: "m15land", twoColor: true });
  });

  it("judges the card by the type it will be SAVED with: a crafted change to Land drops the switch", async () => {
    // A multicolour creature on m15 turned into a land by the same payload
    // that flips the switch (card_type is locked in the editor — crafted).
    state.existing = stored({ color_identity: ["multicolor"], cost: "{B}{G}", frame_style: { template: "m15" } });
    const flip = db();
    await updateCardAction(CARD, { card_type: "land", frame_anatomy: { twoColor: true, pair: ["black", "green"] } });
    expect(written(flip, "update")?.frame_style).toEqual({ template: "m15" });
    expect(written(flip, "update")).not.toHaveProperty("color_identity");

    state.existing = stored({ color_identity: ["black", "green"], frame_style: { template: "m15" } });
    const full = db();
    await updateCardAction(CARD, { card_type: "land", frame_style: { template: "m15", twoColor: true } });
    expect(written(full, "update")?.frame_style).toEqual({ template: "m15" });

    // The type change alone: the switch its owner set while it was a
    // creature goes too — no save leaves a land on a nonland frame with it.
    state.existing = stored({ color_identity: ["black", "green"], frame_style: { template: "m15", crown: true, twoColor: true } });
    const typeOnly = db();
    await updateCardAction(CARD, { card_type: "land" });
    expect(written(typeOnly, "update")?.frame_style).toEqual({ template: "m15", crown: true });
    // …while a type change that keeps it drawable leaves frame_style alone.
    state.existing = stored({ color_identity: ["black", "green"], frame_style: { template: "m15", twoColor: true } });
    const stays = db();
    await updateCardAction(CARD, { card_type: "artifact" });
    expect(written(stays, "update")).not.toHaveProperty("frame_style");
  });
});
