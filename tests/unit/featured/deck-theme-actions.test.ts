import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient } from "@/tests/stubs/supabase-chain";
import { DECK_THEME_DECKS_MAX } from "@/lib/validation/deck-theme";

// ---------------------------------------------------------------------------
// "Featured themed decks" (0167) — the admin's writes. The two tables grant
// the API roles nothing, so the is_admin check here is the only door; and a
// pick must be public, non-empty and a real creator's deck when it is added
// (the visitor read applies the rule again at every visit).
// ---------------------------------------------------------------------------

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const THEME = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DECK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const state = vi.hoisted(() => ({
  profile: null as null | { id: string; is_admin: boolean },
  stub: null as null | ReturnType<typeof import("@/tests/stubs/supabase-chain").chainClient>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => state.profile,
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => state.stub!.client,
}));

import {
  addDeckToThemeAction,
  createDeckThemeAction,
  moveDeckThemeAction,
  removeDeckFromThemeAction,
} from "@/lib/featured/deck-theme-actions";

type Deck = { id: string; owner_id: string; visibility: string; card_count: number };
let deck: Deck | null;
let creator: boolean;
let picks: { deck_id: string; position: number }[];

beforeEach(() => {
  state.profile = { id: ADMIN, is_admin: true };
  deck = { id: DECK, owner_id: OWNER, visibility: "public", card_count: 60 };
  creator = true;
  picks = [];
  state.stub = chainClient((table, calls) => {
    if (table === "decks") return { data: deck };
    if (table === "deck_slug_history") return { data: null };
    if (table === "deck_theme_decks") {
      if (called(calls, "insert")) return {};
      return { data: picks };
    }
    return {};
  });
  state.stub.rpc.mockImplementation(async () => ({ data: creator, error: null }));
});

const inserted = () =>
  state.stub!.forTable("deck_theme_decks").some((entry) => called(entry.calls, "insert"));

describe("the featured deck theme actions", () => {
  it("refuse anyone but an admin, before any write", async () => {
    state.profile = { id: ADMIN, is_admin: false };
    for (const result of [
      await createDeckThemeAction({ title: "Dragons", blurb: "" }),
      await addDeckToThemeAction(THEME, "/deck/ember-wyrm"),
      await removeDeckFromThemeAction(THEME, DECK),
      await moveDeckThemeAction(THEME, 1),
    ]) {
      expect(result).toEqual({ ok: false, error: "Not authorized." });
    }
    state.profile = null;
    expect(await addDeckToThemeAction(THEME, "/deck/ember-wyrm")).toEqual({ ok: false, error: "Not authorized." });
    expect(state.stub!.log).toEqual([]);
  });

  it("add a public, non-empty, real creator's deck", async () => {
    expect(await addDeckToThemeAction(THEME, "https://pipglyph.com/deck/ember-wyrm")).toEqual({ ok: true });
    expect(inserted()).toBe(true);
    expect(state.stub!.rpc).toHaveBeenCalledWith("owner_is_creator", { p_owner_id: OWNER });
  });

  it.each([
    ["private", { visibility: "private" }, /isn't public/],
    ["unlisted", { visibility: "unlisted" }, /isn't public/],
    ["empty", { card_count: 0 }, /no cards yet/],
  ])("refuse a %s deck", async (_name, patch, message) => {
    deck = { ...deck!, ...patch };
    const result = await addDeckToThemeAction(THEME, "/deck/ember-wyrm");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(message);
    expect(inserted()).toBe(false);
  });

  it("refuse a deck whose maker isn't a real creator", async () => {
    creator = false;
    const result = await addDeckToThemeAction(THEME, "/deck/first-brew");
    expect(!result.ok && result.error).toMatch(/real creators' decks only/);
    expect(inserted()).toBe(false);
  });

  it("refuse a link to no deck, and a link that isn't a deck page", async () => {
    deck = null;
    expect(await addDeckToThemeAction(THEME, "/deck/gone")).toEqual({ ok: false, error: "No deck at that link." });
    expect((await addDeckToThemeAction(THEME, "https://example.com/elsewhere")).ok).toBe(false);
    expect(inserted()).toBe(false);
  });

  it("refuse a deck already in the theme", async () => {
    picks = [{ deck_id: DECK, position: 0 }];
    const result = await addDeckToThemeAction(THEME, "/deck/ember-wyrm");
    expect(!result.ok && result.error).toMatch(/already in this theme/);
    expect(inserted()).toBe(false);
  });

  it(`refuse a deck past the ${DECK_THEME_DECKS_MAX}-deck cap`, async () => {
    picks = Array.from({ length: DECK_THEME_DECKS_MAX }, (_, i) => ({
      deck_id: `eeeeeeee-eeee-4eee-8eee-${String(i).padStart(12, "0")}`,
      position: DECK_THEME_DECKS_MAX - 1 - i,
    }));
    const result = await addDeckToThemeAction(THEME, "/deck/ember-wyrm");
    expect(!result.ok && result.error).toMatch(new RegExp(`at most ${DECK_THEME_DECKS_MAX} decks`));
    expect(inserted()).toBe(false);
  });

  it("one under the cap still adds, after the last pick", async () => {
    picks = Array.from({ length: DECK_THEME_DECKS_MAX - 1 }, (_, i) => ({
      deck_id: `eeeeeeee-eeee-4eee-8eee-${String(i).padStart(12, "0")}`,
      position: DECK_THEME_DECKS_MAX - 2 - i,
    }));
    expect(await addDeckToThemeAction(THEME, "/deck/ember-wyrm")).toEqual({ ok: true });
    const insert = state
      .stub!.forTable("deck_theme_decks")
      .flatMap((entry) => entry.calls)
      .find((call) => call.method === "insert");
    expect(insert?.args[0]).toEqual({ theme_id: THEME, deck_id: DECK, position: DECK_THEME_DECKS_MAX - 1 });
  });
});
