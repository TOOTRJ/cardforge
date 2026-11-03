import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration *_featured_deck_themes.sql (0167; found by name so a renumber at
// rebase doesn't break this) — "Featured themed decks" and /decks
// "Discover":
//   * the two pick tables are admin state: RLS on, NO policy, nothing to
//     anon / authenticated (production auto-grants them — revoked here),
//     the service role writes;
//   * every visitor read is ONE function per section, and both keep the
//     same pool: public, non-empty (the stored card_count), a real
//     creator's deck (owner_is_creator);
//   * Discover draws u as 0158's (bits + 0.5) / 2³² — never 0086's signed
//     offset — and orders by -ln(u) / weight ascending.
// The behaviour itself (an empty, an admin's and an unlisted deck never
// come up; the weighting; a resting theme hidden) was proven on the local
// stack — see the PR.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_featured_deck_themes\.sql$/.test(f));
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const body = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const fn = (name: string) => {
  const start = body.indexOf(`create or replace function public.${name}(`);
  return start < 0 ? "" : body.slice(start, body.indexOf("$$;", start));
};

describe("the featured deck themes migration", () => {
  it("exists", () => {
    expect(file).toBeDefined();
  });

  it("keeps the pick tables to the service role", () => {
    for (const table of ["deck_themes", "deck_theme_decks"]) {
      expect(body).toContain(`alter table public.${table} enable row level security;`);
      expect(body).toContain(`revoke all on table public.${table} from public, anon, authenticated;`);
      expect(body).toContain(`grant select, insert, update, delete on table public.${table} to service_role;`);
      expect(body).not.toMatch(new RegExp(`create policy[^;]*on public\\.${table}`, "i"));
      expect(body).not.toMatch(new RegExp(`grant [^;]* on table public\\.${table} to [^;]*(anon|authenticated)`, "i"));
    }
  });

  it("mirrors the title and blurb limits the app validates", async () => {
    const { DECK_THEME_TITLE_MAX, DECK_THEME_BLURB_MAX } = await import("@/lib/validation/deck-theme");
    expect(body).toContain(`char_length(title) between 1 and ${DECK_THEME_TITLE_MAX}`);
    expect(body).toContain(`char_length(blurb) between 1 and ${DECK_THEME_BLURB_MAX}`);
  });

  it("both reads keep one pool: public, non-empty, a real creator's", () => {
    for (const name of ["list_featured_deck_themes", "list_discover_decks"]) {
      const source = fn(name);
      expect(source, name).toContain("d.visibility = 'public'");
      expect(source, name).toContain("d.card_count > 0");
      expect(source, name).toContain("public.owner_is_creator(d.owner_id)");
      expect(source, name).toContain("set search_path = ''");
    }
  });

  it("the featured read leaves out a resting theme and one with no visible deck", () => {
    const source = fn("list_featured_deck_themes");
    expect(source).toContain("security definer");
    expect(source).toMatch(/where t\.is_live\s+and picks\.deck_ids is not null/);
    expect(source).toContain("returns table (theme_id uuid, title text, blurb text, deck_ids uuid[])");
  });

  it("Discover is an invoker read with 0158's draw", () => {
    const source = fn("list_discover_decks");
    expect(source).toContain("security invoker");
    expect(source).not.toContain("2147483648");
    expect(source).toContain("::bit(32)::bigint + 0.5) / 4294967296.0");
    expect(source).toMatch(/order by -ln\(b\.discover_u\) \/ b\.discover_weight asc, d\.id/);
  });

  it("states the functions' grants", () => {
    for (const signature of ["list_featured_deck_themes(integer, integer)", "list_discover_decks(text, integer)"]) {
      expect(body).toContain(`revoke all on function public.${signature} from public;`);
      expect(body).toContain(`grant execute on function public.${signature} to anon, authenticated, service_role;`);
    }
  });
});
