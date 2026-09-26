import { beforeEach, describe, expect, it, vi } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// The kind gate's wiring in the card actions (TODO 0.26). The verification
// gate publishes a (frame, colour) pair; the kind gate then refuses a card
// that frame can't draw — a planeswalker on the Zendikar Rising hedron
// frame, a shockland on the full-art basic frame — before anything else
// runs. A card that passes both gates reaches the entitlement check or the
// database, which these tests stub to throw a sentinel so nothing is written.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";
const PAST_GATES = "PAST_THE_FRAME_GATES";

const state = vi.hoisted(() => ({
  verified: [] as string[],
  existing: null as unknown,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
// Any database access means the card got past the gates.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      throw new Error("PAST_THE_FRAME_GATES");
    },
  }),
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
  isAdminConfigured: () => false,
}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () => state.verified,
}));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.existing,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => {
    throw new Error(PAST_GATES);
  },
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

const publishedEverywhere = ["fullart", "fullartland", "m15pw", "m15land"].flatMap((t) =>
  ["w", "u", "m", "c"].map((k) => frameComboKey(t as never, k)),
);

function payload(overrides: Record<string, unknown>) {
  return {
    title: "Test",
    game_system_id: GAME,
    card_type: "creature",
    color_identity: ["white"],
    supertype: "",
    subtypes: [],
    rules_text: "",
    frame_style: { template: "fullart" },
    ...overrides,
  };
}

beforeEach(() => {
  state.verified = publishedEverywhere;
  state.existing = null;
});

describe("createCardAction kind gate", () => {
  it("refuses a planeswalker on the Zendikar Rising hedron frame", async () => {
    const result = await createCardAction(payload({ card_type: "planeswalker" }));
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        frame_style:
          "The Zendikar Rising Hedron frame doesn't dress Planeswalker cards — pick another frame.",
      },
    });
  });

  it("refuses a nonbasic land on the full-art basic frame", async () => {
    const result = await createCardAction(
      payload({
        title: "Hallowed Fountain",
        card_type: "land",
        subtypes: ["Plains", "Island"],
        rules_text: "({T}: Add {W} or {U}.)",
        frame_style: { template: "fullartland" },
      }),
    );
    expect(result).toEqual({
      ok: false,
      fieldErrors: { frame_style: "Full-art basic frames are for basic lands — pick another frame." },
    });
  });

  it("lets a basic Plains and a creature through both gates", async () => {
    await expect(
      createCardAction(
        payload({
          title: "Plains",
          card_type: "land",
          supertype: "Basic",
          subtypes: ["Plains"],
          frame_style: { template: "fullartland" },
        }),
      ),
    ).rejects.toThrow(PAST_GATES);
    await expect(createCardAction(payload({}))).rejects.toThrow(PAST_GATES);
  });

  it("reads the title: Wastes is a basic land with no land type", async () => {
    const wastes = (title: string) =>
      payload({
        title,
        card_type: "land",
        supertype: "Basic",
        subtypes: [],
        color_identity: ["colorless"],
        frame_style: { template: "fullartland" },
      });
    await expect(createCardAction(wastes("Wastes"))).rejects.toThrow(PAST_GATES);
    expect(await createCardAction(wastes("Barren Plain"))).toEqual({
      ok: false,
      fieldErrors: { frame_style: "Full-art basic frames are for basic lands — pick another frame." },
    });
  });
});

describe("updateCardAction kind gate", () => {
  const plainsRow = {
    id: CARD,
    owner_id: USER,
    title: "Plains",
    card_type: "land",
    supertype: "Basic",
    subtypes: ["Plains"],
    rules_text: null,
    color_identity: ["white"],
    frame_style: { template: "fullartland" },
  };

  it("refuses a patch that turns a full-art Plains into a shockland", async () => {
    state.existing = plainsRow;
    const result = await updateCardAction(CARD, {
      title: "Hallowed Fountain",
      supertype: "",
      subtypes: ["Plains", "Island"],
      rules_text: "({T}: Add {W} or {U}.)",
    });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { frame_style: "Full-art basic frames are for basic lands — pick another frame." },
    });
  });

  it("reads every identity field from the patch over the stored row", async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [plainsRow, { subtypes: ["Plains", "Island"] }],
      [plainsRow, { card_type: "creature" }],
      [{ ...plainsRow, title: "Wastes", subtypes: [], color_identity: ["colorless"] }, { title: "Barren Plain" }],
      [{ ...plainsRow, title: "Forest", supertype: null, subtypes: ["Forest"], color_identity: ["green"] }, { rules_text: "{T}: Add {G}." }],
      [{ ...plainsRow, rules_text: "({T}: Add {W}.)" }, { supertype: "" }],
    ];
    for (const [row, patch] of cases) {
      state.existing = row;
      const result = await updateCardAction(CARD, patch);
      expect(result, JSON.stringify(patch)).toMatchObject({ ok: false, fieldErrors: { frame_style: expect.any(String) } });
    }
  });

  it("refuses moving a planeswalker onto the hedron frame", async () => {
    state.existing = { ...plainsRow, title: "Nissa", card_type: "planeswalker", supertype: "Legendary", subtypes: ["Nissa"], frame_style: { template: "m15pw" } };
    const result = await updateCardAction(CARD, { frame_style: { template: "fullart" } });
    expect(result).toMatchObject({ ok: false, fieldErrors: { frame_style: expect.stringMatching(/Planeswalker cards/) } });
  });

  it("keeps a card that already broke the rule editable while its frame stays", async () => {
    state.existing = {
      ...plainsRow,
      title: "Hallowed Fountain",
      supertype: null,
      subtypes: ["Plains", "Island"],
      rules_text: "({T}: Add {W} or {U}.)",
    };
    await expect(updateCardAction(CARD, { flavor_text: "Still here." })).rejects.toThrow(PAST_GATES);
  });
});
