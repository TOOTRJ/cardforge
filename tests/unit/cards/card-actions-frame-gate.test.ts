import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The server-side verification gate in the card actions (TODO 0.13; tests
// TODO 0.18). A (template, colour) pair saves only when the admin has
// published it in /admin/frame-compare — the server twin of the picker's
// chips, so a stale page or a crafted payload can't get past:
//
//   * create: the gate reads the card's OWN colour the way the renderer
//     does (none → colourless, two or more → multicolour) and resolves a
//     missing template to the default frame;
//   * update: the gate runs only when the patch CHANGES the frame or the
//     colour, so a card saved on a since-withdrawn frame (the picker's
//     "legacy pin") stays editable while its frame and colour are left
//     alone — and the same colours in another order, or the same template
//     sent again by the full edit form, are not a change; a stored legacy
//     template ("regular") is judged as the default frame.
//
// Every account here is a plain user (the admin preview path has its own
// tests in card-actions-frame-preview.test.ts).
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  verified: [] as string[],
  verifiedReads: 0,
  /** The frame list read fails (a PostgREST / pooler hiccup). */
  verifiedFails: false,
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
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
  isAdminConfigured: () => true,
}));
vi.mock("@/lib/cards/frame-reviews", async () => {
  const { VerifiedFramesUnavailableError } = await import("@/lib/cards/frame-list-unavailable");
  return {
    getVerifiedFrameKeys: async () => {
      state.verifiedReads += 1;
      if (state.verifiedFails) throw new VerifiedFramesUnavailableError("connection pool exhausted");
      return state.verified;
    },
  };
});
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
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createCardAction, updateCardAction } from "@/lib/cards/actions";

function db() {
  const stub = chainClient((table): ChainAnswer =>
    table === "cards" ? { data: { id: CARD, slug: "test" }, error: null } : { error: null },
  );
  state.client = stub.client;
  return stub;
}

const cardWrites = (stub: ReturnType<typeof chainClient>) => stub.forTable("cards");
const updateOf = (stub: ReturnType<typeof chainClient>) =>
  payloadOf(stub.forTable("cards").at(-1)!.calls, "update") as Record<string, unknown>;

/** A plain creature — the kind gate has nothing to say about it. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Gatekeeper",
    game_system_id: GAME,
    card_type: "creature",
    color_identity: ["white"],
    subtypes: ["Human"],
    power: "2",
    toughness: "2",
    frame_style: { template: "m15" },
    visibility: "public",
    art_url: "https://example.com/art.png",
    ...overrides,
  };
}

/** A stored card on the Ring frame in blue — withdrawn in these tests. */
function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CARD,
    owner_id: USER,
    slug: "gatekeeper",
    title: "Gatekeeper",
    card_type: "creature",
    supertype: null,
    subtypes: ["Human"],
    rules_text: null,
    power: "2",
    toughness: "2",
    color_identity: ["blue"],
    frame_style: { template: "lotr" },
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: null,
    ...overrides,
  };
}

const refusal = (colourWord: string) => ({
  ok: false,
  fieldErrors: { frame_style: `That frame isn't available in ${colourWord} yet — pick another frame or colour.` },
});

beforeEach(() => {
  // Published: the M15 frame in white, blue and gold; the Ring frame in white.
  state.verified = ["m15/w", "m15/u", "m15/m", "lotr/w"];
  state.verifiedReads = 0;
  state.verifiedFails = false;
  state.existing = null;
});

