import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// The frame that follows the text, through updateCardAction (owner decision
// 2026-11-22, lib/creator/edit-frame-follow.ts). An edit never sends its
// template — the creator's payload is main's — so the SERVER moves the
// token's box / height and the borderless walker's tall box when the edit's
// text asks for it: only while the stored frame is the one its stored text
// picks, only onto a frame verified in the card's colour (else the row keeps
// its frame and the edit saves), never an admin's frame preview, and through
// the usual frame gates. Before it, the preview moved and the row stayed: a
// textless token given a flavour line baked its text on the textless frame.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  verified: [] as string[],
  existing: null as unknown,
  client: null as unknown,
  admin: false,
  verifiedReads: 0,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: state.admin }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminConfigured: () => false }));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () => {
    state.verifiedReads += 1;
    return state.verified;
  },
}));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.existing,
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
  revalidateCardPages: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { updateCardAction } from "@/lib/cards/actions";

const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const keysOf = (...templates: string[]) => templates.flatMap((t) => EVERY_COLOUR.map((k) => frameComboKey(t as never, k)));

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && called(calls, "update")) {
      return { data: { id: CARD, slug: "soldier" }, error: null };
    }
    return { data: null, error: null, count: 0 };
  });
  state.client = stub.client;
  return stub;
}

const written = (stub: ReturnType<typeof db>) => {
  const entry = stub.forTable("cards").find((e) => called(e.calls, "update"));
  return payloadOf(entry?.calls ?? [], "update") as Record<string, unknown> | undefined;
};

function token(over: Record<string, unknown> = {}) {
  return {
    id: CARD,
    owner_id: USER,
    title: "Soldier",
    slug: "soldier",
    color_identity: ["white"],
    card_type: "token",
    rarity: "common",
    supertype: "Creature",
    subtypes: ["Soldier"],
    rules_text: null,
    flavor_text: null,
    power: "1",
    toughness: "1",
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: null,
    face_content: null,
    watermark: null,
    frame_preview: false,
    frame_style: { template: "m15token", finish: "foil", collector: "2023" },
    ...over,
  };
}

const THREE_ROWS = "+1: Draw a card.\n−2: Tap target creature.\n−7: You get an emblem.";
function walker(over: Record<string, unknown> = {}) {
  return token({
    title: "Tamsin, Tide-Reader",
    card_type: "planeswalker",
    supertype: "Legendary",
    subtypes: ["Tamsin"],
    color_identity: ["blue"],
    power: null,
    toughness: null,
    loyalty: "4",
    rules_text: THREE_ROWS,
    frame_style: { template: "m15borderlesspw", finish: "regular" },
    ...over,
  });
}

beforeEach(() => {
  state.verified = keysOf("m15token", "m15tokentext", "m15tokentall", "m20token", "m20tokentext", "m20tokentall", "m15borderlesspw", "m15borderlesspwtall");
  state.existing = null;
  state.admin = false;
  state.verifiedReads = 0;
});

