import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Re-art deck — locked cards (migration 0216, deck_reart_locks): a deck
// entry whose picture the tool leaves as it is.
//
//   * A NEW table and nothing else.
//   * Keyed on ONE column (the entry) — never a composite primary key over
//     its two foreign keys, which the API reads as a link between decks and
//     deck_cards and then refuses every embedded read between them (the
//     0209 incident; 0210).
//   * Written by the server only (insert and delete: a lock is there or it
//     isn't); the owner reads their own while the tool is open to them; the
//     deck is the row owner's own and the entry one of that deck's, whoever
//     writes.
//   * Its seed locks one card of the sampler deck.
// Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_re_art_locks\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
/** The statements, without the comments (a word in a comment proves nothing). */
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8");

describe("0216 re-art deck: locked cards", () => {
  it("exists after the migration for kept pictures", () => {
    expect(file).not.toBe("");
    const before = files.find((f) => /^\d{4}_re_art_kept_rolls\.sql$/.test(f)) ?? "";
    expect(before).not.toBe("");
    expect(file > before).toBe(true);
  });

  it("makes one table and changes no other", () => {
    expect(code.match(/create table if not exists public\.(\w+)/g)).toEqual(["create table if not exists public.deck_reart_locks"]);
    expect(code).not.toMatch(/alter table public\.(?!deck_reart_locks\b)/);
    expect(code).not.toMatch(/\b(update|insert into|delete from|truncate|drop table|drop column)\b\s+public\./i);
  });

  it("is keyed on the ENTRY alone — never a link between decks and deck_cards to the API", () => {
    expect(code).toMatch(/entry_id uuid primary key references public\.deck_cards \(id\) on delete cascade/);
    expect(code.match(/primary\s+key/gi)).toHaveLength(1);
    expect(code).not.toMatch(/primary key \(/i);
  });

  it("goes with its entry, its deck and its owner", () => {
    expect(code).toMatch(/deck_id uuid not null references public\.decks \(id\) on delete cascade/);
    expect(code).toMatch(/owner_id uuid not null references public\.profiles \(id\) on delete cascade/);
  });

  it("the deck is the row owner's own and the entry is one of that deck's — asked by a trigger, whoever writes", () => {
    const fn = code.slice(code.indexOf("create or replace function public.deck_reart_locks_check_owner()"), code.indexOf("drop trigger if exists deck_reart_locks_check_owner"));
    expect(fn).toMatch(/security definer/);
    expect(fn).toMatch(/set search_path = ''/);
    expect(fn).toMatch(/d\.id = new\.deck_id and d\.owner_id = new\.owner_id/);
    expect(fn).toMatch(/dc\.id = new\.entry_id and dc\.deck_id = new\.deck_id/);
    expect(fn).toMatch(/raise exception 'deck_reart_lock_not_owner'/);
    expect(code).toMatch(/create trigger deck_reart_locks_check_owner\s+before insert or update on public\.deck_reart_locks/);
    expect(code).toContain("revoke all on function public.deck_reart_locks_check_owner() from public, anon, authenticated;");
  });

  it("is written by the server only — a lock is put there or taken away, never changed; the owner reads their own while the tool is open to them", () => {
    expect(code).toContain("alter table public.deck_reart_locks enable row level security;");
    const policies = code.match(/create policy [\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/on public\.deck_reart_locks for select\s+to authenticated/);
    expect(policies[0]).toMatch(/owner_id = \(select auth\.uid\(\)\) and public\.has_tool_access\('re-art-deck'\)/);
    expect(code).toContain("revoke all on public.deck_reart_locks from public, anon, authenticated;");
    expect(code).toContain("grant select on public.deck_reart_locks to authenticated;");
    expect(code).toContain("grant select, insert, delete on public.deck_reart_locks to service_role;");
    expect(code).not.toMatch(/to anon/);
    for (const grant of code.match(/grant [^;]+ on public\.deck_reart_locks to [^;]+;/g) ?? []) expect(grant).not.toMatch(/\b(update|truncate|all)\b/i);
  });

  it("is idempotent: every object is made only if absent, or dropped first", () => {
    expect(code).not.toMatch(/create table (?!if not exists)/);
    expect(code).not.toMatch(/create (unique )?index (?!if not exists)/);
    expect(code.indexOf("drop policy if exists")).toBeLessThan(code.indexOf("create policy"));
    expect(code.indexOf("drop trigger if exists")).toBeLessThan(code.indexOf("create trigger"));
  });

  it("the generated types know the table", () => {
    const table = types.slice(types.indexOf("deck_reart_locks: {"));
    const block = table.slice(0, table.indexOf("Relationships:"));
    expect(block.match(/\bentry_id: string;/g)).toHaveLength(2);
    expect(block.match(/\bdeck_id: string;/g)).toHaveLength(2);
    expect(block.match(/\bowner_id: string;/g)).toHaveLength(2);
  });

  it("its seed locks one card of the sampler deck, and nothing else", () => {
    const seed = readFileSync(join(process.cwd(), "supabase/seeds/58_re_art_locks.sql"), "utf8");
    const rows = seed
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(rows).toMatch(/insert into public\.deck_reart_locks \(entry_id, deck_id, owner_id\)/);
    expect(rows.match(/insert into/g)).toHaveLength(1);
    expect(rows).toMatch(/on conflict \(entry_id\) do nothing;/);
    expect(rows).toMatch(/Refusing to seed dev data/);
    expect(rows).not.toMatch(/\b(update|delete)\b/i);
  });
});
