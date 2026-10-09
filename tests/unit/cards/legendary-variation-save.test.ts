import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 3b.17 — the Variations section's "Legendary" entry through the card
// ACTIONS, on the real profiles (the anatomy-save pattern). The entry is the
// crown switch and the word, so the round trip is the crown's own:
//   • a NEW card with the entry picked — the form holds `crown: true` and a
//     supertype with "Legendary" first (what the chip writes) — is stored
//     with `frame_style.crown === true`, the word, and the template it was
//     picked on;
//   • not picked (the switch off) stores `crown: false` — the owner's "off";
//   • on a frame with no printed crown the save drops the switch whatever
//     the payload says (why the entry is disabled there);
//   • an EDIT sends `frame_anatomy` alone — never `frame_style`, never the
//     locked type line — and the stored style keeps every other key; so on
//     a stored card that is not legendary the entry is disabled.
// The chip: tests/unit/components/legendary-variation.test.tsx.
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
import { NEW_CARD_ANATOMY } from "@/lib/cards/anatomy";
import { NOT_LEGENDARY_LOCKED_REASON, legendaryVariationOf, withLegendaryWord } from "@/lib/creator/legendary-variation";
import { frameAnatomyPatchFor, pickRevisablePayload } from "@/lib/creator/revise";
import type { FormValues } from "@/lib/creator/form-types";
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
  state.verified = ["m15/r", "m15artifact/r", "m15land/r", "m15snow/r", "m15borderless/r", "extendedart/r", "saga/r", "m15pw/r", "retro/r", "m15devoid/r"];
  state.existing = null;
});

/** What the chip leaves in the form once picked on a card that wasn't
 *  legendary: the switch on, the word first (lib/creator/legendary-variation.ts). */
function picked(template: string, supertype: string, cardType = "creature") {
  const before = legendaryVariationOf({ template, cardType, supertype, colorIdentity: ["red"], cost: "{2}{R}{R}", crown: NEW_CARD_ANATOMY.crown });
  expect(before, template).toMatchObject({ available: true, selected: false, addsWordTo: "front" });
  return { supertype: withLegendaryWord(supertype), frame_style: { template, ...NEW_CARD_ANATOMY, crown: true } };
}

describe("createCardAction — a new card with the entry picked", () => {
  it.each([
    ["m15", "creature", ""],
    ["m15artifact", "artifact", ""],
    ["m15land", "land", ""],
    ["m15snow", "creature", "Snow"],
    ["m15borderless", "creature", ""],
    ["extendedart", "creature", ""],
  ] as const)("%s: stored with crown === true, the word first, the template as picked", async (template, cardType, supertype) => {
    const stub = db();
    const over: Record<string, unknown> = { card_type: cardType, ...picked(template, supertype, cardType) };
    if (cardType !== "creature") Object.assign(over, { power: undefined, toughness: undefined });
    if (cardType === "land") Object.assign(over, { cost: "" });
    const result = await createCardAction(payload(over));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(styleOf(stub, "insert")).toMatchObject({ template, crown: true });
    expect(written(stub, "insert")?.supertype).toBe(supertype ? `Legendary ${supertype}` : "Legendary");
  });

  it("un-picked: the owner's off is stored, and the word stays", async () => {
    const stub = db();
    const result = await createCardAction(payload({ supertype: "Legendary", frame_style: { template: "m15", ...NEW_CARD_ANATOMY, crown: false } }));
    expect(result.ok).toBe(true);
    expect(styleOf(stub, "insert")).toMatchObject({ template: "m15", crown: false });
    expect(written(stub, "insert")?.supertype).toBe("Legendary");
  });

  it.each([
    ["saga", "enchantment"],
    ["m15pw", "planeswalker"],
    ["retro", "creature"],
    ["m15devoid", "creature"],
  ] as const)("%s prints no crown: the entry is disabled and a crafted crown is dropped at the save", async (template, cardType) => {
    expect(legendaryVariationOf({ template, cardType, supertype: "Legendary", colorIdentity: ["red"], crown: true }).available).toBe(false);
    const stub = db();
    const over: Record<string, unknown> = { card_type: cardType, supertype: "Legendary", frame_style: { template, crown: true } };
    if (cardType === "planeswalker") Object.assign(over, { power: undefined, toughness: undefined, loyalty: "4" });
    if (cardType === "enchantment") Object.assign(over, { power: undefined, toughness: undefined });
    const result = await createCardAction(payload(over));
    expect(result.ok, `${template}: ${JSON.stringify(result)}`).toBe(true);
    expect("crown" in styleOf(stub, "insert")!, template).toBe(false);
  });
});

describe("updateCardAction — an edit sends frame_anatomy alone", () => {
  const formValues = (frame_style: Record<string, unknown>) =>
    ({ frame_style, color_identity: ["red"] }) as unknown as Pick<FormValues, "frame_style" | "color_identity">;

  it("an old legendary card, stored before the crown: picking the entry sends { crown: true } and nothing else of the style", async () => {
    const card = stored({ supertype: "Legendary", frame_style: { template: "m15", finish: "foil" } });
    // The chip wrote the switch into the form; the edit's patch is the flip alone.
    const patch = frameAnatomyPatchFor(card as unknown as Card, formValues({ template: "m15", finish: "foil", crown: true }));
    expect(patch).toEqual({ crown: true });
    state.existing = card;
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: patch });
    expect(result.ok).toBe(true);
    expect(written(stub, "update")?.frame_style).toEqual({ template: "m15", finish: "foil", crown: true });
    expect(written(stub, "update")).not.toHaveProperty("supertype");
  });

  it("an old card that isn't legendary: its type line is locked — the entry is disabled, and an edit's payload never carries the supertype", () => {
    const card = stored({ supertype: null, frame_style: { template: "m15" } });
    expect(
      legendaryVariationOf({ template: "m15", cardType: card.card_type, supertype: card.supertype, colorIdentity: ["red"], crown: undefined, typeLineLocked: true }),
    ).toMatchObject({ available: false, reason: NOT_LEGENDARY_LOCKED_REASON });
    // What the form sends for an edit (pickRevisablePayload): the switches
    // on `frame_anatomy`, never `frame_style`, never the type line.
    const sent = pickRevisablePayload({ title: "Kesh", supertype: "Legendary", frame_style: { template: "m15", crown: true }, frame_anatomy: { crown: true } });
    expect(sent).toEqual({ title: "Kesh", frame_anatomy: { crown: true } });
  });

  it("an old crowned card opened and saved untouched sends no patch — and un-picking sends { crown: false }", async () => {
    const card = stored({ supertype: "Legendary", frame_style: { template: "m15", crown: true } });
    expect(frameAnatomyPatchFor(card as unknown as Card, formValues({ template: "m15", crown: true }))).toBeUndefined();
    const off = frameAnatomyPatchFor(card as unknown as Card, formValues({ template: "m15", crown: false }));
    expect(off).toEqual({ crown: false });
    state.existing = card;
    const stub = db();
    await updateCardAction(CARD, { frame_anatomy: off });
    expect(written(stub, "update")?.frame_style).toEqual({ template: "m15", crown: false });
  });

  it("an edit that touches neither leaves the stored frame_style alone", async () => {
    state.existing = stored({ supertype: "Legendary", frame_style: { template: "m15" } });
    const stub = db();
    await updateCardAction(CARD, { title: "Kesh the Second" });
    expect(written(stub, "update")).not.toHaveProperty("frame_style");
  });
});
