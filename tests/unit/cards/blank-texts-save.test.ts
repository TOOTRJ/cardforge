import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import { BLANK_IS_NULL_TEXTS, createCardSchema, updateCardSchema, withBlankTexts } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// A text sent BLANK ("" or spaces) is NULL in the row — never the empty
// string. The text schemas trim and let "" through, and both card actions
// stored it: a second spelling of "no text" beside the NULL a new card
// stores for a field left empty (the creator never sends ""; a crafted
// payload, an old client or a script can). Rules, flavor, the four stats,
// the artist credit and the supertype; NOT printed_types and footer_text,
// where "" and NULL mean two different things.
// Harness: tests/unit/cards/clear-fields-save.test.ts.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  existing: null as unknown,
  client: null as unknown,
  paid: false,
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
  getEntitlements: async () => ({ premiumFrames: false, removeWatermark: state.paid, cardCapacity: -1 }),
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
    loyalty: "5",
    defense: "6",
    artist_credit: "Anya Vale",
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: null,
    frame_preview: false,
    frame_style: { template: "m15", finish: "regular" },
    printed_types: null,
    footer_text: null,
    lang: "en",
    ...over,
  };
}

const NEW_CARD = {
  title: "Kesh",
  game_system_id: GAME,
  card_type: "creature",
  color_identity: ["red"],
  frame_style: { template: "m15", finish: "regular" },
};

beforeEach(() => {
  state.existing = stored();
  state.paid = false;
});

describe("withBlankTexts", () => {
  it("the list is the nullable texts whose empty value is NULL", () => {
    expect([...BLANK_IS_NULL_TEXTS].sort()).toEqual(
      ["artist_credit", "defense", "flavor_text", "loyalty", "nickname", "power", "rules_text", "supertype", "toughness"].sort(),
    );
  });

  it("a blank becomes the given value; ink, other keys and absent keys are left alone", () => {
    const data = { rules_text: "", flavor_text: "  ", power: "3", title: "", printed_types: "", footer_text: "" };
    expect(withBlankTexts(data, null)).toEqual({ ...data, rules_text: null, flavor_text: null });
    const created = withBlankTexts(data, undefined);
    expect(created).toEqual({ power: "3", title: "", printed_types: "", footer_text: "" });
    expect(created).not.toHaveProperty("rules_text");
    // Nothing blank: the very same object.
    const clean = { rules_text: "Haste" };
    expect(withBlankTexts(clean, null)).toBe(clean);
    expect(withBlankTexts({}, null)).toEqual({});
  });
});

describe("the schemas let a blank through — the actions are what normalise it", () => {
  it.each(BLANK_IS_NULL_TEXTS)("%s", (key) => {
    expect(createCardSchema.parse({ title: "Kesh", game_system_id: GAME, [key]: "  " })[key]).toBe("");
    expect(updateCardSchema.parse({ [key]: "" })[key]).toBe("");
  });
});

/** A column a new card names only when it holds a text (the nickname, TODO
 *  6.3, migration 0141 — as printed_types: an insert across the migration's
 *  deploy never names a column the database may not have yet). Blank, it is
 *  left out of the insert: NULL by the column's default. */
const LEFT_OUT_WHEN_BLANK: readonly string[] = ["nickname"];

