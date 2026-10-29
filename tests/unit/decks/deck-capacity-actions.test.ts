import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The private-deck cap in the deck actions (TODO DK3.2 / DK3.4 / DK3.8):
//   * createDeckAction pre-checks a private / unlisted deck against the plan
//     and refuses with the upgrade reason "deck_capacity" before any insert;
//     a public deck is never counted; the trigger's error (migration 0145 —
//     a lost race, or billing off, when every entitlement reads unlimited)
//     maps to the same refusal;
//   * updateDeckAction checks ONLY a deck that joins the count (public →
//     private / unlisted): private ↔ unlisted, a re-sent visibility and
//     every content edit of a deck over the cap pass untouched
//     (grandfathered);
//   * the funnel rows: deck_created, deck_cap_hit, and deck_card_customized
//     on an entry's FIRST card when the creator made it from the entry
//     (never a re-link, never a card linked from the deck page).
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const DECK = "22222222-2222-4222-8222-222222222222";
const ENTRY = "33333333-3333-4333-8333-333333333333";
const CARD = "44444444-4444-4444-8444-444444444444";

type Result = { data: unknown; error: null | { message: string; code?: string } };

const s = vi.hoisted(() => ({
  entitlements: { deckCapacity: 1, effectiveTier: "free" as "free" | "plus" | "pro" },
  cappedCount: 0,
  countQueries: 0,
  countedVisibilities: [] as string[][],
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  insertResult: { data: { id: "deck-new", slug: "new-deck" }, error: null } as Result,
  updateResult: { data: { id: "deck-1", slug: "my-deck" }, error: null } as Result,
  existing: { id: "deck-1", owner_id: "", slug: "my-deck", visibility: "public" } as Record<string, unknown> | null,
  entry: { id: "", deck_id: "", card_id: null as string | null, scryfall_id: "sf-1" as string | null },
  events: [] as Array<{ event: string; userId: string | null; props: Record<string, unknown> }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/decks/revalidate", () => ({ revalidateDeckPaths: () => {} }));
vi.mock("@/lib/profile/username", () => ({ revalidateProfilePage: async () => {} }));
vi.mock("@/lib/decks/queries", () => ({ getDeckById: async () => s.existing }));
vi.mock("@/lib/billing/entitlements", () => ({ getEntitlements: async () => s.entitlements }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => true, createAdminClient: () => ({}) }));
vi.mock("@/lib/analytics/funnel-server", () => ({
  recordFunnelEvent: async (_admin: unknown, input: { event: string; userId?: string | null; props?: Record<string, unknown> }) => {
    s.events.push({ event: input.event, userId: input.userId ?? null, props: input.props ?? {} });
    return "row";
  },
}));

function table(name: string) {
  let op: "select" | "insert" | "update" = "select";
  const q = {
    select: () => q,
    eq: () => q,
    in: (_column: string, values: string[]) => {
      s.countQueries += 1;
      s.countedVisibilities.push(values);
      return q;
    },
    insert: (row: Record<string, unknown>) => {
      op = "insert";
      s.inserts.push(row);
      return q;
    },
    update: (row: Record<string, unknown>) => {
      op = "update";
      s.updates.push({ table: name, ...row });
      return q;
    },
    single: async () => (op === "insert" ? s.insertResult : s.updateResult),
    maybeSingle: async () => {
      if (name === "deck_cards") return { data: s.entry, error: null };
      if (name === "cards") return { data: { id: CARD, owner_id: USER }, error: null };
      return { data: { id: DECK, slug: "my-deck", owner_id: USER }, error: null };
    },
    // `await` on the head count (decks) or a bare update (deck_cards).
    then: (resolve: (value: unknown) => void) => resolve({ count: s.cappedCount, error: null }),
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "me",
  createClient: async () => ({ from: (name: string) => table(name) }),
}));

import { createDeckAction, updateDeckAction } from "@/lib/decks/actions";
import { linkDeckCardAction } from "@/lib/decks/card-actions";

const CAP_ERROR = { message: "deck_capacity_exceeded: 1 of 1 private or unlisted decks", code: "23514" };

beforeEach(() => {
  s.entitlements = { deckCapacity: 1, effectiveTier: "free" };
  s.cappedCount = 0;
  s.countQueries = 0;
  s.countedVisibilities = [];
  s.inserts = [];
  s.updates = [];
  s.insertResult = { data: { id: "deck-new", slug: "new-deck" }, error: null };
  s.updateResult = { data: { id: "deck-1", slug: "my-deck" }, error: null };
  s.existing = { id: "deck-1", owner_id: USER, slug: "my-deck", visibility: "public" };
  s.entry = { id: ENTRY, deck_id: DECK, card_id: null, scryfall_id: "sf-1" };
  s.events = [];
});

describe("createDeckAction", () => {
  it("refuses a private deck at the cap before any insert, with the upgrade reason", async () => {
    s.cappedCount = 1;
    const result = await createDeckAction({ title: "Second", visibility: "private" }, { surface: "dialog" });
    expect(result).toEqual({
      ok: false,
      code: "UPGRADE_REQUIRED",
      reason: "deck_capacity",
      formError:
        "Free includes 1 private or unlisted deck, and yours is in use. Make this deck public, make another one public or delete it, or upgrade.",
    });
    expect(s.inserts).toEqual([]);
    expect(s.countedVisibilities).toEqual([["private", "unlisted"]]);
    expect(s.events).toEqual([
      { event: "deck_cap_hit", userId: USER, props: { kind: "create", visibility: "private", tier: "free", surface: "dialog" } },
    ]);
  });

  it("an unlisted deck counts as well", async () => {
    s.cappedCount = 1;
    const result = await createDeckAction({ title: "Link only", visibility: "unlisted" });
    expect(result).toMatchObject({ ok: false, reason: "deck_capacity" });
    expect(s.inserts).toEqual([]);
  });

  it("a public deck is never counted — unlimited on every plan", async () => {
    s.cappedCount = 9;
    const result = await createDeckAction({ title: "Out loud" }, { surface: "creator" });
    expect(result).toEqual({ ok: true, deckId: "deck-new", slug: "new-deck" });
    expect(s.countQueries).toBe(0);
    expect(s.inserts[0]).toMatchObject({ visibility: "public" });
    expect(s.events).toEqual([
      { event: "deck_created", userId: USER, props: { visibility: "public", format: "commander", surface: "creator" } },
    ]);
  });

  it("a private deck with room is made", async () => {
    s.entitlements = { deckCapacity: 3, effectiveTier: "plus" };
    s.cappedCount = 2;
    const result = await createDeckAction({ title: "Third", visibility: "private", format: "modern" });
    expect(result).toMatchObject({ ok: true });
    expect(s.inserts).toHaveLength(1);
    expect(s.events.map((e) => e.event)).toEqual(["deck_created"]);
    expect(s.events[0].props).toMatchObject({ visibility: "private", format: "modern" });
  });

  it("the trigger's refusal (a create that lost the race) maps to the same answer", async () => {
    s.cappedCount = 0;
    s.insertResult = { data: null, error: CAP_ERROR };
    const result = await createDeckAction({ title: "Racer", visibility: "private" });
    expect(result).toMatchObject({ ok: false, code: "UPGRADE_REQUIRED", reason: "deck_capacity" });
    expect(s.inserts).toHaveLength(1); // one attempt: a capacity error is no slug clash
    expect(s.events.map((e) => e.event)).toEqual(["deck_cap_hit"]);
  });

  it("unlimited (Pro, admin, billing off) skips the count; the database still decides", async () => {
    s.entitlements = { deckCapacity: -1, effectiveTier: "pro" };
    expect(await createDeckAction({ title: "Pro deck", visibility: "private" })).toMatchObject({ ok: true });
    expect(s.countQueries).toBe(0);

    // Billing off reads unlimited while 0145 holds a free account to 1.
    s.insertResult = { data: null, error: CAP_ERROR };
    const refused = await createDeckAction({ title: "Billing off", visibility: "private" });
    expect(refused).toMatchObject({ ok: false, reason: "deck_capacity" });
    expect((refused as { formError: string }).formError).toMatch(/^Your plan's private decks are all in use/);
  });
});

describe("updateDeckAction", () => {
  it("public → private at the cap is refused before the update", async () => {
    s.cappedCount = 1;
    const result = await updateDeckAction("22222222-2222-4222-8222-222222222222", { visibility: "private" });
    expect(result).toMatchObject({ ok: false, code: "UPGRADE_REQUIRED", reason: "deck_capacity" });
    expect(s.updates).toEqual([]);
    expect(s.events).toEqual([
      { event: "deck_cap_hit", userId: USER, props: { kind: "visibility", visibility: "private", tier: "free" } },
    ]);
  });

  it("public → unlisted with room goes through", async () => {
    s.entitlements = { deckCapacity: 3, effectiveTier: "plus" };
    s.cappedCount = 1;
    expect(await updateDeckAction(DECK, { visibility: "unlisted" })).toMatchObject({ ok: true });
    expect(s.updates).toHaveLength(1);
  });

  it("grandfathered: a deck already private is never counted — private ↔ unlisted, a re-sent value, a rename", async () => {
    s.cappedCount = 3; // a lapsed Plus: 3 private decks on Free's 1
    s.existing = { id: "deck-1", owner_id: USER, slug: "my-deck", visibility: "private" };
    expect(await updateDeckAction(DECK, { visibility: "unlisted" })).toMatchObject({ ok: true });
    expect(await updateDeckAction(DECK, { title: "Renamed", visibility: "private" })).toMatchObject({ ok: true });
    expect(await updateDeckAction(DECK, { title: "Renamed again" })).toMatchObject({ ok: true });
    expect(s.countQueries).toBe(0);
    expect(s.updates).toHaveLength(3);
    expect(s.events).toEqual([]);
  });

  it("making a deck public is always allowed — the first way out", async () => {
    s.cappedCount = 5;
    s.existing = { id: "deck-1", owner_id: USER, slug: "my-deck", visibility: "private" };
    expect(await updateDeckAction(DECK, { visibility: "public" })).toMatchObject({ ok: true });
    expect(s.countQueries).toBe(0);
  });

  it("the trigger's refusal maps to the upgrade reason", async () => {
    s.cappedCount = 0;
    s.updateResult = { data: null, error: CAP_ERROR };
    expect(await updateDeckAction(DECK, { visibility: "private" })).toMatchObject({ ok: false, reason: "deck_capacity" });
    expect(s.events.map((e) => e.event)).toEqual(["deck_cap_hit"]);
  });
});

describe("linkDeckCardAction — deck_card_customized", () => {
  it("records an entry's FIRST card of the user's, with who linked it", async () => {
    expect(await linkDeckCardAction(ENTRY, CARD, { surface: "creator" })).toEqual({ ok: true, deckCardId: ENTRY });
    expect(s.events).toEqual([
      { event: "deck_card_customized", userId: USER, props: { surface: "creator", kind: "import" } },
    ]);
  });

  it("a placeholder the creator filled", async () => {
    s.entry = { id: ENTRY, deck_id: DECK, card_id: null, scryfall_id: null };
    await linkDeckCardAction(ENTRY, CARD, { surface: "creator" });
    expect(s.events[0].props).toEqual({ surface: "creator", kind: "placeholder" });
  });

  it("an EXISTING card linked from the deck page uses no new slot: not counted", async () => {
    expect(await linkDeckCardAction(ENTRY, CARD)).toMatchObject({ ok: true });
    expect(await linkDeckCardAction(ENTRY, CARD, { surface: "deck" })).toMatchObject({ ok: true });
    expect(s.events).toEqual([]);
  });

  it("a re-link is not counted again", async () => {
    s.entry = { id: ENTRY, deck_id: DECK, card_id: "55555555-5555-4555-8555-555555555555", scryfall_id: "sf-1" };
    expect(await linkDeckCardAction(ENTRY, CARD, { surface: "creator" })).toMatchObject({ ok: true });
    expect(s.events).toEqual([]);
  });
});
