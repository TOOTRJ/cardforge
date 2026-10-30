import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// A renamed deck's old links (TODO DK5.14, migration 0155):
//   * renamedDeckSlug — the old slug read from deck_slug_history NAMING it in
//     0151's header (an unlisted deck's old link is a link), then the deck by
//     its id (0151's other link); the current slug, or null (a missing row, a
//     deck the viewer can't open, a database without 0155, the live slug);
//   * updateDeckAction — the slug follows a rename, a bracket only on a
//     Commander deck, and both URLs revalidated + announced (IndexNow).
// ---------------------------------------------------------------------------

const DECK_ID = "b0000000-0000-4000-a000-00000000000a";
const OWNER = "d0000000-0000-4000-a000-000000000002";

const state = vi.hoisted(() => ({
  stub: null as null | ReturnType<typeof import("@/tests/stubs/supabase-chain").chainClient>,
  history: null as { deck_id: string } | null,
  historyError: null as { message: string } | null,
  deck: null as { slug: string } | null,
  existing: null as Record<string, unknown> | null,
  takenSlugs: new Set<string>(),
}));

const revalidateDeckPaths = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: OWNER }),
  getCurrentUsername: async () => "dev_pro",
  createClient: async () => state.stub!.client,
}));
vi.mock("@/lib/decks/revalidate", () => ({ revalidateDeckPaths }));
vi.mock("@/lib/decks/queries", () => ({ getDeckById: async () => state.existing }));

import { renamedDeckSlug } from "@/lib/decks/slug-history";
import { updateDeckAction } from "@/lib/decks/actions";

const headerOf = (calls: ChainCall[]) => calls.find((c) => c.method === "setHeader")?.args ?? null;

const resolve = (table: string, calls: ChainCall[]): ChainAnswer => {
  if (table === "deck_slug_history") return { data: state.history, error: state.historyError };
  if (table === "decks" && called(calls, "update")) {
    const update = payloadOf(calls, "update") as { slug?: string };
    if (update.slug && state.takenSlugs.has(update.slug)) {
      return { data: null, error: { message: "duplicate", code: "23505" } };
    }
    return { data: { id: DECK_ID, slug: update.slug ?? (state.existing?.slug as string) } };
  }
  if (table === "decks") return { data: state.deck };
  return {};
};

beforeEach(() => {
  state.stub = chainClient(resolve);
  state.history = null;
  state.historyError = null;
  state.deck = null;
  state.takenSlugs = new Set();
  state.existing = {
    id: DECK_ID,
    owner_id: OWNER,
    title: "Emberforge Draft",
    slug: "emberforge-draft",
    format: "commander",
  };
  revalidateDeckPaths.mockClear();
});

describe("renamedDeckSlug", () => {
  it("an old slug: the deck's current slug, each read naming its link", async () => {
    state.history = { deck_id: DECK_ID };
    state.deck = { slug: "ashen-emberforge" };
    await expect(renamedDeckSlug(state.stub!.client as never, "emberforge-draft")).resolves.toBe("ashen-emberforge");
    const [history] = state.stub!.forTable("deck_slug_history");
    expect(called(history.calls, "eq", "old_slug")).toBe(true);
    expect(headerOf(history.calls)).toEqual(["x-pipglyph-deck", "emberforge-draft"]);
    const [deck] = state.stub!.forTable("decks");
    expect(headerOf(deck.calls)).toEqual(["x-pipglyph-deck", DECK_ID]);
  });

  it("no row (never a deck's, or a deck the viewer can't open): null", async () => {
    await expect(renamedDeckSlug(state.stub!.client as never, "nothing-here")).resolves.toBeNull();
    expect(state.stub!.forTable("decks")).toHaveLength(0);
  });

  it("a row whose deck the viewer can't read (a private deck): null", async () => {
    state.history = { deck_id: DECK_ID };
    state.deck = null;
    await expect(renamedDeckSlug(state.stub!.client as never, "emberforge-draft")).resolves.toBeNull();
  });

  it("a database without 0155 (the read errors): null — the 404 as before", async () => {
    state.historyError = { message: 'relation "public.deck_slug_history" does not exist' };
    await expect(renamedDeckSlug(state.stub!.client as never, "emberforge-draft")).resolves.toBeNull();
  });

  it("never redirects a slug to itself", async () => {
    state.history = { deck_id: DECK_ID };
    state.deck = { slug: "emberforge-draft" };
    await expect(renamedDeckSlug(state.stub!.client as never, "emberforge-draft")).resolves.toBeNull();
  });

  it("a value that is no slug reads nothing", async () => {
    for (const slug of ["", "Bad Slug", "a".repeat(81), "../x"]) {
      await expect(renamedDeckSlug(state.stub!.client as never, slug)).resolves.toBeNull();
    }
    expect(state.stub!.log).toHaveLength(0);
  });
});

describe("updateDeckAction — a rename moves the slug", () => {
  const updateOf = () => {
    const chain = state.stub!.forTable("decks").filter((e) => called(e.calls, "update"));
    return chain.map((e) => payloadOf(e.calls, "update") as Record<string, unknown>);
  };

  it("a new title takes its slug; both URLs are revalidated and announced", async () => {
    const result = await updateDeckAction(DECK_ID, { title: "Ashen Emberforge" });
    expect(result).toEqual({ ok: true, deckId: DECK_ID, slug: "ashen-emberforge" });
    expect(updateOf()).toEqual([{ title: "Ashen Emberforge", slug: "ashen-emberforge" }]);
    expect(revalidateDeckPaths).toHaveBeenCalledWith("ashen-emberforge", "dev_pro");
    expect(revalidateDeckPaths).toHaveBeenCalledWith("emberforge-draft", "dev_pro");
  });

  it("a taken slug (a live deck's or a reserved old one, 23505) gets a suffix", async () => {
    state.takenSlugs = new Set(["ashen-emberforge"]);
    const result = await updateDeckAction(DECK_ID, { title: "Ashen Emberforge" });
    expect(result).toMatchObject({ ok: true, slug: "ashen-emberforge-2" });
  });

  it("an edit without a new title never touches the slug", async () => {
    const result = await updateDeckAction(DECK_ID, { deck_type: "goblins", bracket: 2 });
    expect(result).toMatchObject({ ok: true, slug: "emberforge-draft" });
    expect(updateOf()).toEqual([{ deck_type: "goblins", bracket: 2 }]);
    expect(revalidateDeckPaths).toHaveBeenCalledTimes(1);
  });

  it("the same title (unchanged) keeps the slug", async () => {
    await updateDeckAction(DECK_ID, { title: "Emberforge Draft" });
    expect(updateOf()).toEqual([{ title: "Emberforge Draft" }]);
  });

  it("a bracket on a deck whose STORED format has none is refused before any write", async () => {
    state.existing = { ...state.existing, format: "modern" };
    const result = await updateDeckAction(DECK_ID, { bracket: 2 });
    expect(result).toEqual({ ok: false, fieldErrors: { bracket: "Only a Commander deck has a bracket." } });
    expect(updateOf()).toEqual([]);
  });

  it("a bracket with a change TO Commander is allowed", async () => {
    state.existing = { ...state.existing, format: "modern" };
    const result = await updateDeckAction(DECK_ID, { format: "commander", bracket: 2 });
    expect(result).toMatchObject({ ok: true });
  });

  it("an unknown deck type is a field error", async () => {
    const result = await updateDeckAction(DECK_ID, { deck_type: "Dragons" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { deck_type: "Pick a deck type from the list." } });
  });
});
