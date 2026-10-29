import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Decks are unlimited on every plan (owner 2026-10-29: "there is not going to
// be a deck cap because that is what other sites do. Where paid conversion
// happens is with card limits."). Migration 0145 shipped a private-deck cap
// and 0147 drops it. This holds the decision:
//   * 0147 drops 0145's trigger and both functions, idempotently, and no
//     later migration brings a deck cap back;
//   * no app code refuses a deck for capacity — no cap constant, entitlement,
//     pre-check, upgrade reason or funnel event is left;
//   * createDeckAction / updateDeckAction make any number of private and
//     unlisted decks without reading the plan or counting decks;
// and keeps what stays: the deck_created row, and deck_card_customized
// only for a card the creator made from the entry (owner decision D2).
// The 500-entry limit per deck (0143's deck_entry_limit) is a safety limit,
// not a plan cap, and is untouched.
// ---------------------------------------------------------------------------

const root = process.cwd();
const migrations = join(root, "supabase/migrations");
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

describe("0147 drops the deck cap", () => {
  const sql = strip(readFileSync(join(migrations, "0147_remove_deck_capacity.sql"), "utf8"));

  it("drops 0145's trigger and both functions, idempotently", () => {
    expect(sql).toContain("drop trigger if exists decks_enforce_capacity on public.decks;");
    expect(sql).toContain("drop function if exists public.enforce_deck_capacity();");
    expect(sql).toContain("drop function if exists public.deck_capacity_for(uuid);");
    expect(sql).not.toMatch(/create (or replace )?(function|trigger)/i);
  });

  it("no migration after 0145 creates a deck cap again", () => {
    const later = readdirSync(migrations).filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) > 145);
    expect(later).toContain("0147_remove_deck_capacity.sql");
    for (const file of later) {
      const body = strip(readFileSync(join(migrations, file), "utf8"));
      expect(body, file).not.toMatch(/create (or replace )?function public\.(deck_capacity_for|enforce_deck_capacity)\b/i);
      expect(body, file).not.toMatch(/create trigger decks_enforce_capacity\b/i);
      expect(body, file).not.toMatch(/deck_capacity_exceeded/);
    }
  });
});

