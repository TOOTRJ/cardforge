import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLLECTION_CARD_CAP, COLLECTION_TOOL_SLUG, MAX_COLLECTION_QUANTITY } from "@/lib/tools/collection/limits";
import { SCRYFALL_LIMITS } from "@/lib/scryfall/rate-limit";
import { CARD_CAPACITY } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// The Collection Deck Builder's collection (0185): RLS on, grants stated
// revoke-first, every policy the OWNER's rows only and only while the tool
// is open to them; the cap ONE number in SQL held to the app's constant,
// enforced by a statement trigger under a per-owner lock; nothing of it
// near the saved-card limit; the limiters' labels the app's; the seed
// guarded. Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_collection_builder\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const seed = readFileSync(join(process.cwd(), "supabase/seeds/47_collection_builder.sql"), "utf8");

describe("0185 collection builder", () => {
  it("exists after the beta tools migration it reads", () => {
    expect(file).not.toBe("");
    const beta = readdirSync(dir).find((f) => /^\d{4}_beta_tools\.sql$/.test(f)) ?? "";
    expect(file > beta).toBe(true);
  });

  it("turns RLS on and states its grants revoke-first, never to anon", () => {
    expect(sql).toContain("alter table public.collection_cards enable row level security;");
    const revoke = sql.indexOf("revoke all on public.collection_cards from public, anon, authenticated;");
    expect(revoke).toBeGreaterThan(0);
    expect(sql.indexOf("grant select, insert, update, delete on public.collection_cards to authenticated;")).toBeGreaterThan(revoke);
    expect(sql.indexOf("grant select, insert, update, delete on public.collection_cards to service_role;")).toBeGreaterThan(revoke);
    expect(sql).not.toMatch(/to [a-z_, ]*\banon\b/);
    expect(sql).not.toMatch(/grant all on all/i);
  });

  it("every policy is the owner's, gated by the tool", () => {
    const policies = [...sql.matchAll(/create policy "([^"]+)"\s+on public\.collection_cards for (\w+)([\s\S]*?);/g)];
    expect(policies.map((p) => p[2]).sort()).toEqual(["delete", "insert", "select", "update"]);
    for (const [, name, , body] of policies) {
      expect(body, name).toContain("to authenticated");
      expect(body, name).toContain("owner_id = (select auth.uid())");
      expect(body, name).toContain(`public.has_tool_access('${COLLECTION_TOOL_SLUG}')`);
    }
  });

  it("every function it makes states its execute grants, never to anon", () => {
    const functions = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    expect(functions.length).toBeGreaterThan(4);
    for (const fn of functions) {
      expect(sql, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`));
    }
    // The trigger functions run as the table's triggers only.
    expect(sql).toContain("revoke all on function public.enforce_collection_cap() from public, anon, authenticated;");
  });

  it("the cap is ONE number in SQL, and it is the app's", () => {
    const cap = /create or replace function public\.collection_card_cap\(\)[\s\S]*?as \$\$ select (\d+) \$\$;/.exec(sql);
    expect(cap).not.toBeNull();
    expect(Number(cap![1])).toBe(COLLECTION_CARD_CAP);
    expect(COLLECTION_CARD_CAP).toBe(25_000);
    // Nowhere else a literal cap.
    expect(sql.match(/\b25000\b/g)).toHaveLength(1);
  });

  it("the cap is enforced after every insert statement, under a per-owner lock", () => {
    expect(sql).toMatch(
      /create trigger collection_cards_enforce_cap\s+after insert on public\.collection_cards\s+referencing new table as new_rows\s+for each statement execute function public\.enforce_collection_cap\(\);/,
    );
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('pipglyph.collection:' || v_owner::text, 0))");
    expect(sql).toMatch(/order by n\.owner_id loop/);
    expect(sql).toContain("raise exception 'collection_capacity_exceeded'");
  });

  it("counts DIFFERENT cards: one row per printing, finish and language; copies are a column", () => {
    expect(sql).toContain("unique (owner_id, scryfall_id, finish, lang)");
    expect(sql).toMatch(new RegExp(`quantity between 1 and ${MAX_COLLECTION_QUANTITY}`));
  });

  it("never touches the saved-card limit", () => {
    expect(sql).not.toMatch(/card_capacity_for|cards_enforce_capacity/);
    expect(sql).not.toMatch(/(insert into|update) public\.cards\b/);
    // A sanity line: the plans' caps are far below a collection's.
    expect(Math.max(...Object.values(CARD_CAPACITY).filter((v): v is number => typeof v === "number"))).toBeLessThan(
      COLLECTION_CARD_CAP,
    );
  });

  it("writes no deck entry of its own: decks go through the deck writers", () => {
    expect(sql).not.toMatch(/insert into public\.deck_cards/);
  });

  it("the Scryfall label CHECK holds exactly the app's labels", () => {
    const check = /add constraint scryfall_calls_action_check\s+check \(action in \(([^)]*)\)\);/.exec(sql);
    expect(check).not.toBeNull();
    const labels = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(labels).toEqual(Object.keys(SCRYFALL_LIMITS).sort());
  });

  it("the buildable-decks read runs as the caller (deck RLS hides private entries)", () => {
    const fn = /create or replace function public\.collection_buildable_decks\([\s\S]*?\$\$;/.exec(sql)?.[0] ?? "";
    expect(fn).toContain("security invoker");
    expect(fn).toContain("public.owner_is_creator(");
    expect(fn).toContain("public.has_tool_access('collection-builder')");
  });

  it("the seed refuses a database with real users and holds no credential", () => {
    expect(seed).toContain("Refusing to seed dev data");
    expect(seed).not.toMatch(/\bpassword\b|\bsecret\b|api[_-]?key/i);
  });
});
