import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 6.11 — print typography through the card ACTIONS, the one gate every
// save passes (the creator, the AI jobs, the deck remix, a crafted payload):
//   • createCardAction stores a NEW card's text as print sets it — both
//     faces, the subtypes, a walker's rows and their serialized copy;
//   • updateCardAction converts only the fields whose text the save CHANGES:
//     the creator resends every revisable field, and one that comes back as
//     it is stored is written back byte for byte — a stored card never
//     changes where its owner did not edit it;
//   • the slug of a new card is the one its typed title would have had.
// Harness: tests/unit/cards/anatomy-save.test.ts.
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
    frame_style: { template: "m15", finish: "regular" },
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
    frame_style: { template: "m15", finish: "regular" },
    set_code: "DMU",
    collector_number: "107/281",
    lang: "en",
    ...over,
  };
}

beforeEach(() => {
  state.existing = null;
});

describe("createCardAction — a new card is stored as print sets it", () => {
  it("title, subtypes, rules and flavor", async () => {
    const stub = db();
    const result = await createCardAction(
      payload({
        title: "Kesh's \"Last\" Stand",
        subtypes: ["Urza's", "Warden"],
        rules_text: "Landfall - It can't block.\nChoose one -\n- Draw a card.\n* {T}'s owner gains 1 life.\nIt gets -1/-1 and X-1.",
        flavor_text: "\"Hold the line.\"\n-Kesh, in the '90s",
      }),
    );
    expect(result.ok).toBe(true);
    const row = written(stub, "insert");
    expect(row?.title).toBe("Kesh’s “Last” Stand");
    expect(row?.subtypes).toEqual(["Urza’s", "Warden"]);
    expect(row?.rules_text).toBe(
      "Landfall — It can’t block.\nChoose one —\n• Draw a card.\n• {T}’s owner gains 1 life.\nIt gets -1/-1 and X-1.",
    );
    expect(row?.flavor_text).toBe("“Hold the line.”\n—Kesh, in the ’90s");
    // The slug is the typed title's: an apostrophe of either kind is a break.
    expect(row?.slug).toBe("kesh-s-last-stand");
    // Nothing else is read: the cost keeps its braces.
    expect(row?.cost).toBe("{2}{R}{R}");
  });

  it("a planeswalker's rows and the serialized copy that follows them", async () => {
    const stub = db();
    state.client = stub.client;
    const abilities = [
      { cost: "+1", text: "It can't block." },
      { cost: "-3", text: "Creatures you control have \"{T}: Draw a card.\"" },
    ];
    const result = await createCardAction(
      payload({
        card_type: "planeswalker",
        power: undefined,
        toughness: undefined,
        loyalty: "4",
        frame_style: { template: "m15pw", finish: "regular" },
        rules_text: "+1: It can't block.\n-3: Creatures you control have \"{T}: Draw a card.\"",
        face_content: { v: 1, loyalty: { abilities } },
      }),
    );
    expect(result).toMatchObject({ ok: true });
    const row = written(stub, "insert") as { rules_text: string; face_content: { loyalty: { abilities: { cost: string; text: string }[] } } };
    expect(row.face_content.loyalty.abilities).toEqual([
      { cost: "+1", text: "It can’t block." },
      { cost: "-3", text: "Creatures you control have “{T}: Draw a card.”" },
    ]);
    expect(row.rules_text).toBe("+1: It can’t block.\n-3: Creatures you control have “{T}: Draw a card.”");
  });
});