/** Every .ts / .tsx file under a directory. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("no app code refuses a deck for capacity", () => {
  it("names no deck cap, entitlement, pre-check, upgrade reason or cap event", () => {
    const offenders: string[] = [];
    for (const file of ["app", "components", "lib", "types"].flatMap((dir) => sources(join(root, dir)))) {
      const text = readFileSync(file, "utf8");
      if (/DECK_CAPACITY|CAPPED_DECK_VISIBILITIES|deckCapacity|deck_capacity|deck_cap_hit|DeckCapacity|countCappedDecks/.test(text)) {
        offenders.push(file.slice(root.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});

// --- The actions ------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const DECK = "22222222-2222-4222-8222-222222222222";
const ENTRY = "33333333-3333-4333-8333-333333333333";
const CARD = "44444444-4444-4444-8444-444444444444";

const s = vi.hoisted(() => ({
  countQueries: 0,
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  existing: { id: "deck-1", owner_id: "", slug: "my-deck", visibility: "public" } as Record<string, unknown>,
  entry: { id: "", deck_id: "", card_id: null as string | null, scryfall_id: "sf-1" as string | null },
  events: [] as Array<{ event: string; props: Record<string, unknown> }>,
  entitlementReads: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/decks/revalidate", () => ({ revalidateDeckPaths: () => {} }));
vi.mock("@/lib/profile/username", () => ({ revalidateProfilePage: async () => {} }));
vi.mock("@/lib/decks/queries", () => ({ getDeckById: async () => s.existing }));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => {
    s.entitlementReads += 1;
    return { cardCapacity: 50, effectiveTier: "free" };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => true, createAdminClient: () => ({}) }));
vi.mock("@/lib/analytics/funnel-server", () => ({
  recordFunnelEvent: async (_admin: unknown, input: { event: string; props?: Record<string, unknown> }) => {
    s.events.push({ event: input.event, props: input.props ?? {} });
    return "row";
  },
}));

function table(name: string) {
  let op: "select" | "insert" | "update" = "select";
  let n = 0;
  const q = {
    select: (_columns?: string, options?: { count?: string }) => {
      if (options?.count) s.countQueries += 1;
      return q;
    },
    eq: () => q,
    in: () => q,
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
    single: async () => {
      n += 1;
      return { data: { id: op === "insert" ? `deck-new-${s.inserts.length}` : "deck-1", slug: `deck-${n}` }, error: null };
    },
    maybeSingle: async () => {
      if (name === "deck_cards") return { data: s.entry, error: null };
      if (name === "cards") return { data: { id: CARD, owner_id: USER, visibility: "private" }, error: null };
      return { data: { id: DECK, slug: "my-deck", owner_id: USER }, error: null };
    },
    then: (resolve: (value: unknown) => void) => resolve({ count: 99, error: null }),
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

beforeEach(() => {
  s.countQueries = 0;
  s.inserts = [];
  s.updates = [];
  s.existing = { id: "deck-1", owner_id: USER, slug: "my-deck", visibility: "public" };
  s.entry = { id: ENTRY, deck_id: DECK, card_id: null, scryfall_id: "sf-1" };
  s.events = [];
  s.entitlementReads = 0;
});

describe("the deck actions never count decks or read the plan", () => {
  it("a free account makes ten private and unlisted decks in a row", async () => {
    for (let i = 0; i < 10; i += 1) {
      const result = await createDeckAction(
        { title: `Deck ${i}`, visibility: i % 2 ? "unlisted" : "private" },
        { surface: "wizard" },
      );
      expect(result, `deck ${i}`).toMatchObject({ ok: true });
    }
    expect(s.inserts).toHaveLength(10);
    expect(s.countQueries).toBe(0);
    expect(s.entitlementReads).toBe(0);
    // The funnel keeps deck_created (and has no cap event to write).
    expect(s.events.map((e) => e.event)).toEqual(Array(10).fill("deck_created"));
    expect(s.events[0].props).toMatchObject({ visibility: "private", format: "commander", surface: "wizard" });
  });

  it("a public deck turns private or unlisted without a count", async () => {
    expect(await updateDeckAction(DECK, { visibility: "private" })).toMatchObject({ ok: true });
    expect(await updateDeckAction(DECK, { visibility: "unlisted" })).toMatchObject({ ok: true });
    expect(s.countQueries).toBe(0);
    expect(s.entitlementReads).toBe(0);
    expect(s.updates).toHaveLength(2);
  });
});

describe("deck_card_customized stays creator-only (owner decision D2)", () => {
  it("records an entry's FIRST card made from it in the creator", async () => {
    expect(await linkDeckCardAction(ENTRY, CARD, { surface: "creator" })).toEqual({ ok: true, deckCardId: ENTRY });
    expect(s.events).toEqual([{ event: "deck_card_customized", props: { surface: "creator", kind: "import" } }]);
  });

  it("a placeholder the creator filled", async () => {
    s.entry = { id: ENTRY, deck_id: DECK, card_id: null, scryfall_id: null };
    await linkDeckCardAction(ENTRY, CARD, { surface: "creator" });
    expect(s.events[0].props).toEqual({ surface: "creator", kind: "placeholder" });
  });

  it("an existing card linked from the deck page, or a re-link, is not counted", async () => {
    await linkDeckCardAction(ENTRY, CARD);
    await linkDeckCardAction(ENTRY, CARD, { surface: "deck" });
    s.entry = { id: ENTRY, deck_id: DECK, card_id: "55555555-5555-4555-8555-555555555555", scryfall_id: "sf-1" };
    await linkDeckCardAction(ENTRY, CARD, { surface: "creator" });
    expect(s.events).toEqual([]);
  });
});
