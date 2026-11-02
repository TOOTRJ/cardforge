import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The card actions and AI provenance (TODO CP1, migration 0161):
//   * a save's `ai_fields` is a CLAIM — kept only where a receipt of the same
//     owner holds the same text as the row being written, and then written
//     by the SERVICE ROLE (add_card_ai_fields), never in the row the user's
//     session writes (0161's guard refuses an API role naming the column);
//   * a remix inherits its parent's AI parts it still holds unchanged;
//   * a save with no claim reads no receipt and writes no provenance.
// (An edit's rewrite of a part is dropped by the database itself.)
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const PARENT = "55555555-5555-4555-8555-555555555555";

const state = vi.hoisted(() => ({
  existing: null as unknown,
  client: null as unknown,
  admin: null as unknown,
  receipts: [] as unknown[],
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.admin,
  isAdminConfigured: () => true,
}));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => ["m15/w"] }));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.existing,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ premiumFrames: true, removeWatermark: true, cardCapacity: -1 }),
}));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn() }));
vi.mock("@/lib/decks/membership", () => ({ addCustomCardEntryToDeck: async () => undefined }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: async () => undefined }));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCard: vi.fn(),
  purgeHiddenCards: vi.fn(),
  revalidateCardListSurfaces: vi.fn(),
  revalidateCardPaths: vi.fn(),
}));
vi.mock("@/lib/cards/remix-media", () => ({
  adoptRemixMedia: vi.fn(async (_user: string, _parent: unknown, media: Record<string, unknown>) => ({ ok: true, ...media })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createCardAction, updateCardAction } from "@/lib/cards/actions";

const newCard = (over: Record<string, unknown> = {}) => ({
  title: "Urza’s Spark",
  game_system_id: "33333333-3333-4333-8333-333333333333",
  card_type: "creature",
  color_identity: ["white"],
  subtypes: ["Elemental"],
  power: "2",
  toughness: "1",
  rules_text: "Haste",
  flavor_text: "Mine.",
  frame_style: { template: "m15" },
  visibility: "private",
  ...over,
});

let user: ReturnType<typeof chainClient>;
let admin: ReturnType<typeof chainClient>;

beforeEach(() => {
  state.existing = null;
  state.receipts = [];
  user = chainClient((table): ChainAnswer => (table === "cards" ? { data: { id: CARD, slug: "urzas-spark" }, error: null } : { error: null }));
  state.client = user.client;
  admin = chainClient((table): ChainAnswer => (table === "card_ai_receipts" ? { data: state.receipts, error: null } : { error: null }));
  state.admin = admin.client;
});

const marked = () =>
  admin.rpc.mock.calls
    .filter((call) => (call as unknown[])[0] === "add_card_ai_fields")
    .map((call) => (call as unknown[])[1]);
const receiptReads = () => admin.forTable("card_ai_receipts").length;
const cardWrites = () =>
  user.forTable("cards").flatMap((entry) =>
    ["insert", "update"].filter((method) => called(entry.calls, method)).map((method) => payloadOf(entry.calls, method) as Record<string, unknown>),
  );

describe("createCardAction — a claim is checked, then written by the service role", () => {
  it("keeps the claimed parts a receipt holds with the same text", async () => {
    state.receipts = [{ values: [{ title: "Urza's Spark", rules_text: "Haste", flavor_text: "Something else." }] }];
    const result = await createCardAction(newCard({ ai_fields: ["title", "rules_text", "flavor_text"] }));
    expect(result.ok).toBe(true);
    expect(marked()).toEqual([{ p_card_id: CARD, p_owner_id: USER, p_fields: ["rules_text", "title"] }]);
    // The user's own write never names the column.
    for (const row of cardWrites()) expect(row).not.toHaveProperty("ai_fields");
  });

  it("a claim no receipt backs writes nothing (a hand-made card claimed as AI)", async () => {
    state.receipts = [];
    expect((await createCardAction(newCard({ ai_fields: ["title", "rules_text"] }))).ok).toBe(true);
    expect(marked()).toEqual([]);
  });

  it("a save with no claim reads no receipt and marks nothing", async () => {
    expect((await createCardAction(newCard())).ok).toBe(true);
    expect(receiptReads()).toBe(0);
    expect(marked()).toEqual([]);
  });

  it("a claim of a part the schema doesn't know is refused as a field error", async () => {
    const result = await createCardAction(newCard({ ai_fields: ["art"] }));
    expect(result.ok).toBe(false);
    expect(cardWrites()).toEqual([]);
  });

  it("a remix inherits its parent's AI parts it still holds as they were", async () => {
    state.existing = {
      id: PARENT,
      owner_id: USER,
      title: "Urza’s Spark",
      rules_text: "Haste",
      flavor_text: "Theirs.",
      ai_fields: ["title", "rules_text", "flavor_text", "art"],
      visibility: "public",
    };
    const result = await createCardAction(newCard({ title: "Urza’s Spark Remix", parent_card_id: PARENT }));
    expect(result.ok).toBe(true);
    expect(marked()).toEqual([{ p_card_id: CARD, p_owner_id: USER, p_fields: ["rules_text"] }]);
  });
});

describe("updateCardAction — a new AI part on an edit", () => {
  const stored = {
    id: CARD,
    owner_id: USER,
    slug: "urzas-spark",
    title: "Urza’s Spark",
    card_type: "creature",
    supertype: null,
    subtypes: ["Elemental"],
    rules_text: "Haste",
    flavor_text: null,
    tags: [],
    color_identity: ["white"],
    frame_style: { template: "m15" },
    visibility: "private",
    art_url: null,
    back_face: null,
    ai_fields: ["title"],
  };

  it("an edit that claims the flavour the AI just wrote adds it (checked against the row as saved)", async () => {
    state.existing = stored;
    state.receipts = [{ values: [{ flavor_text: "Fresh words." }] }];
    const result = await updateCardAction(CARD, { flavor_text: "Fresh words.", ai_fields: ["flavor_text", "title"] });
    expect(result.ok).toBe(true);
    // The title is the stored one, but no receipt holds it: only the flavour.
    expect(marked()).toEqual([{ p_card_id: CARD, p_owner_id: USER, p_fields: ["flavor_text"] }]);
    for (const row of cardWrites()) expect(row).not.toHaveProperty("ai_fields");
  });

  it("an edit with no claim marks nothing (the database drops what it changed)", async () => {
    state.existing = stored;
    expect((await updateCardAction(CARD, { rules_text: "Haste, trample" })).ok).toBe(true);
    expect(receiptReads()).toBe(0);
    expect(marked()).toEqual([]);
  });
});
