import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRENDING_RANGE_RULES, TRENDING_WEIGHTS } from "@/lib/cards/trending";

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
//   * trending by range is the gallery's (0166's list_trending_cards) over
//     deck likes: the SAME range block (windows, half-lives, month for an
//     unknown range), the like's weight, the owner's own like never, one
//     deck per creator, ties ending on the newest DECK (never updated_at).
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
    for (const signature of [
      "list_featured_deck_themes(integer, integer)",
      "list_discover_decks(text, integer)",
      "list_trending_decks_by_range(text, integer)",
    ]) {
      expect(body).toContain(`revoke all on function public.${signature} from public;`);
      expect(body).toContain(`grant execute on function public.${signature} to anon, authenticated, service_role;`);
    }
  });
});

describe("trending decks by range — the gallery's rules (0166)", () => {
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  const cardsFile = readdirSync(dir).find((f) => /^\d{4}_trending_card_ranges\.sql$/.test(f));
  const cardsSql = cardsFile ? readFileSync(join(dir, cardsFile), "utf8") : "";
  /** A function's `cfg` CTE — the ranges' windows and half-lives. */
  const cfgOf = (source: string) => {
    const start = source.indexOf("with cfg as (");
    return flat(source.slice(start, source.indexOf("),", source.indexOf("half_life_days", start))));
  };
  const deckFn = flat(fn("list_trending_decks_by_range"));

  it("has the gallery's function to match", () => {
    expect(cardsFile).toBeDefined();
    expect(deckFn).not.toBe("");
  });

  it("reads the ranges exactly as the gallery does (month for anything else)", () => {
    expect(cfgOf(cardsSql)).toContain("as half_life_days");
    expect(cfgOf(fn("list_trending_decks_by_range"))).toBe(cfgOf(cardsSql));
    expect(deckFn).toContain(
      `when 'week' then now() - interval '${TRENDING_RANGE_RULES.week.windowDays} days' ` +
        `when 'year' then now() - interval '${TRENDING_RANGE_RULES.year.windowDays} days' ` +
        `when 'all' then '-infinity'::timestamptz ` +
        `else now() - interval '${TRENDING_RANGE_RULES.month.windowDays} days'`,
    );
    expect(deckFn).toContain(
      `when 'week' then ${TRENDING_RANGE_RULES.week.halfLifeDays}.0 ` +
        `when 'year' then ${TRENDING_RANGE_RULES.year.halfLifeDays}.0 ` +
        `when 'all' then null else ${TRENDING_RANGE_RULES.month.halfLifeDays}.0`,
    );
  });

  it("scores a like as the gallery does, decayed by its age, never the owner's own", () => {
    expect(deckFn).toContain(
      `${TRENDING_WEIGHTS.like}.0 * case when cfg.half_life_days is null then 1.0 else power(0.5, greatest(extract(epoch from (now() - l.created_at)), 0) / 86400.0 / cfg.half_life_days) end`,
    );
    expect(deckFn).toContain("where l.created_at >= cfg.since and l.user_id <> d.owner_id");
  });

  it("ranks public, non-empty decks of real creators, one per creator, ending on the newest deck", () => {
    expect(deckFn).toContain("and d.visibility = 'public' and d.card_count > 0");
    expect(deckFn).toContain("where public.owner_is_creator(s.owner_id)");
    expect(deckFn).toContain("partition by s.owner_id");
    expect(deckFn).toContain("where b.creator_rank = 1");
    expect(deckFn).toContain("order by b.score desc, b.likes desc, b.likes_count desc, b.created_at desc, b.id");
    expect(deckFn).not.toContain("updated_at");
    expect(deckFn).toContain("limit least(greatest(coalesce(p_limit, 8), 1), 24)");
  });

  it("is SECURITY INVOKER with an empty search_path", () => {
    expect(deckFn).toMatch(/language sql stable security invoker set search_path = ''/);
  });
});
