import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import { createCardSchema, updateCardSchema } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// An EMPTIED optional text on an edit (bug 2026-10-12: a flavor text emptied
// in the editor was saved — updated_at moved — and came back on reload).
// updateCardAction writes a column only when its key is defined, and the
// creator sent `undefined` for an empty field, so nothing said "clear this".
// The update schema now takes null for the optional texts (cost, rules,
// flavor, the four stats, artist, art) and the action clears the column to
// NULL — what a card that never had the text holds; omitted still leaves it
// alone, and a create still refuses null.
// Harness: tests/unit/cards/print-typography-save.test.ts.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
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
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () => ["m15/r", "m15/m", "m15/b", "m15pw/r"],
}));
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

import { updateCardAction } from "@/lib/cards/actions";

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
    cost: "{2}{R}{R}",
    rules_text: "Haste",
    flavor_text: "“Hold the line.”",
    power: "3",
    toughness: "4",
    loyalty: null,
    defense: null,
    artist_credit: "Anya Vale",
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: null,
    frame_preview: false,
    frame_style: { template: "m15", finish: "regular" },
    set_code: "DMU",
    collector_number: "107/281",
    lang: "en",
    ...over,
  };
}

const CLEARABLE = [
  "cost",
  "rules_text",
  "flavor_text",
  "power",
  "toughness",
  "loyalty",
  "defense",
  "artist_credit",
  "art_url",
] as const;

beforeEach(() => {
  state.existing = stored();
});

describe("updateCardSchema — null is an emptied field", () => {
  it.each(CLEARABLE)("%s: null stays null, omitted stays omitted", (key) => {
    expect(updateCardSchema.parse({ [key]: null })[key]).toBeNull();
    expect(updateCardSchema.parse({})[key]).toBeUndefined();
  });

  it.each(CLEARABLE)("a create refuses a null %s", (key) => {
    const base = { title: "Kesh", game_system_id: GAME };
    expect(createCardSchema.safeParse(base).success).toBe(true);
    expect(createCardSchema.safeParse({ ...base, [key]: null }).success).toBe(false);
  });
});