describe("updateCardAction moves the frame the text asks for", () => {
  it("a textless token given a flavour line is stored on the text box — every other frame_style key as stored", async () => {
    state.existing = token();
    const stub = db();
    const result = await updateCardAction(CARD, { flavor_text: "Hold the line." });
    expect(result).toMatchObject({ ok: true });
    expect(written(stub)?.frame_style).toEqual({ template: "m15tokentext", finish: "foil", collector: "2023" });
  });

  it("a token whose text is removed again goes back to the textless frame", async () => {
    state.existing = token({ flavor_text: "Hold the line.", frame_style: { template: "m15tokentext", finish: "regular" } });
    const stub = db();
    expect((await updateCardAction(CARD, { flavor_text: null, rules_text: null })).ok).toBe(true);
    expect(written(stub)?.frame_style).toEqual({ template: "m15token", finish: "regular" });
  });

  it("the full-art design's height follows too", async () => {
    state.existing = token({ frame_style: { template: "m20token" } });
    const stub = db();
    expect((await updateCardAction(CARD, { rules_text: "Vigilance" })).ok).toBe(true);
    expect(written(stub)?.frame_style).toEqual({ template: "m20tokentext" });
  });

  it("a borderless walker given a fourth row is stored on the tall box (rows or text)", async () => {
    state.existing = walker();
    let stub = db();
    const rows = {
      v: 1,
      loyalty: {
        abilities: [
          { cost: "+1", text: "Draw a card." },
          { cost: "-2", text: "Tap target creature." },
          { cost: "-4", text: "Scry 4." },
          { cost: "-7", text: "You get an emblem." },
        ],
      },
    };
    expect(
      (await updateCardAction(CARD, { rules_text: "+1: Draw a card.\n-2: Tap target creature.\n-4: Scry 4.\n-7: You get an emblem.", face_content: rows })).ok,
    ).toBe(true);
    expect(written(stub)?.frame_style).toEqual({ template: "m15borderlesspwtall", finish: "regular" });
    // …and back with three.
    state.existing = walker({ face_content: rows, rules_text: "x", frame_style: { template: "m15borderlesspwtall" } });
    stub = db();
    expect((await updateCardAction(CARD, { rules_text: THREE_ROWS, face_content: null })).ok).toBe(true);
    expect(written(stub)?.frame_style).toEqual({ template: "m15borderlesspw" });
  });

  it("an edit that moves nothing never writes frame_style, and never reads the verified set for it", async () => {
    state.existing = token({ flavor_text: "Hold the line.", frame_style: { template: "m15tokentext" } });
    const stub = db();
    expect((await updateCardAction(CARD, { title: "Knight", flavor_text: "Hold the line, again." })).ok).toBe(true);
    expect("frame_style" in (written(stub) ?? {})).toBe(false);
    expect(state.verifiedReads).toBe(0);
  });
});

describe("what stays", () => {
  it("the pin rule: a stored frame that disagrees with its stored text is a pick", async () => {
    // An empty text box, picked by hand.
    state.existing = token({ frame_style: { template: "m15tokentext" } });
    let stub = db();
    expect((await updateCardAction(CARD, { flavor_text: "A knight." })).ok).toBe(true);
    expect("frame_style" in (written(stub) ?? {})).toBe(false);
    // A full-art height the text didn't pick.
    state.existing = token({ rules_text: "Vigilance", frame_style: { template: "m20tokentall" } });
    stub = db();
    expect((await updateCardAction(CARD, { rules_text: null })).ok).toBe(true);
    expect("frame_style" in (written(stub) ?? {})).toBe(false);
    // A borderless walker imported onto the box its rows don't pick.
    state.existing = walker({ rules_text: `${THREE_ROWS}\n−9: Win.`, frame_style: { template: "m15borderlesspw" } });
    stub = db();
    expect((await updateCardAction(CARD, { rules_text: `${THREE_ROWS}\n−9: Win the game.` })).ok).toBe(true);
    expect("frame_style" in (written(stub) ?? {})).toBe(false);
  });

  it("an unverified target: the edit saves, on its stored frame", async () => {
    state.verified = keysOf("m15token");
    state.existing = token();
    const stub = db();
    const result = await updateCardAction(CARD, { flavor_text: "Hold the line." });
    expect(result).toMatchObject({ ok: true });
    expect(written(stub)?.flavor_text).toBe("Hold the line.");
    expect("frame_style" in (written(stub) ?? {})).toBe(false);
  });

  it("an admin's saved frame preview keeps the combo it previews", async () => {
    state.admin = true;
    state.existing = token({ frame_preview: true, visibility: "private" });
    const stub = db();
    expect((await updateCardAction(CARD, { flavor_text: "Hold the line." })).ok).toBe(true);
    expect("frame_style" in (written(stub) ?? {})).toBe(false);
  });

  it("a payload that names its frame decides it itself (no follow over it)", async () => {
    state.existing = token();
    const stub = db();
    expect((await updateCardAction(CARD, { flavor_text: "Hold the line.", frame_style: { template: "m15token" } })).ok).toBe(true);
    expect((written(stub)?.frame_style as { template?: string }).template).toBe("m15token");
  });

  it("an anatomy flip in the same edit lands on the moved frame's style", async () => {
    state.existing = token({ frame_style: { template: "m15token" } });
    const stub = db();
    expect((await updateCardAction(CARD, { flavor_text: "Hold the line.", frame_anatomy: { rulesAlign: "center" } })).ok).toBe(true);
    expect(written(stub)?.frame_style).toMatchObject({ template: "m15tokentext" });
  });
});