describe("createCardAction — a blank text is stored as NULL", () => {
  it.each(BLANK_IS_NULL_TEXTS)("%s", async (key) => {
    for (const blank of ["", "   ", "\n\t "]) {
      const stub = db();
      const result = await createCardAction({ ...NEW_CARD, [key]: blank });
      expect(result).toMatchObject({ ok: true });
      if (LEFT_OUT_WHEN_BLANK.includes(key)) expect(written(stub, "insert")).not.toHaveProperty(key);
      else expect(written(stub, "insert")).toMatchObject({ [key]: null });
    }
  });

  it("all of them at once, beside a text that has ink", async () => {
    const stub = db();
    await createCardAction({
      ...NEW_CARD,
      ...Object.fromEntries(BLANK_IS_NULL_TEXTS.map((key) => [key, " "])),
      rules_text: "Haste",
    });
    const row = written(stub, "insert")!;
    expect(row.rules_text).toBe("Haste");
    for (const key of BLANK_IS_NULL_TEXTS) {
      if (key === "rules_text") continue;
      if (LEFT_OUT_WHEN_BLANK.includes(key)) expect(row).not.toHaveProperty(key);
      else expect(row[key]).toBeNull();
    }
  });

  it("printed_types \"\" is NOT blank-is-NULL: an emptied Types field prints the subtypes alone", async () => {
    const stub = db();
    await createCardAction({ ...NEW_CARD, printed_types: "" });
    expect(written(stub, "insert")).toMatchObject({ printed_types: "" });
  });

  it("footer_text \"\" is NOT blank-is-NULL: explicitly no footer mark (a subscriber's)", async () => {
    state.paid = true;
    const stub = db();
    await createCardAction({ ...NEW_CARD, footer_text: "  " });
    expect(written(stub, "insert")).toMatchObject({ footer_text: "" });
  });

  it("…and a footer left out is NULL — the profile default", async () => {
    state.paid = true;
    const stub = db();
    await createCardAction(NEW_CARD);
    expect(written(stub, "insert")).toMatchObject({ footer_text: null });
  });
});

describe("updateCardAction — a blank text clears the column to NULL", () => {
  it.each(BLANK_IS_NULL_TEXTS)("%s", async (key) => {
    for (const blank of ["", "   "]) {
      const stub = db();
      const result = await updateCardAction(CARD, { [key]: blank });
      expect(result).toMatchObject({ ok: true });
      const row = written(stub, "update")!;
      expect(row).toHaveProperty(key, null);
      // …and it alone.
      for (const other of BLANK_IS_NULL_TEXTS) if (other !== key) expect(row).not.toHaveProperty(other);
    }
  });

  it("a text with ink is written as sent; an omitted one is left alone", async () => {
    const stub = db();
    await updateCardAction(CARD, { flavor_text: "", rules_text: "Trample" });
    const row = written(stub, "update")!;
    expect(row).toMatchObject({ flavor_text: null, rules_text: "Trample" });
    expect(row).not.toHaveProperty("artist_credit");
    expect(row).not.toHaveProperty("power");
  });

  it("printed_types \"\" stays \"\"", async () => {
    const stub = db();
    await updateCardAction(CARD, { printed_types: "" });
    expect(written(stub, "update")).toMatchObject({ printed_types: "" });
  });
});

// The footer mark's three stored values (migration 0090): NULL = the profile
// default at download time, "" = explicitly none, a text = this card's own.
describe("updateCardAction — the footer mark", () => {
  it("left out (the editor, when the maker didn't touch the field): the column is not written", async () => {
    state.paid = true;
    const stub = db();
    await updateCardAction(CARD, { title: "Kesh the Second" });
    const row = written(stub, "update")!;
    expect(row.title).toBe("Kesh the Second");
    expect(row).not.toHaveProperty("footer_text");
  });

  it("\"\" is explicitly none, null is back to the profile default, a text is the card's own", async () => {
    state.paid = true;
    for (const [sent, kept] of [
      ["", ""],
      ["  ", ""],
      [null, null],
      [" kesh.example ", "kesh.example"],
    ] as const) {
      const stub = db();
      await updateCardAction(CARD, { footer_text: sent });
      expect(written(stub, "update")).toHaveProperty("footer_text", kept);
    }
  });

  it("a free account's edit never writes it", async () => {
    const stub = db();
    await updateCardAction(CARD, { title: "Kesh the Second", footer_text: "mine" });
    expect(written(stub, "update")).not.toHaveProperty("footer_text");
  });
});
