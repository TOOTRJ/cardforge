import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, type ChainCall } from "@/tests/stubs/supabase-chain";
import { cloneErrorMessage, cloneNotice, cloneSlugOf, cloneTitleOf, parseCloneResult } from "@/lib/decks/clone";

// ---------------------------------------------------------------------------
// "Copy deck" (TODO DK5.16). The app's half: the copy's name and link, ONE
// database call (migration 0164's clone_deck — the deck rules, the 500 cap,
// the lineage and the notice are the database's, held by
// tests/unit/db/deck-clone-similar-migration.test.ts), the source read by
// its id (its link — an unlisted deck opens by it), plain words for every
// refusal, and the maker told what was left out. No card is ever written:
// saved-card capacity is untouched.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const SOURCE = "33333333-3333-4333-8333-333333333333";
const NEW_DECK = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({
  client: null as unknown,
  signedIn: true,
  source: null as null | { id: string; title: string },
  rpcAnswer: { data: null as unknown, error: null as null | { message: string; code?: string } },
  revalidated: [] as string[],
  sourceCalls: [] as ChainCall[],
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => (state.signedIn ? { id: USER } : null),
  getCurrentUsername: async () => "dev_artist",
}));
vi.mock("@/lib/decks/revalidate", () => ({
  revalidateDeckPaths: (slug: string) => state.revalidated.push(slug),
}));

const { cloneDeckAction } = await import("@/lib/decks/clone-actions");

let chain: ReturnType<typeof chainClient>;

beforeEach(() => {
  state.signedIn = true;
  state.source = { id: SOURCE, title: "Cinderwing Dragonstorm" };
  state.rpcAnswer = { data: { deckId: NEW_DECK, slug: "cinderwing-dragonstorm-remix", copied: 38, skipped: 2 }, error: null };
  state.revalidated = [];
  chain = chainClient((table, calls) => {
    if (table === "decks") {
      state.sourceCalls = calls;
      return { data: state.source };
    }
    throw new Error(`unexpected table ${table}`);
  });
  chain.rpc.mockImplementation(async () => state.rpcAnswer);
  state.client = chain.client;
});

describe("cloneTitleOf / cloneSlugOf", () => {
  it("adds (remix) once, inside the 120-character title", () => {
    expect(cloneTitleOf("Cinderwing Dragonstorm")).toBe("Cinderwing Dragonstorm (remix)");
    expect(cloneTitleOf("Cinderwing Dragonstorm (remix)")).toBe("Cinderwing Dragonstorm (remix)");
    const long = cloneTitleOf("x".repeat(120));
    expect(long).toHaveLength(120);
    expect(long.endsWith(" (remix)")).toBe(true);
    expect(cloneTitleOf("   ")).toBe("Deck (remix)");
  });
  it("slugs the copy's title as a deck's", () => {
    expect(cloneSlugOf("Cinderwing Dragonstorm (remix)")).toBe("cinderwing-dragonstorm-remix");
    expect(cloneSlugOf("!!!")).toBe("deck");
  });
});

describe("parseCloneResult / cloneNotice / cloneErrorMessage", () => {
  it("reads the database's answer, nothing else", () => {
    expect(parseCloneResult({ deckId: NEW_DECK, slug: "s", copied: 3, skipped: 1 })).toEqual({ deckId: NEW_DECK, slug: "s", copied: 3, skipped: 1 });
    expect(parseCloneResult({ deckId: NEW_DECK, slug: "s", copied: "x" })).toEqual({ deckId: NEW_DECK, slug: "s", copied: 0, skipped: 0 });
    expect(parseCloneResult(null)).toBeNull();
    expect(parseCloneResult({ slug: "s" })).toBeNull();
  });
  it("tells the maker what was left out, and that the copy is private", () => {
    expect(cloneNotice({ copied: 1, skipped: 0 })).toBe("1 entry copied. Your copy is private until you publish it.");
    expect(cloneNotice({ copied: 38, skipped: 2 })).toBe(
      "38 entries copied; 2 cards were left out (private or no longer available). Your copy is private until you publish it.",
    );
  });
  it("names the cap and the missing deck in plain words", () => {
    expect(cloneErrorMessage({ message: "deck_entry_limit: a deck holds at most 500 entries" })).toMatch(/more than 500 entries/);
    expect(cloneErrorMessage({ message: "deck_not_found: no deck to copy", code: "P0002" })).toMatch(/can't be copied/);
    expect(cloneErrorMessage({ message: "deck_slug_taken", code: "23505" })).toMatch(/name's link/);
    expect(cloneErrorMessage({ message: "boom" })).toBe("The deck couldn't be copied. Please try again.");
  });
});

describe("cloneDeckAction", () => {
  it("copies through ONE clone_deck call with the copy's title and slug, revalidates the copy", async () => {
    const result = await cloneDeckAction(SOURCE);
    expect(result).toEqual({
      ok: true,
      deckId: NEW_DECK,
      slug: "cinderwing-dragonstorm-remix",
      copied: 38,
      skipped: 2,
      notice: cloneNotice({ copied: 38, skipped: 2 }),
    });
    expect(chain.rpc).toHaveBeenCalledTimes(1);
    expect(chain.rpc).toHaveBeenCalledWith("clone_deck", {
      p_source_deck_id: SOURCE,
      p_title: "Cinderwing Dragonstorm (remix)",
      p_slug: "cinderwing-dragonstorm-remix",
    });
    expect(state.revalidated).toEqual(["cinderwing-dragonstorm-remix"]);
  });

  it("reads the source by its id — its link (an unlisted deck opens by it)", async () => {
    await cloneDeckAction(SOURCE);
    expect(called(state.sourceCalls, "setHeader", "x-pipglyph-deck")).toBe(true);
    expect(state.sourceCalls.find((c) => c.method === "setHeader")?.args[1]).toBe(SOURCE);
  });

  it("never writes a card or a deck row itself (no capacity spent; the database makes the copy)", async () => {
    await cloneDeckAction(SOURCE);
    for (const entry of chain.log) {
      expect(entry.table).toBe("decks");
      expect(entry.calls.some((c) => ["insert", "update", "upsert", "delete"].includes(c.method))).toBe(false);
    }
  });

  it("asks a signed-out visitor to sign in, before any read", async () => {
    state.signedIn = false;
    expect(await cloneDeckAction(SOURCE)).toEqual({ ok: false, code: "AUTH_REQUIRED", formError: "Sign in to copy this deck." });
    expect(chain.log).toEqual([]);
    expect(chain.rpc).not.toHaveBeenCalled();
  });

  it("refuses a deck the viewer can't open (private, deleted) without calling the database's copy", async () => {
    state.source = null;
    const result = await cloneDeckAction(SOURCE);
    expect(result.ok).toBe(false);
    expect(chain.rpc).not.toHaveBeenCalled();
  });

  it("refuses an id that isn't one", async () => {
    expect((await cloneDeckAction("not-a-uuid")).ok).toBe(false);
    expect((await cloneDeckAction(42)).ok).toBe(false);
    expect(chain.rpc).not.toHaveBeenCalled();
  });

  it("says the 500-entry cap in words when the database refuses a deck past it", async () => {
    state.rpcAnswer = { data: null, error: { message: "deck_entry_limit: a deck holds at most 500 entries", code: "23514" } };
    const result = await cloneDeckAction(SOURCE);
    expect(result).toEqual({ ok: false, formError: cloneErrorMessage({ message: "deck_entry_limit" }) });
    expect(state.revalidated).toEqual([]);
  });
});