describe("updateCardAction — only what the save changes", () => {
  const OLD = {
    title: "Kesh's Stand",
    rules_text: "It can't block.",
    flavor_text: "\"Hold.\"\n-Kesh",
  };

  it("every field resent as stored: written back byte for byte", async () => {
    state.existing = stored(OLD);
    const stub = db();
    const result = await updateCardAction(CARD, { ...OLD, rarity: "rare" });
    expect(result.ok).toBe(true);
    const row = written(stub, "update");
    expect(row?.title).toBe(OLD.title);
    expect(row?.rules_text).toBe(OLD.rules_text);
    expect(row?.flavor_text).toBe(OLD.flavor_text);
  });

  it("one field edited: that field whole, the others as stored", async () => {
    state.existing = stored(OLD);
    const stub = db();
    const result = await updateCardAction(CARD, { ...OLD, rules_text: "It can't block. It's sworn." });
    expect(result.ok).toBe(true);
    const row = written(stub, "update");
    expect(row?.rules_text).toBe("It can’t block. It’s sworn.");
    expect(row?.title).toBe(OLD.title);
    expect(row?.flavor_text).toBe(OLD.flavor_text);
  });

  // What the editor sends for a walker / a saga: its rows (parsed from the
  // stored rules_text when the card holds no face_content — lib/creator/
  // card-fields.ts structuredRowsFrom) and their serialized copy.
  const walker = (over: Record<string, unknown>) =>
    stored({ card_type: "planeswalker", loyalty: "4", frame_style: { template: "m15pw", finish: "regular" }, ...over });
  const WALKER_ROWS = [
    { cost: "+1", text: "It can't block." },
    { cost: "-3", text: 'Creatures you control have "{T}: Draw a card."' },
  ];
  const WALKER_TEXT = "+1: It can't block.\n-3: Creatures you control have \"{T}: Draw a card.\"";

  it("a walker saved before the structured rows (rules_text, no face_content): a save that edits no row converts none", async () => {
    state.existing = walker({ rules_text: WALKER_TEXT, face_content: null });
    const stub = db();
    const result = await updateCardAction(CARD, {
      rarity: "rare",
      rules_text: WALKER_TEXT,
      face_content: { v: 1, loyalty: { abilities: WALKER_ROWS } },
    });
    expect(result).toMatchObject({ ok: true });
    const row = written(stub, "update") as { rules_text: string; face_content: { loyalty: { abilities: unknown[] } } };
    expect(row.face_content.loyalty.abilities).toEqual(WALKER_ROWS);
    expect(row.rules_text).toBe(WALKER_TEXT);
  });

  it("…whose stored text prints its costs with U+2212: the copy is re-serialized, its rows still as stored", async () => {
    state.existing = walker({ rules_text: WALKER_TEXT.replace("-3:", "−3:"), face_content: null });
    const stub = db();
    await updateCardAction(CARD, { rules_text: WALKER_TEXT, face_content: { v: 1, loyalty: { abilities: WALKER_ROWS } } });
    const row = written(stub, "update") as { rules_text: string; face_content: { loyalty: { abilities: unknown[] } } };
    expect(row.face_content.loyalty.abilities).toEqual(WALKER_ROWS);
    expect(row.rules_text).toBe(WALKER_TEXT);
  });

  it("a walker with ONE row edited: that row whole, the other as stored — in the copy too", async () => {
    state.existing = walker({ rules_text: WALKER_TEXT, face_content: { v: 1, loyalty: { abilities: WALKER_ROWS } } });
    const stub = db();
    const edited = [{ cost: "+1", text: "It can't block. It's sworn." }, WALKER_ROWS[1]];
    await updateCardAction(CARD, {
      rules_text: `+1: It can't block. It's sworn.\n-3: ${WALKER_ROWS[1].text}`,
      face_content: { v: 1, loyalty: { abilities: edited } },
    });
    const row = written(stub, "update") as { rules_text: string; face_content: { loyalty: { abilities: unknown[] } } };
    expect(row.face_content.loyalty.abilities).toEqual([{ cost: "+1", text: "It can’t block. It’s sworn." }, WALKER_ROWS[1]]);
    expect(row.rules_text).toBe(`+1: It can’t block. It’s sworn.\n-3: ${WALKER_ROWS[1].text}`);
  });

  it("a saga saved before the structured rows: intro and chapters as stored", async () => {
    const intro = "(As this Saga enters, add a lore counter. It's sacrificed after II.)";
    const chapters = [
      { numerals: [1], text: "It can't block." },
      { numerals: [2], text: 'Create a token with "{T}: Add {G}."' },
    ];
    const text = `${intro}\nI — It can't block.\nII — Create a token with "{T}: Add {G}."`;
    state.existing = stored({ card_type: "enchantment", subtypes: ["Saga"], frame_style: { template: "saga", finish: "regular" }, rules_text: text, face_content: null });
    const stub = db();
    const result = await updateCardAction(CARD, { rarity: "rare", rules_text: text, face_content: { v: 1, saga: { intro, chapters } } });
    expect(result).toMatchObject({ ok: true });
    const row = written(stub, "update") as { rules_text: string; face_content: { saga: { intro: string; chapters: unknown[] } } };
    expect(row.face_content.saga).toEqual({ intro, chapters });
    expect(row.rules_text).toBe(text);
  });

  it("the second face: resent as stored it is kept; one field of it edited, that field alone", async () => {
    const back = { title: "Kesh's Shade", card_type: "creature", subtypes: ["Urza's"], rules_text: "It can't block.", flavor_text: '"Gone."' };
    state.existing = stored({ ...OLD, back_face: back, frame_style: { template: "flip", finish: "regular" } });
    let stub = db();
    await updateCardAction(CARD, { rarity: "rare", back_face: back });
    expect(written(stub, "update")?.back_face).toMatchObject(back);
    stub = db();
    await updateCardAction(CARD, { back_face: { ...back, flavor_text: '"Gone," it said.' } });
    expect(written(stub, "update")?.back_face).toMatchObject({ ...back, flavor_text: "“Gone,” it said." });
  });

  it("a save that names no text field writes none (the AI jobs' art + publish update)", async () => {
    state.existing = stored(OLD);
    const stub = db();
    await updateCardAction(CARD, { art_url: "https://example.com/art2.png", visibility: "public" });
    const row = written(stub, "update") ?? {};
    for (const key of ["title", "rules_text", "flavor_text", "supertype", "subtypes", "back_face", "face_content"]) expect(key in row, key).toBe(false);
  });

  it("a field typed over a stored null is converted", async () => {
    state.existing = stored({ ...OLD, flavor_text: null });
    const stub = db();
    await updateCardAction(CARD, { flavor_text: "\"New.\"" });
    expect(written(stub, "update")?.flavor_text).toBe("“New.”");
  });
});
