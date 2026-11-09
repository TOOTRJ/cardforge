import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REART_THEME_MAX, REART_TOOL_SLUG } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck's migration (0191): the job kind and the AI label are added to
// the LATEST lists (never one dropped — whichever parallel tool merged first
// is kept), the tool's two tables are the SERVER's to write and held to the
// deck's and the card's owner, the owner reads their own while the tool is
// open to them, and the seed is guarded. Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_re_art_deck\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const seed = readFileSync(join(process.cwd(), "supabase/seeds/52_re_art_deck.sql"), "utf8");

function previousList(constraint: string): string[] {
  const before = files.filter((f) => f < file).reverse();
  for (const name of before) {
    const text = readFileSync(join(dir, name), "utf8");
    const at = text.lastIndexOf(`add constraint ${constraint}`);
    if (at < 0) continue;
    const body = text.slice(at, text.indexOf(";", at));
    return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }
  throw new Error(`no earlier ${constraint}`);
}

function listIn(constraint: string): string[] {
  const at = sql.lastIndexOf(`add constraint ${constraint}`);
  return [...sql.slice(at, sql.indexOf(";", at)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

function fnBody(name: string): string {
  const fn = sql.slice(sql.indexOf(`create or replace function public.${name}()`));
  return fn.slice(0, fn.indexOf("$$;"));
}

describe("0191 re-art deck", () => {
  it("exists after Bulk Customize, which it is built on", () => {
    expect(file).not.toBe("");
    const bulk = files.find((f) => /^\d{4}_bulk_customize\.sql$/.test(f)) ?? "";
    expect(file > bulk).toBe(true);
  });

  it("adds the job kind to the latest list, dropping none", () => {
    expect(listIn("ai_generation_jobs_kind_check")).toEqual([...previousList("ai_generation_jobs_kind_check"), "deck_reart"]);
  });

  it("adds the AI label to the latest list, dropping none", () => {
    expect(listIn("card_ai_calls_action_check")).toEqual([...previousList("card_ai_calls_action_check"), "deck_reart_art"]);
  });

  it("both tables are read by their owner while the tool is open, and written by the server alone", () => {
    for (const table of ["deck_art_styles", "deck_reart_cards"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      const revoke = sql.indexOf(`revoke all on public.${table} from public, anon, authenticated;`);
      expect(revoke, table).toBeGreaterThan(0);
      expect(sql.indexOf(`grant select on public.${table} to authenticated;`), table).toBeGreaterThan(revoke);
      expect(sql, table).not.toMatch(new RegExp(`grant [^;]*\\b(insert|update|delete)\\b[^;]*on public\\.${table} to authenticated`));
      expect(sql, table).toContain(`grant select, insert, update, delete on public.${table} to service_role;`);
      expect(sql, table).not.toMatch(new RegExp(`create policy [^;]*on public\\.${table} for (insert|update|delete|all)`));
    }
    expect(sql.match(new RegExp(`public\\.has_tool_access\\('${REART_TOOL_SLUG}'\\)`, "g"))?.length).toBe(2);
    expect(sql).not.toMatch(/to [a-z_, ]*\banon\b/);
    expect(sql).not.toMatch(/grant all on all/i);
  });

  it("every row is held to the deck's and the card's owner", () => {
    const style = fnBody("deck_art_styles_check_owner");
    expect(style).toContain("security definer");
    expect(style).toContain("set search_path = ''");
    expect(style).toContain("d.owner_id = new.owner_id");
    const cards = fnBody("deck_reart_cards_check_owner");
    expect(cards).toContain("security definer");
    expect(cards).toContain("set search_path = ''");
    expect(cards).toContain("d.owner_id = new.owner_id");
    expect(cards).toContain("c.owner_id = new.owner_id");
    expect(sql).toContain("revoke all on function public.deck_art_styles_check_owner() from public, anon, authenticated;");
    expect(sql).toContain("revoke all on function public.deck_reart_cards_check_owner() from public, anon, authenticated;");
  });

  it("goes with its deck and its card, and the words fit the model's limit", () => {
    expect(sql).toContain("deck_id uuid primary key references public.decks (id) on delete cascade");
    expect(sql).toContain("card_id uuid not null references public.cards (id) on delete cascade");
    expect(sql).toContain(`check (char_length(theme) <= ${REART_THEME_MAX})`);
  });

  it("the seed is guarded, grants the tool and holds no credentials", () => {
    expect(seed).toMatch(/raise exception/);
    expect(seed).toContain(`'${REART_TOOL_SLUG}'`);
    expect(seed).not.toMatch(/password\s*[:=]/i);
  });
});
