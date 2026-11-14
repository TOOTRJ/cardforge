import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REART_CARD_WORDS_MAX,
  REART_PROMPT_MAX,
  REART_STYLE_MODES,
  REART_TOOL_SLUG,
} from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck's own prompts (migration 0209): the deck's style gains how its
// prompt is made and the maker's own prompt — every stored style stays the
// template — and one card's own words live by deck ENTRY in a table that is
// the SERVER's to write, held to the deck's owner and to an entry of that
// deck, read by the owner while the tool is open to them. The database's
// limits are the model's. Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_re_art_custom_prompts\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
/** The statements, without the comments (a word in a comment proves nothing). */
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const seed = readFileSync(join(process.cwd(), "supabase/seeds/55_re_art_prompts.sql"), "utf8");

describe("0209 re-art deck's own prompts", () => {
  it("exists after the tool's own migration", () => {
    expect(file).not.toBe("");
    const tool = files.find((f) => /^\d{4}_re_art_deck\.sql$/.test(f)) ?? "";
    expect(file > tool).toBe(true);
  });

  it("every stored style stays the template: the new columns default to it", () => {
    expect(code).toMatch(/add column if not exists mode text not null default 'preset'/);
    expect(code).toMatch(/add column if not exists prompt text not null default ''/);
    // Nothing stored is rewritten, and no card is touched.
    expect(code).not.toMatch(/\bupdate\s+public\./i);
    expect(code).not.toMatch(/public\.cards\b/);
  });

  it("the database's limits are the model's", () => {
    const modes = REART_STYLE_MODES.map((mode) => `'${mode}'`).join(", ");
    expect(code).toContain(`add constraint deck_art_styles_mode_check check (mode in (${modes}));`);
    expect(code).toContain(`add constraint deck_art_styles_prompt_check check (char_length(prompt) <= ${REART_PROMPT_MAX});`);
    expect(code).toContain(`prompt text not null check (char_length(prompt) between 1 and ${REART_CARD_WORDS_MAX})`);
  });

  it("is idempotent: constraints, the policy and the trigger are dropped before they are made", () => {
    for (const name of ["deck_art_styles_mode_check", "deck_art_styles_prompt_check"]) {
      expect(code.indexOf(`drop constraint if exists ${name}`)).toBeGreaterThan(0);
      expect(code.indexOf(`drop constraint if exists ${name}`)).toBeLessThan(code.indexOf(`add constraint ${name}`));
    }
    expect(code).toContain("create table if not exists public.deck_reart_prompts");
    expect(code).toContain('drop policy if exists "Deck re-art prompts: owner reads" on public.deck_reart_prompts;');
    expect(code).toContain("drop trigger if exists deck_reart_prompts_check_owner on public.deck_reart_prompts;");
    expect(code).toMatch(/create index if not exists deck_reart_prompts_entry_idx/);
  });

  it("a card's words are read by their owner while the tool is open, and written by the server alone", () => {
    const table = "deck_reart_prompts";
    expect(code).toContain(`alter table public.${table} enable row level security;`);
    const revoke = code.indexOf(`revoke all on public.${table} from public, anon, authenticated;`);
    expect(revoke).toBeGreaterThan(0);
    expect(code.indexOf(`grant select on public.${table} to authenticated;`)).toBeGreaterThan(revoke);
    expect(code).toContain(`grant select, insert, update, delete on public.${table} to service_role;`);
    expect(code).not.toMatch(new RegExp(`grant [^;]*\\b(insert|update|delete)\\b[^;]*on public\\.${table} to authenticated`));
    expect(code).not.toMatch(new RegExp(`create policy [^;]*on public\\.${table} for (insert|update|delete|all)`));
    expect(code).toMatch(
      new RegExp(`for select\\s+to authenticated\\s+using \\(owner_id = \\(select auth\\.uid\\(\\)\\) and public\\.has_tool_access\\('${REART_TOOL_SLUG}'\\)\\);`),
    );
    expect(code).not.toMatch(/to [a-z_, ]*\banon\b/);
    expect(code).not.toMatch(/grant all on all/i);
  });

  it("every row is held to the deck's owner AND to an entry of that deck", () => {
    const fn = code.slice(code.indexOf("create or replace function public.deck_reart_prompts_check_owner()"));
    const body = fn.slice(0, fn.indexOf("$$;"));
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = ''");
    expect(body).toContain("d.id = new.deck_id and d.owner_id = new.owner_id");
    expect(body).toContain("dc.id = new.entry_id and dc.deck_id = new.deck_id");
    expect(body).toContain("errcode = '42501'");
    expect(code).toContain("before insert or update on public.deck_reart_prompts");
    expect(code).toContain("revoke all on function public.deck_reart_prompts_check_owner() from public, anon, authenticated;");
  });

  it("the words go with their deck and their entry", () => {
    expect(code).toContain("deck_id uuid not null references public.decks (id) on delete cascade");
    expect(code).toContain("entry_id uuid not null references public.deck_cards (id) on delete cascade");
    expect(code).toContain("owner_id uuid not null references public.profiles (id) on delete cascade");
    expect(code).toContain("primary key (deck_id, entry_id)");
  });

  it("the seed is guarded, repeatable, holds no credentials and fits the limits", () => {
    expect(seed).toMatch(/raise exception/);
    expect(seed).toContain("on conflict (deck_id, entry_id) do nothing");
    expect(seed).not.toMatch(/password\s*[:=]/i);
    const words = /'(an old goblin librarian[^']*)'/.exec(seed)?.[1] ?? "";
    expect(words.length).toBeGreaterThan(10);
    expect(words.length).toBeLessThanOrEqual(REART_CARD_WORDS_MAX);
  });
});
