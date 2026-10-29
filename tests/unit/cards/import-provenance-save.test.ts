import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import { importFingerprintOf } from "@/lib/cards/import-fingerprint";
import { importProvenanceInsert, isMissingImportProvenanceColumn } from "@/lib/cards/import-provenance";

// ---------------------------------------------------------------------------
// Import provenance on the save (TODO DK2.5, migration 0144): createCardAction
// writes `import_scryfall_id` + `import_fingerprint` on the INSERT only, and
// only for a card with a Scryfall source that is not a remix; the
// fingerprint only when the creator says the card is still the import's,
// computed from the row as inserted. updateCardAction never names them (the
// columns are insert-only; 0144's guard refuses a change). Every other save
// is pinned byte for byte: no new key in its insert.
// Harness: tests/unit/cards/blank-texts-save.test.ts.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";
const SOURCE = "581b7327-3215-4a4f-b4ae-d9d4002ba882";
const PARENT = "44444444-4444-4444-8444-444444444444";
const DECK = "55555555-5555-4555-8555-555555555555";

const state = vi.hoisted(() => ({
  existing: null as unknown,
  client: null as unknown,
  /** Answer the first cards insert with PostgREST's missing-column error. */
  missingColumns: false,
  addToDeck: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminConfigured: () => false }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => ["m15/g", "m15/r"] }));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.existing,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ premiumFrames: false, removeWatermark: true, cardCapacity: -1 }),
}));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn() }));
vi.mock("@/lib/decks/membership", () => ({ addCustomCardEntryToDeck: state.addToDeck }));
vi.mock("@/lib/cards/remix-media", () => ({ adoptRemixMedia: async (_u: string, _p: unknown, media: unknown) => ({ ok: true, ...(media as object) }) }));
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
  let inserts = 0;
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && called(calls, "insert")) {
      inserts += 1;
      if (state.missingColumns && inserts === 1) {
        return { data: null, error: { code: "PGRST204", message: "Could not find the 'import_fingerprint' column of 'cards' in the schema cache" } };
      }
      return { data: { id: CARD, slug: "llanowar-elves" }, error: null };
    }
    if (table === "cards" && called(calls, "update")) return { data: { id: CARD, slug: "llanowar-elves" }, error: null };
    return { data: null, error: null, count: 0 };
  });
  state.client = stub.client;
  return stub;
}

const writes = (stub: ReturnType<typeof db>, op: "insert" | "update") =>
  stub
    .forTable("cards")
    .filter((e) => called(e.calls, op))
    .map((e) => payloadOf(e.calls, op) as Record<string, unknown>);

const IMPORT = {
  title: "Llanowar Elves",
  game_system_id: GAME,
  cost: "{G}",
  color_identity: ["green"],
  card_type: "creature",
  subtypes: ["Elf", "Druid"],
  rules_text: "{T}: Add {G}.",
  power: "1",
  toughness: "1",
  artist_credit: "Chris Rahn",
  frame_style: { template: "m15", finish: "regular" },
  visibility: "private",
  source_scryfall_id: SOURCE,
};

beforeEach(() => {
  state.existing = null;
  state.missingColumns = false;
  state.addToDeck.mockReset();
});