// The sentinel is an allow-list: null means "clear" only for a column that
// may be NULL. Everything a card must keep refuses it, and a key the schema
// doesn't name (the owner, the id, the render pointers 0126 guards) never
// reaches the write.
describe("updateCardSchema — what null can NOT clear", () => {
  const NEVER_NULL = [
    "title",
    "slug",
    "game_system_id",
    "color_identity",
    "supertype",
    "card_type",
    "subtypes",
    "tags",
    "rarity",
    "art_position",
    "frame_style",
    "visibility",
    "parent_card_id",
    "lang",
    "frame_preview",
    "frame_anatomy",
  ] as const;

  it.each(NEVER_NULL)("a null %s is refused", (key) => {
    expect(updateCardSchema.safeParse({ [key]: null }).success).toBe(false);
  });

  it("every key that takes null is a nullable column — the list is pinned", () => {
    const takesNull = Object.keys(updateCardSchema.shape).filter(
      (key) => updateCardSchema.safeParse({ [key]: null }).success,
    );
    expect(takesNull.sort()).toEqual(
      [
        ...CLEARABLE,
        // Nullable before this change (null = clear / none / the built line).
        "printed_types",
        "back_face",
        "back_card_id",
        "source_scryfall_id",
        "set_icon_url",
        "set_icon_code",
        "set_code",
        "collector_number",
        "deck_id",
        "face_content",
        "watermark",
        "footer_text",
      ].sort(),
    );
  });

  it("an empty title is refused, null or \"\"", () => {
    expect(updateCardSchema.safeParse({ title: "" }).success).toBe(false);
    expect(updateCardSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("keys the schema doesn't name are dropped", () => {
    expect(
      updateCardSchema.parse({
        owner_id: USER,
        id: CARD,
        rendered_image_url: null,
        rendered_thumb_url: null,
        layout_version: null,
        created_at: null,
        likes_count: null,
      }),
    ).toEqual({});
  });
});

describe("updateCardAction — an emptied field is cleared", () => {
  it("a crafted clear of the owner, the id or the title writes nothing", async () => {
    const stub = db();
    // Only unknown keys: nothing to change.
    expect(await updateCardAction(CARD, { owner_id: null, id: null })).toMatchObject({ ok: false });
    // A null title fails validation whole — the flavor beside it isn't cleared.
    const refused = await updateCardAction(CARD, { title: null, flavor_text: null });
    expect(refused.ok).toBe(false);
    expect(written(stub, "update")).toBeUndefined();
  });

  it("an emblem's fixed fields: a clear stays a clear, an omitted one stays omitted", async () => {
    state.existing = stored({
      card_type: "emblem",
      supertype: null,
      cost: null,
      power: null,
      toughness: null,
      color_identity: ["colorless"],
      frame_style: { template: "emblem", finish: "regular" },
    });
    const stub = db();
    await updateCardAction(CARD, { rules_text: null, flavor_text: null, cost: null });
    const row = written(stub, "update")!;
    expect(row).toMatchObject({ rules_text: null, flavor_text: null, cost: null });
    for (const key of ["power", "toughness", "loyalty", "defense", "supertype", "color_identity"]) {
      expect(row).not.toHaveProperty(key);
    }
  });

  it("print typography still touches only a text the save changes", async () => {
    // Straight quotes typed on an old card: resent as stored, they stay.
    state.existing = stored({ rules_text: "It's \"old\".", flavor_text: "\"Hold.\"" });
    const stub = db();
    await updateCardAction(CARD, { rules_text: "It's \"old\".", flavor_text: null });
    expect(written(stub, "update")).toMatchObject({ rules_text: "It's \"old\".", flavor_text: null });
  });

  it("the flavor text: null clears the column and nothing else is written", async () => {
    const stub = db();
    const result = await updateCardAction(CARD, { flavor_text: null });
    expect(result).toMatchObject({ ok: true });
    const row = written(stub, "update")!;
    expect(row.flavor_text).toBeNull();
    for (const key of CLEARABLE) if (key !== "flavor_text") expect(row).not.toHaveProperty(key);
  });

  it.each(CLEARABLE.filter((key) => key !== "art_url"))("%s", async (key) => {
    const stub = db();
    const result = await updateCardAction(CARD, { [key]: null });
    expect(result).toMatchObject({ ok: true });
    expect(written(stub, "update")).toMatchObject({ [key]: null });
  });

  it("omitted leaves the stored text alone", async () => {
    const stub = db();
    await updateCardAction(CARD, { rarity: "rare" });
    const row = written(stub, "update")!;
    expect(row.rarity).toBe("rare");
    for (const key of CLEARABLE) expect(row).not.toHaveProperty(key);
  });

  it("what the creator sends: the emptied field null, the rest as stored — and only it changes", async () => {
    const stub = db();
    await updateCardAction(CARD, {
      title: "Kesh",
      cost: "{2}{R}{R}",
      rules_text: "Haste",
      flavor_text: null,
      power: "3",
      toughness: "4",
      artist_credit: "Anya Vale",
      art_url: "https://example.com/art.png",
    });
    expect(written(stub, "update")).toMatchObject({
      rules_text: "Haste",
      flavor_text: null,
      power: "3",
      toughness: "4",
      artist_credit: "Anya Vale",
    });
  });

  it("the art removed from a public card: cleared, and the card goes back to a draft", async () => {
    const stub = db();
    const result = await updateCardAction(CARD, { art_url: null });
    expect(result).toMatchObject({ ok: true });
    expect(written(stub, "update")).toMatchObject({ art_url: null, visibility: "private" });
  });

  it("a planeswalker with every row emptied: rules text and rows both clear", async () => {
    state.existing = stored({
      card_type: "planeswalker",
      power: null,
      toughness: null,
      loyalty: "4",
      rules_text: "+1: Draw a card.",
      face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: "Draw a card." }] } },
      frame_style: { template: "m15pw", finish: "regular" },
    });
    const stub = db();
    await updateCardAction(CARD, { rules_text: null, face_content: null, loyalty: null });
    expect(written(stub, "update")).toMatchObject({ rules_text: null, face_content: null, loyalty: null });
  });
});