describe("createCardAction — verification gate", () => {
  it("saves a published pair", async () => {
    const stub = db();
    expect(await createCardAction(payload())).toMatchObject({ ok: true, cardId: CARD });
    expect(cardWrites(stub)).toHaveLength(1);
    expect(state.verifiedReads).toBe(1);
  });

  it("refuses an unpublished colour of a published frame, naming the colour, and writes nothing", async () => {
    const stub = db();
    expect(await createCardAction(payload({ color_identity: ["red"] }))).toEqual(refusal("red"));
    expect(cardWrites(stub)).toHaveLength(0);
  });

  it("refuses a frame published in no colour at all", async () => {
    const stub = db();
    expect(
      await createCardAction(payload({ frame_style: { template: "battle" }, color_identity: ["white"] })),
    ).toMatchObject({ ok: false, fieldErrors: { frame_style: expect.stringMatching(/isn't available in white/) } });
    expect(cardWrites(stub)).toHaveLength(0);
  });

  it("reads the colour like the renderer: two colours are the gold frame, none is colourless", async () => {
    db();
    expect(await createCardAction(payload({ color_identity: ["white", "blue"] }))).toMatchObject({ ok: true });
    state.verified = ["m15/w", "m15/u"];
    expect(await createCardAction(payload({ color_identity: ["white", "blue"] }))).toEqual(refusal("multicolor"));
    expect(await createCardAction(payload({ color_identity: [] }))).toEqual(refusal("colorless"));
  });

  it("resolves a card with no template to the default frame", async () => {
    db();
    const noTemplate = payload();
    delete (noTemplate as { frame_style?: unknown }).frame_style;
    expect(await createCardAction(noTemplate)).toMatchObject({ ok: true });

    state.verified = ["lotr/w"];
    expect(await createCardAction(noTemplate)).toEqual(refusal("white"));
  });
});

describe("updateCardAction — verification gate", () => {
  beforeEach(() => {
    state.existing = storedRow();
  });

  it("keeps a card on a withdrawn frame editable while its frame and colour are left alone", async () => {
    const stub = db();
    expect(await updateCardAction(CARD, { title: "Renamed" })).toMatchObject({ ok: true });
    expect(updateOf(stub).title).toBe("Renamed");
    // Nothing to check: the gate isn't consulted at all.
    expect(state.verifiedReads).toBe(0);
  });

  it("treats the same template sent again, or the same colours in another order, as no change", async () => {
    const stub = db();
    expect(
      await updateCardAction(CARD, { title: "Resaved", frame_style: { template: "lotr" }, color_identity: ["blue"] }),
    ).toMatchObject({ ok: true });

    state.existing = storedRow({ color_identity: ["blue", "red"] });
    expect(await updateCardAction(CARD, { color_identity: ["red", "blue"] })).toMatchObject({ ok: true });
    expect(cardWrites(stub)).toHaveLength(2);
    expect(state.verifiedReads).toBe(0);
  });

  it("refuses a colour change onto an unpublished colour of the card's frame", async () => {
    const stub = db();
    expect(await updateCardAction(CARD, { color_identity: ["green"] })).toEqual(refusal("green"));
    expect(cardWrites(stub)).toHaveLength(0);
  });

  it("refuses a frame change onto an unpublished pair, judged in the card's stored colour", async () => {
    const stub = db();
    // The stored colour is blue; the Ring frame is only published in white.
    state.existing = storedRow({ frame_style: { template: "m15" } });
    expect(await updateCardAction(CARD, { frame_style: { template: "lotr" } })).toEqual(refusal("blue"));
    expect(cardWrites(stub)).toHaveLength(0);
  });

  it("judges a stored legacy template as the default frame when the colour changes", async () => {
    const stub = db();
    // "regular" predates the picker; the renderers draw it as M15.
    state.existing = storedRow({ frame_style: { template: "regular" }, color_identity: ["white"] });
    expect(await updateCardAction(CARD, { color_identity: ["blue"] })).toMatchObject({ ok: true });
    expect(await updateCardAction(CARD, { color_identity: ["red"] })).toEqual(refusal("red"));
    expect(cardWrites(stub)).toHaveLength(1);
  });

  it("lets a card move OFF a withdrawn pair onto a published one", async () => {
    const stub = db();
    expect(await updateCardAction(CARD, { color_identity: ["white"] })).toMatchObject({ ok: true });
    expect(await updateCardAction(CARD, { frame_style: { template: "m15" } })).toMatchObject({ ok: true });
    expect(cardWrites(stub)).toHaveLength(2);
  });
});

// TODO 5.9: Innistrad: Double Feature dresses EVERY colour of artifact as its
// one artifact master; a white tick was made against white non-artifacts and
// never saw it. A white artifact there saves only once `c` (the colourless
// artifacts' row, which shows the master) is ticked too.
describe("the artifact master on Double Feature", () => {
  const ARTIFACT_REFUSAL = {
    ok: false,
    fieldErrors: {
      frame_style: "That frame's artifact version isn't available yet — pick another frame, or a type that isn't an artifact.",
    },
  };
  const mask = (overrides: Record<string, unknown> = {}) =>
    payload({
      title: "Hedgewitch's Mask",
      card_type: "artifact",
      subtypes: ["Equipment"],
      power: undefined,
      toughness: undefined,
      frame_style: { template: "doublefeature" },
      ...overrides,
    });

  beforeEach(() => {
    state.verified = ["doublefeature/w", "m15/w"];
  });

  it("refuses a white artifact on the white tick alone, and saves it once `c` is ticked", async () => {
    const stub = db();
    expect(await createCardAction(mask())).toEqual(ARTIFACT_REFUSAL);
    expect(await createCardAction(mask({ card_type: "creature", supertype: "Artifact", subtypes: ["Golem"], power: "2", toughness: "2" }))).toEqual(
      ARTIFACT_REFUSAL,
    );
    expect(cardWrites(stub)).toHaveLength(0);
    state.verified = ["doublefeature/w", "doublefeature/c", "m15/w"];
    expect(await createCardAction(mask())).toMatchObject({ ok: true });
  });

  it("saves a white non-artifact on the white tick alone", async () => {
    db();
    expect(await createCardAction(payload({ frame_style: { template: "doublefeature" } }))).toMatchObject({ ok: true });
  });

  it("refuses an edit that moves a white artifact onto it, or makes a card on it an artifact", async () => {
    const stub = db();
    state.existing = storedRow({ card_type: "artifact", subtypes: ["Equipment"], power: null, toughness: null, color_identity: ["white"], frame_style: { template: "m15" } });
    expect(await updateCardAction(CARD, { frame_style: { template: "doublefeature" } })).toEqual(ARTIFACT_REFUSAL);
    state.existing = storedRow({ color_identity: ["white"], frame_style: { template: "doublefeature" } });
    expect(await updateCardAction(CARD, { supertype: "Artifact" })).toEqual(ARTIFACT_REFUSAL);
    expect(cardWrites(stub)).toHaveLength(0);
    // A card already on it, its type left alone, stays editable.
    expect(await updateCardAction(CARD, { title: "Renamed" })).toMatchObject({ ok: true });
  });
});

// A failed read of the frame list (the 2026-11-10 pooler incident) is never
// "nothing is verified": the save is refused in words that say try again,
// never "That frame isn't available in <colour> yet", and nothing is written.
describe("a frame list that can't be read", () => {
  const unavailable = {
    ok: false,
    code: "FRAME_LIST_UNAVAILABLE",
    formError: "We couldn't check the frame list just now — try again.",
  };

  it("refuses a new card in words that say try again, and writes nothing", async () => {
    const stub = db();
    state.verifiedFails = true;
    expect(await createCardAction(payload())).toEqual(unavailable);
    expect(cardWrites(stub)).toHaveLength(0);
    // The list back: the same card saves.
    state.verifiedFails = false;
    expect(await createCardAction(payload())).toMatchObject({ ok: true });
  });

  it("refuses an edit that moves the frame or the colour the same way", async () => {
    state.existing = storedRow({ frame_style: { template: "m15" } });
    const stub = db();
    state.verifiedFails = true;
    expect(await updateCardAction(CARD, { color_identity: ["white"] })).toEqual(unavailable);
    expect(await updateCardAction(CARD, { frame_style: { template: "lotr" } })).toEqual(unavailable);
    expect(cardWrites(stub)).toHaveLength(0);
  });

  it("still saves an edit that leaves the frame and colour alone — it reads no list", async () => {
    state.existing = storedRow();
    const stub = db();
    state.verifiedFails = true;
    expect(await updateCardAction(CARD, { title: "Renamed" })).toMatchObject({ ok: true });
    expect(updateOf(stub).title).toBe("Renamed");
    expect(state.verifiedReads).toBe(0);
  });

  // The editor resends the back face on every token and double-faced edit
  // (`null` for a one-faced token — editBackFacePayload), and those frames
  // take a back body: the back gate read the list for a plain retitle. It
  // reads it now only when the gate looks at it — a stored back left alone
  // never — so none of these edits is refused by an outage.
  it.each(["m15token", "m20token", "m15tokentext"])("still saves a retitle of a one-faced token on %s", async (template) => {
    state.existing = storedRow({
      card_type: "token",
      supertype: "Creature",
      subtypes: ["Soldier"],
      title: "Soldier",
      power: "1",
      toughness: "1",
      color_identity: ["white"],
      frame_style: { template },
      back_face: null,
    });
    const stub = db();
    state.verifiedFails = true;
    expect(await updateCardAction(CARD, { title: "Soldier Captain", color_identity: ["white"], back_face: null })).toMatchObject({ ok: true });
    expect(updateOf(stub).title).toBe("Soldier Captain");
    expect(state.verifiedReads).toBe(0);
  });

  const back = {
    title: "Moonrage Brute",
    card_type: "creature",
    subtypes: ["Werewolf"],
    power: "3",
    toughness: "3",
    rules_text: "Daybound",
    art_url: "https://example.com/back.png",
    frame_style: { template: "m15dfcback" },
    color_identity: ["white"],
  };
  const transform = () =>
    storedRow({
      title: "Brutal Cathar",
      frame_style: { template: "m15dfcfront" },
      color_identity: ["white"],
      back_face: back,
    });

  it("still saves a retitle of a transform card, its back resent as stored", async () => {
    state.existing = transform();
    const stub = db();
    state.verifiedFails = true;
    expect(await updateCardAction(CARD, { title: "Brutal Captain", color_identity: ["white"], back_face: { ...back } })).toMatchObject({ ok: true });
    expect(updateOf(stub).title).toBe("Brutal Captain");
    expect(state.verifiedReads).toBe(0);
  });

  it("still saves Re-art's new pictures on both faces of a two-faced card", async () => {
    state.existing = transform();
    const stub = db();
    state.verifiedFails = true;
    const result = await updateCardAction(CARD, {
      art_url: "https://example.com/new-front.png",
      back_face: { ...back, art_url: "https://example.com/new-back.png" },
    });
    expect(result).toMatchObject({ ok: true });
    expect(updateOf(stub).art_url).toBe("https://example.com/new-front.png");
    expect((updateOf(stub).back_face as { art_url: string }).art_url).toBe("https://example.com/new-back.png");
    expect(state.verifiedReads).toBe(0);
  });

  it("still saves a retitle of a transform card whose back is a Saga on the saga back", async () => {
    const { power: _power, toughness: _toughness, ...words } = back;
    void _power;
    void _toughness;
    const sagaBack = { ...words, card_type: "enchantment", subtypes: ["Saga"], rules_text: "I — Draw a card.", frame_style: { template: "sagadfcback" } };
    state.existing = storedRow({ frame_style: { template: "m15dfcfront" }, color_identity: ["white"], back_face: sagaBack });
    const stub = db();
    state.verifiedFails = true;
    expect(await updateCardAction(CARD, { title: "Renamed", back_face: { ...sagaBack } })).toMatchObject({ ok: true });
    expect(updateOf(stub).title).toBe("Renamed");
    expect(state.verifiedReads).toBe(0);
  });

  it("still reads the list — and says try again — when the edit moves the back onto another body", async () => {
    state.existing = transform();
    const stub = db();
    state.verifiedFails = true;
    // A changed family re-derives the back's body: the gate checks it.
    expect(await updateCardAction(CARD, { frame_anatomy: { dfcIcon: "moon" } })).toEqual(unavailable);
    expect(cardWrites(stub)).toHaveLength(0);
  });
});
