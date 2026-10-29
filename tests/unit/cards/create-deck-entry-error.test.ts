import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// A new card's deck (`deck_id`, the creator's "Add to a deck" box — TODO
// DK9.3's follow-up): a deck at its 500 entries refused the card and the
// save said nothing. The card IS saved (a deck hiccup never rolls back the
// create); the result now says why the deck didn't take it, and the creator
// shows it. A save that names no deck, or whose deck took the card, carries
// no such key — its result is what it always was.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";
const DECK = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({
  client: null as unknown,
  deckAnswer: { ok: true, deckSlug: "goblins" } as Record<string, unknown>,
  deckCalls: 0,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}), isAdminConfigured: () => false }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => ["m15/r"] }));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => null,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ premiumFrames: true, removeWatermark: true, cardCapacity: -1 }),
}));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn() }));
vi.mock("@/lib/decks/membership", () => ({
  addCustomCardEntryToDeck: async () => {
    state.deckCalls += 1;
    return state.deckAnswer;
  },
}));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: async () => {} }));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCard: vi.fn(),
  purgeHiddenCards: vi.fn(),
  revalidateCardListSurfaces: vi.fn(),
  revalidateCardPaths: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createCardAction } from "@/lib/cards/actions";

function db() {
  const stub = chainClient((table): ChainAnswer =>
    table === "cards" ? { data: { id: CARD, slug: "bolt" }, error: null } : { error: null },
  );
  state.client = stub.client;
}

const payload = (overrides: Record<string, unknown> = {}) => ({
  title: "Bolt",
  game_system_id: GAME,
  card_type: "instant",
  color_identity: ["red"],
  frame_style: { template: "m15" },
  visibility: "public",
  rules_text: "Deal 3 damage to any target.",
  ...overrides,
});

beforeEach(() => {
  state.deckAnswer = { ok: true, deckSlug: "goblins" };
  state.deckCalls = 0;
  db();
});

describe("createCardAction — the deck that didn't take the card", () => {
  it("a full deck: the card is saved, and the result says the deck is full", async () => {
    state.deckAnswer = {
      ok: false,
      error: "This deck already holds 500 different entries — …",
      deckFull: true,
      deckTitle: "Goblins",
    };
    const result = await createCardAction(payload({ deck_id: DECK }));
    expect(result).toEqual({
      ok: true,
      cardId: CARD,
      slug: "bolt",
      deckEntryError:
        "“Goblins” is full — a deck holds at most 500 different entries. Remove some from it, or add the card to another deck.",
    });
  });

  it("another refusal says its own words", async () => {
    state.deckAnswer = { ok: false, error: "Deck not found or not yours." };
    const result = await createCardAction(payload({ deck_id: DECK }));
    expect(result).toMatchObject({ ok: true, deckEntryError: "Deck not found or not yours." });
  });

  it("a deck that took the card, and a save with no deck, carry no such key", async () => {
    expect(await createCardAction(payload({ deck_id: DECK }))).toEqual({ ok: true, cardId: CARD, slug: "bolt" });
    expect(await createCardAction(payload())).toEqual({ ok: true, cardId: CARD, slug: "bolt" });
    expect(state.deckCalls).toBe(1);
  });
});