describe("createCardAction — import provenance", () => {
  it("an import saved unchanged: the source and the fingerprint of the row as inserted", async () => {
    const stub = db();
    const result = await createCardAction({ ...IMPORT, import_unchanged: true });
    expect(result.ok).toBe(true);
    const [row] = writes(stub, "insert");
    expect(row.import_scryfall_id).toBe(SOURCE);
    expect(row.import_fingerprint).toBe(importFingerprintOf(row));
    expect(row.import_fingerprint).toMatch(/^v1:[0-9a-f]{64}$/);
    // The flag itself never reaches the row.
    expect(row).not.toHaveProperty("import_unchanged");
  });

  it("an import changed before its first save (or an AI restyle): the source, no fingerprint", async () => {
    for (const payload of [{ ...IMPORT, import_unchanged: false }, { ...IMPORT }]) {
      const stub = db();
      await createCardAction(payload);
      const [row] = writes(stub, "insert");
      expect(row.import_scryfall_id).toBe(SOURCE);
      expect(row.import_fingerprint).toBeNull();
    }
  });

  it("a remix carries no import provenance (its lineage is its parent)", async () => {
    state.existing = { id: PARENT, owner_id: USER, art_url: null, back_face: null, watermark: null };
    const stub = db();
    await createCardAction({ ...IMPORT, parent_card_id: PARENT, import_unchanged: true });
    const [row] = writes(stub, "insert");
    expect(row.parent_card_id).toBe(PARENT);
    expect(row).not.toHaveProperty("import_scryfall_id");
    expect(row).not.toHaveProperty("import_fingerprint");
  });

  it("a card from scratch names neither column — its insert is what it was before 0144", async () => {
    const stub = db();
    const { source_scryfall_id: _source, ...scratch } = IMPORT;
    void _source;
    await createCardAction({ ...scratch, import_unchanged: true });
    const [row] = writes(stub, "insert");
    expect(row).not.toHaveProperty("import_scryfall_id");
    expect(row).not.toHaveProperty("import_fingerprint");
    expect(row.source_scryfall_id).toBeNull();
  });

  it("a database 0144 has not reached: the same insert again without the two columns", async () => {
    state.missingColumns = true;
    const stub = db();
    const result = await createCardAction({ ...IMPORT, import_unchanged: true });
    expect(result.ok).toBe(true);
    const [first, retry] = writes(stub, "insert");
    expect(first.import_scryfall_id).toBe(SOURCE);
    expect(retry).not.toHaveProperty("import_scryfall_id");
    expect(retry).not.toHaveProperty("import_fingerprint");
    expect({ ...retry }).toEqual(
      Object.fromEntries(Object.entries(first).filter(([key]) => key !== "import_scryfall_id" && key !== "import_fingerprint")),
    );
  });

  it("a card dropped into a deck: the creator's add by default, the caller's origin when named", async () => {
    db();
    await createCardAction({ ...IMPORT, deck_id: DECK });
    expect(state.addToDeck).toHaveBeenLastCalledWith(expect.anything(), USER, DECK, CARD, "Llanowar Elves", undefined);
    db();
    await createCardAction({ ...IMPORT, deck_id: DECK }, { deckEntry: { source: "ai_remix", scryfallId: SOURCE, name: "Llanowar Elves" } });
    expect(state.addToDeck).toHaveBeenLastCalledWith(expect.anything(), USER, DECK, CARD, "Llanowar Elves", {
      source: "ai_remix",
      scryfallId: SOURCE,
      name: "Llanowar Elves",
    });
  });
});

describe("updateCardAction — never the provenance", () => {
  it("an edit names neither column, whatever the payload says", async () => {
    state.existing = {
      id: CARD,
      owner_id: USER,
      title: "Llanowar Elves",
      slug: "llanowar-elves",
      color_identity: ["green"],
      card_type: "creature",
      supertype: null,
      subtypes: ["Elf", "Druid"],
      cost: "{G}",
      rules_text: "{T}: Add {G}.",
      visibility: "private",
      art_url: null,
      back_face: null,
      frame_preview: false,
      frame_style: { template: "m15", finish: "regular" },
      printed_types: null,
      footer_text: null,
      lang: "en",
      source_scryfall_id: SOURCE,
      import_scryfall_id: SOURCE,
      import_fingerprint: `v1:${"a".repeat(64)}`,
    };
    const stub = db();
    await updateCardAction(CARD, {
      title: "Llanowar Elder",
      import_unchanged: true,
      import_scryfall_id: "7bbd2cab-538e-4932-a828-150e3e9d52ad",
      import_fingerprint: `v1:${"b".repeat(64)}`,
    });
    const [update] = writes(stub, "update");
    expect(update).toBeDefined();
    expect(update.title).toBe("Llanowar Elder");
    for (const key of ["import_scryfall_id", "import_fingerprint", "import_unchanged"]) expect(update).not.toHaveProperty(key);
  });
});

describe("importProvenanceInsert / isMissingImportProvenanceColumn", () => {
  it("reads the source trimmed, and nothing for a blank one", () => {
    expect(importProvenanceInsert({ source_scryfall_id: `  ${SOURCE} ` }, {})).toEqual({ import_scryfall_id: SOURCE, import_fingerprint: null });
    expect(importProvenanceInsert({ source_scryfall_id: "  " }, {})).toEqual({});
    expect(importProvenanceInsert({ source_scryfall_id: null, import_unchanged: true }, {})).toEqual({});
  });

  it("knows PostgREST's and Postgres' missing-column answers, for these columns only", () => {
    expect(isMissingImportProvenanceColumn({ code: "PGRST204", message: "Could not find the 'import_scryfall_id' column of 'cards'" })).toBe(true);
    expect(isMissingImportProvenanceColumn({ code: "42703", message: 'column "import_fingerprint" of relation "cards" does not exist' })).toBe(true);
    expect(isMissingImportProvenanceColumn({ code: "PGRST204", message: "Could not find the 'nickname' column" })).toBe(false);
    expect(isMissingImportProvenanceColumn({ code: "23514", message: "import_fingerprint check" })).toBe(false);
    expect(isMissingImportProvenanceColumn(null)).toBe(false);
  });
});
