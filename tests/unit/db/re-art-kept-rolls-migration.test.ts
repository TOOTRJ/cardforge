import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REART_METHODS } from "@/lib/tools/re-art/model";
import { isAllowedMediaUrl } from "@/lib/media/media-urls";

// ---------------------------------------------------------------------------
// Re-art deck — a card's earlier pictures (migration 0215, deck_reart_rolls):
// a re-roll and "Put the old art back" keep the picture they take off.
//
//   * A NEW table and nothing else: no stored card, style or painted row
//     changes.
//   * Keyed on ONE column, the picture unique per deck and card — never a
//     composite primary key over its foreign keys, which the API reads as a
//     link between two tables (the 0209 incident).
//   * Written by the server only; the owner reads their own while the tool
//     is open to them; the deck and the card are the row owner's own,
//     whoever writes.
//   * Its seed keeps two pictures a preview can pick without painting.
// Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_re_art_kept_rolls\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
/** The statements, without the comments (a word in a comment proves nothing). */
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8");

describe("0215 re-art deck: a card's earlier pictures", () => {
  it("exists after the migration for a licensed property", () => {
    expect(file).not.toBe("");
    const before = files.find((f) => /^\d{4}_re_art_licensed_property\.sql$/.test(f)) ?? "";
    expect(before).not.toBe("");
    expect(file > before).toBe(true);
  });

  it("makes one table and changes no other: no stored card, style or painted row is touched", () => {
    expect(code.match(/create table if not exists public\.(\w+)/g)).toEqual(["create table if not exists public.deck_reart_rolls"]);
    expect(code).not.toMatch(/alter table public\.(?!deck_reart_rolls\b)/);
    expect(code).not.toMatch(/\b(update|insert into|delete from|truncate|drop table|drop column)\b\s+public\./i);
  });

  it("is keyed on ONE column, with the picture unique per deck and card — never a link between two tables to the API", () => {
    expect(code).toMatch(/id uuid primary key default gen_random_uuid\(\)/);
    expect(code.match(/primary\s+key/gi)).toHaveLength(1);
    expect(code).not.toMatch(/primary key \(/i);
    expect(code).toMatch(/create unique index if not exists deck_reart_rolls_picture_key\s+on public\.deck_reart_rolls \(deck_id, card_id, art_url\);/);
  });

  it("goes with its deck, its card and its owner", () => {
    expect(code).toMatch(/deck_id uuid not null references public\.decks \(id\) on delete cascade/);
    expect(code).toMatch(/card_id uuid not null references public\.cards \(id\) on delete cascade/);
    expect(code).toMatch(/owner_id uuid not null references public\.profiles \(id\) on delete cascade/);
    // The run that painted it is no foreign key: a job row may be pruned.
    expect(code).toMatch(/job_id uuid,/);
  });

  it("holds what a pick needs, with deck_reart_cards' own limits and the model's words", () => {
    expect(code).toContain("art_url text not null check (char_length(art_url) between 1 and 2048)");
    expect(code).toContain("back_art_url text check (back_art_url is null or char_length(back_art_url) between 1 and 2048)");
    for (const column of ["art_position", "back_art_position"]) {
      expect(code).toContain(`check (${column} is null or (jsonb_typeof(${column}) = 'object' and octet_length(${column}::text) <= 400))`);
    }
    for (const column of ["artist_credit", "back_artist_credit"]) {
      expect(code).toContain(`${column} text check (${column} is null or char_length(${column}) <= 200)`);
    }
    expect(code).toContain("image_model text check (image_model is null or char_length(image_model) between 1 and 200)");
    expect(code).toContain(`method text check (method is null or method in (${REART_METHODS.map((m) => `'${m}'`).join(", ")}))`);
    expect(code).toMatch(/style_version integer not null check \(style_version between 1 and 100000\)/);
    expect(code).toMatch(/painted_at timestamptz not null,/);
  });

  it("the deck and the card are the row owner's own — asked by a trigger, whoever writes", () => {
    const fn = code.slice(code.indexOf("create or replace function public.deck_reart_rolls_check_owner()"), code.indexOf("drop trigger if exists deck_reart_rolls_check_owner"));
    expect(fn).toMatch(/security definer/);
    expect(fn).toMatch(/set search_path = ''/);
    expect(fn).toMatch(/d\.id = new\.deck_id and d\.owner_id = new\.owner_id/);
    expect(fn).toMatch(/c\.id = new\.card_id and c\.owner_id = new\.owner_id/);
    expect(fn).toMatch(/raise exception 'deck_reart_roll_not_owner'/);
    expect(code).toMatch(/create trigger deck_reart_rolls_check_owner\s+before insert or update on public\.deck_reart_rolls/);
    expect(code).toContain("revoke all on function public.deck_reart_rolls_check_owner() from public, anon, authenticated;");
  });

  it("is written by the server only; the owner reads their own while the tool is open to them", () => {
    expect(code).toContain("alter table public.deck_reart_rolls enable row level security;");
    const policies = code.match(/create policy [\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/on public\.deck_reart_rolls for select\s+to authenticated/);
    expect(policies[0]).toMatch(/owner_id = \(select auth\.uid\(\)\) and public\.has_tool_access\('re-art-deck'\)/);
    expect(code).toContain("revoke all on public.deck_reart_rolls from public, anon, authenticated;");
    expect(code).toContain("grant select on public.deck_reart_rolls to authenticated;");
    expect(code).toContain("grant select, insert, update, delete on public.deck_reart_rolls to service_role;");
    expect(code).not.toMatch(/to anon/);
    expect(code.match(/grant [^;]+ on public\.deck_reart_rolls to authenticated;/g)).toHaveLength(1);
  });

  it("is idempotent: every object is made only if absent, or dropped first", () => {
    expect(code).not.toMatch(/create table (?!if not exists)/);
    expect(code).not.toMatch(/create (unique )?index (?!if not exists)/);
    expect(code.indexOf("drop policy if exists")).toBeLessThan(code.indexOf("create policy"));
    expect(code.indexOf("drop trigger if exists")).toBeLessThan(code.indexOf("create trigger"));
  });

  it("the generated types know the table", () => {
    const table = types.slice(types.indexOf("deck_reart_rolls: {"));
    const block = table.slice(0, table.indexOf("Relationships:"));
    expect(block.match(/\bart_url: string;/g)).toHaveLength(2); // the row, and an insert (required)
    expect(block.match(/\bback_art_url\?: string \| null;/g)).toHaveLength(2);
    expect(block.match(/\bpainted_at: string;/g)).toHaveLength(2);
    expect(block.match(/\bkept_at\?: string;/g)).toHaveLength(2);
  });

  it("its seed keeps two pictures a preview can pick for free — built-in pictures a card's art may hold, and no painted row", () => {
    const seed = readFileSync(join(process.cwd(), "supabase/seeds/57_re_art_kept_rolls.sql"), "utf8");
    const rows = seed
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const pictures = rows.match(/https:\/\/pipglyph\.com\/defaults\/[a-z]+\/[a-z]+-\d\d\.webp/g) ?? [];
    expect(pictures).toHaveLength(2);
    expect(new Set(pictures).size).toBe(2);
    // The card action takes them as a card's art (the pick edits the card).
    for (const url of pictures) expect(isAllowedMediaUrl("card-art", url), url).toBe(true);
    expect(rows).toMatch(/insert into public\.deck_reart_rolls \(/);
    expect(rows).toMatch(/on conflict \(id\) do nothing;/);
    expect(rows).toMatch(/Refusing to seed dev data/);
    expect(rows).not.toMatch(/deck_reart_cards/);
    expect(rows).not.toMatch(/\b(update|delete)\b/i);
  });
});
