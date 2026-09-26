import { beforeEach, describe, expect, it, vi } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import {
  DRAFTS_MAY_OMIT_SECOND_FACE_NAME,
  SECOND_FACE_NAME_ERROR,
  missingSecondFaceName,
  secondFaceNameRequired,
} from "@/lib/cards/second-face-name";
import { called, type ChainCall } from "../../stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 3b.5 [decide], implemented as the recommendation: a private DRAFT may
// be saved with its second face (Adventure spell, split / aftermath / flip
// half) unnamed; publishing (public or unlisted) needs the name. The server
// half: create, update (the patch over the stored row) and the dashboard's
// bulk publish all refuse an unnamed second face at a visible visibility.
// Anything that reaches the database (or the entitlement check) is past the
// gate — the stubs throw a sentinel there, so nothing is written.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const OTHER = "44444444-4444-4444-8444-444444444444";
const GAME = "33333333-3333-4333-8333-333333333333";
const PAST_GATES = "PAST_THE_GATES";

const state = vi.hoisted(() => ({
  existing: null as unknown,
  bulkRows: [] as unknown[],
  useChain: false,
  chainLog: null as null | { table: string; calls: ChainCall[] }[],
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", async () => {
  const { chainClient: makeChain } = await import("../../stubs/supabase-chain");
  return {
    createClient: async () => {
      if (!state.useChain) {
        return {
          from: () => {
            throw new Error("PAST_THE_GATES");
          },
        };
      }
      const chain = makeChain((table, calls) =>
        table === "cards" && calls.some((c) => c.method === "select")
          ? { data: state.bulkRows }
          : { data: null },
      );
      state.chainLog = chain.log;
      return {
        ...chain.client,
        storage: { from: () => ({ remove: async () => ({ error: null }) }) },
      };
    },
    getCurrentUser: async () => ({ id: USER }),
    getCurrentUsername: async () => "tester",
  };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
  isAdminConfigured: () => false,
}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () =>
    ["split", "adventure", "m15"].flatMap((t) =>
      ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k)),
    ),
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

import {
  createCardAction,
  updateCardAction,
  updateCardsVisibilityAction,
} from "@/lib/cards/actions";

const REFUSED = {
  ok: false,
  fieldErrors: { "back_face.title": SECOND_FACE_NAME_ERROR },
};

function splitCard(overrides: Record<string, unknown> = {}) {
  return {
    title: "Fire",
    game_system_id: GAME,
    card_type: "instant",
    color_identity: ["red"],
    rules_text: "Fire deals 2 damage divided as you choose.",
    art_url: "https://example.com/fire.png",
    frame_style: { template: "split" },
    back_face: { title: "", card_type: "instant", rules_text: "Tap two target permanents." },
    ...overrides,
  };
}

beforeEach(() => {
  state.existing = null;
  state.bulkRows = [];
  state.useChain = false;
  state.chainLog = null;
});

describe("the policy", () => {
  it("drafts may omit the name; anything visible needs it", () => {
    expect(DRAFTS_MAY_OMIT_SECOND_FACE_NAME).toBe(true);
    expect(secondFaceNameRequired("private")).toBe(false);
    expect(secondFaceNameRequired("unlisted")).toBe(true);
    expect(secondFaceNameRequired("public")).toBe(true);
    expect(missingSecondFaceName(null, "public")).toBe(false);
    expect(missingSecondFaceName({ title: " " }, "public")).toBe(true);
    expect(missingSecondFaceName({ title: " " }, "private")).toBe(false);
    expect(missingSecondFaceName({ title: "Ice" }, "public")).toBe(false);
  });
});

describe("createCardAction", () => {
  it("refuses to publish an unnamed second face", async () => {
    expect(await createCardAction(splitCard({ visibility: "public" }))).toEqual(REFUSED);
    expect(await createCardAction(splitCard({ visibility: "unlisted" }))).toEqual(REFUSED);
  });

  it("lets a private draft through with it unnamed", async () => {
    await expect(createCardAction(splitCard({ visibility: "private" }))).rejects.toThrow(
      PAST_GATES,
    );
    // Visibility omitted = the schema's private default.
    await expect(createCardAction(splitCard())).rejects.toThrow(PAST_GATES);
    // An artless "public" save is stored private — so no name needed.
    await expect(
      createCardAction(splitCard({ visibility: "public", art_url: undefined })),
    ).rejects.toThrow(PAST_GATES);
  });

  it("lets a named second face publish", async () => {
    await expect(
      createCardAction(
        splitCard({
          visibility: "public",
          back_face: { title: "Ice", card_type: "instant" },
        }),
      ),
    ).rejects.toThrow(PAST_GATES);
  });
});

describe("updateCardAction", () => {
  const storedDraft = {
    id: CARD,
    owner_id: USER,
    title: "Fire",
    card_type: "instant",
    supertype: null,
    subtypes: [],
    rules_text: "Fire deals 2 damage divided as you choose.",
    color_identity: ["red"],
    art_url: "https://example.com/fire.png",
    frame_style: { template: "split" },
    visibility: "private",
    back_face: { title: "", card_type: "instant" },
  };

  it("refuses to publish a stored draft whose second face is unnamed", async () => {
    state.existing = storedDraft;
    expect(await updateCardAction(CARD, { visibility: "public" })).toEqual(REFUSED);
  });

  it("refuses to clear the name of a public card", async () => {
    state.existing = {
      ...storedDraft,
      visibility: "public",
      back_face: { title: "Ice", card_type: "instant" },
    };
    expect(
      await updateCardAction(CARD, { back_face: { title: "", card_type: "instant" } }),
    ).toEqual(REFUSED);
  });

  it("lets the draft be edited, and published once the patch names it", async () => {
    state.existing = storedDraft;
    await expect(updateCardAction(CARD, { rules_text: "Fire deals 3 damage." })).rejects.toThrow(
      PAST_GATES,
    );
    await expect(
      updateCardAction(CARD, {
        visibility: "public",
        back_face: { title: "Ice", card_type: "instant" },
      }),
    ).rejects.toThrow(PAST_GATES);
  });
});

describe("updateCardsVisibilityAction (bulk publish)", () => {
  const row = (id: string, title: string, backFace: unknown) => ({
    id,
    owner_id: USER,
    title,
    back_face: backFace,
    rendered_image_url: null,
  });

  it("refuses the batch when a card's second face is unnamed, changing nothing", async () => {
    state.useChain = true;
    state.bulkRows = [
      row(CARD, "Fire", { title: "", card_type: "instant" }),
      row(OTHER, "Grizzly Bears", null),
    ];
    const result = await updateCardsVisibilityAction([CARD, OTHER], "public");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/Name the second face of “Fire”/);
    const writes = (state.chainLog ?? []).filter((entry) => called(entry.calls, "update"));
    expect(writes).toHaveLength(0);
  });

  it("still makes such a card private, and publishes named ones", async () => {
    state.useChain = true;
    state.bulkRows = [row(CARD, "Fire", { title: "", card_type: "instant" })];
    expect(await updateCardsVisibilityAction([CARD], "private")).toEqual({ ok: true, count: 1 });

    state.bulkRows = [row(CARD, "Fire // Ice", { title: "Ice", card_type: "instant" })];
    expect(await updateCardsVisibilityAction([CARD], "unlisted")).toEqual({ ok: true, count: 1 });
  });
});

