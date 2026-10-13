import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 4.30 — the white border through the card ACTIONS, on the real
// profiles (the rules-align-save pattern; tests/unit/cards/white-border.test
// .ts holds the pure rules). Save path by save path:
//   • createCardAction — the one insert behind the creator, a remix, the
//     import and every AI job — stores `border: "white"` on the four frames
//     that draw it, NEVER "black" and never a default, and no key anywhere
//     else;
//   • updateCardAction changes a locked card's border through
//     `frame_anatomy` alone — "white" sets the key, "black" REMOVES it, and
//     nothing else in the stored style moves;
//   • the schemas refuse every other value;
//   • a remix keeps its parent's border.
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
  state.verified = ["m15/r", "modern/r", "retro/r", "modernland/c", "retroland/c", "agclassic/r"];
  state.existing = null;
});

describe("createCardAction — a new card starts black, and stores \"white\" only", () => {
  it("no payload key → no stored key, on every frame that draws the border", async () => {
    for (const template of ["retro", "modern"]) {
      const stub = db();
      const result = await createCardAction(payload({ frame_style: { template } }));
      expect(result.ok, `${template}: ${JSON.stringify(result)}`).toBe(true);
      expect("border" in styleOf(stub, "insert")!, template).toBe(false);
    }
  });

  it("the form's \"black\" is never stored; \"white\" is, where the frame draws it", async () => {
    const black = db();
    expect((await createCardAction(payload({ frame_style: { template: "modern", border: "black" } }))).ok).toBe(true);
    expect("border" in styleOf(black, "insert")!).toBe(false);
    for (const [template, cardType] of [["retro", "creature"], ["modern", "creature"], ["retroland", "land"], ["modernland", "land"]] as const) {
      const stub = db();
      const over: Record<string, unknown> = { card_type: cardType, frame_style: { template, border: "white" } };
      if (cardType === "land") Object.assign(over, { cost: "", color_identity: ["colorless"], power: undefined, toughness: undefined });
      const result = await createCardAction(payload(over));
      expect(result.ok, `${template}: ${JSON.stringify(result)}`).toBe(true);
      expect(styleOf(stub, "insert")?.border, template).toBe("white");
    }
  });

  it("a frame without the piece stores no key, whatever the payload says", async () => {
    for (const template of ["m15", "agclassic"]) {
      const stub = db();
      const result = await createCardAction(payload({ frame_style: { template, border: "white" } }));
      expect(result.ok, `${template}: ${JSON.stringify(result)}`).toBe(true);
      expect("border" in styleOf(stub, "insert")!, template).toBe(false);
    }
  });

  it.each([["\"silver\"", "silver"], ["\"White\"", "White"], ["true", true], ["a colour", "#ffffff"]])("refuses border %s and writes nothing", async (_name, bad) => {
    const stub = db();
    const result = await createCardAction(payload({ frame_style: { template: "modern", border: bad } }));
    expect(result.ok).toBe(false);
    expect(written(stub, "insert")).toBeUndefined();
  });
});

describe("updateCardAction — the border flips through frame_anatomy alone", () => {
  it("\"white\" sets the key and nothing else moves; \"black\" removes it", async () => {
    state.existing = stored({ frame_style: { template: "modern", finish: "regular", twoColor: true } });
    const on = db();
    expect((await updateCardAction(CARD, { frame_anatomy: { border: "white" } })).ok).toBe(true);
    expect(styleOf(on, "update")).toEqual({ template: "modern", finish: "regular", twoColor: true, border: "white" });
    expect(written(on, "update")).toMatchObject(REBAKE_PENDING);

    state.existing = stored({ frame_style: { template: "modern", finish: "regular", border: "white" } });
    const off = db();
    expect((await updateCardAction(CARD, { frame_anatomy: { border: "black" } })).ok).toBe(true);
    expect(styleOf(off, "update")).toEqual({ template: "modern", finish: "regular" });
  });

  it("an edit that names no border leaves a stored white border exactly as it is", async () => {
    state.existing = stored({ frame_style: { template: "retro", border: "white" } });
    const stub = db();
    expect((await updateCardAction(CARD, { rules_text: "Flying, vigilance" })).ok).toBe(true);
    expect(written(stub, "update") && "frame_style" in written(stub, "update")!).toBe(false);
    // …and the editor opens it white, and sends nothing for it.
    const values = defaultValuesFor(state.existing as Card, []);
    expect(values.frame_style.border).toBe("white");
    expect(frameAnatomyPatchFor(state.existing as never, values)).toBeUndefined();
  });

  it("on a frame without the piece the flip stores nothing", async () => {
    state.existing = stored();
    const stub = db();
    expect((await updateCardAction(CARD, { frame_anatomy: { border: "white" } })).ok).toBe(true);
    expect("border" in (styleOf(stub, "update") ?? {})).toBe(false);
  });

  it.each([["\"gold\"", { border: "gold" }], ["true", { border: true }], ["null", { border: null }]])("refuses a crafted frame_anatomy with border %s and writes nothing", async (_name, bad) => {
    state.existing = stored({ frame_style: { template: "modern" } });
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: bad });
    expect(result.ok).toBe(false);
    expect(written(stub, "update")).toBeUndefined();
  });
});

describe("a remix keeps its parent's border", () => {
  it("the remix form opens on the parent's border and createCardAction stores it", async () => {
    for (const [parentStyle, expected] of [
      [{ template: "modern", finish: "regular" }, undefined],
      [{ template: "modern", border: "white" }, "white"],
    ] as const) {
      const parent = stored({ frame_style: parentStyle }) as unknown as Card;
      const values = remixValuesFrom(parent, []);
      expect(values.frame_style.border, JSON.stringify(parentStyle)).toBe(expected);
      state.existing = parent;
      const stub = db();
      const result = await createCardAction(payload({ frame_style: values.frame_style, parent_card_id: CARD }));
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(styleOf(stub, "insert")?.border, JSON.stringify(parentStyle)).toBe(expected);
    }
  });
});
