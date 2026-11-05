import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0169 (TODO HM4): the pool is the service role's alone, visitors
// get ONE read, the pool needs only "public with a bake" while suggestions
// and the fallback pair keep the original-card guard, and every check reads
// only the columns it can judge — never a title, printed_types or any text.
// ---------------------------------------------------------------------------

const sql = readFileSync("supabase/migrations/0169_featured_pool.sql", "utf8");
const body = (fn: string) => {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("$$;", start));
};

describe("0169_featured_pool", () => {
  it("grants the pool table to the service role only", () => {
    expect(sql).toMatch(/revoke all on table public\.featured_pool from public, anon, authenticated;/);
    expect(sql).toMatch(/grant select, insert, update, delete on table public\.featured_pool to service_role;/);
    expect(sql).not.toMatch(/create policy[^;]*featured_pool/i);
  });

  it("gives visitors home_hero_pool alone; every admin function is the service role's", () => {
    expect(sql).toMatch(/grant execute on function public\.home_hero_pool\(\) to anon, authenticated, service_role;/);
    for (const sig of [
      "home_hero_shown_refusal(public.cards)",
      "home_hero_original_refusal(public.cards)",
      "home_hero_refusal(public.cards)",
      "featured_pool_admin_list()",
      "featured_pool_suggestions(integer)",
      "featured_pool_add(uuid, uuid, boolean)",
    ]) {
      const escaped = sig.replace(/[().]/g, (c) => `\\${c}`);
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${escaped} to service_role;`));
    }
  });

  it("the checks read only visibility, the render, the two Scryfall ids, the parent and the owner", () => {
    const columns = (fn: string) => new Set([...body(fn).matchAll(/\bc\.([a-z_]+)/g)].map((m) => m[1]));
    expect(columns("home_hero_shown_refusal")).toEqual(new Set(["visibility", "rendered_image_url"]));
    expect(columns("home_hero_original_refusal")).toEqual(
      new Set(["source_scryfall_id", "import_scryfall_id", "parent_card_id", "owner_id"]),
    );
    for (const fn of ["home_hero_shown_refusal", "home_hero_original_refusal", "home_hero_refusal"]) {
      expect(body(fn)).not.toMatch(/title|printed_types|rules_text|subtypes|nickname/);
    }
  });

  it("the full guard is the original reasons, then the shown ones", () => {
    const codes = (fn: string) => [...body(fn).matchAll(/then '([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes("home_hero_original_refusal")).toEqual(["from_real_card", "remix", "not_creator"]);
    expect(codes("home_hero_shown_refusal")).toEqual(["not_public", "no_render"]);
    expect(body("home_hero_refusal")).toMatch(
      /coalesce\(public\.home_hero_original_refusal\(c\), public\.home_hero_shown_refusal\(c\)\)/,
    );
  });

  it("the pool needs only the shown check; suggestions and the fallback pair the full guard", () => {
    const read = body("home_hero_pool");
    const poolPart = read.slice(0, read.indexOf("union all"));
    const fallbackPart = read.slice(read.indexOf("union all"));
    expect(poolPart).toMatch(/home_hero_shown_refusal\(c\) is null/);
    expect(poolPart).not.toMatch(/home_hero_refusal|original_refusal/);
    expect(fallbackPart).toMatch(/home_hero_refusal\(c\) is null/);
    expect(body("featured_pool_suggestions")).toMatch(/home_hero_refusal\(c\) is null/);
  });

  it("an add takes the full guard unless the caller asks for the shown check by name (fail closed)", () => {
    const add = body("featured_pool_add");
    expect(add).toMatch(/case when p_original_only is false\s+then public\.home_hero_shown_refusal\(v_card\)\s+else public\.home_hero_refusal\(v_card\)/);
  });

  it("the admin list carries the original reason for pool rows as a note", () => {
    const list = body("featured_pool_admin_list");
    expect(list).toMatch(/home_hero_shown_refusal\(c\), public\.home_hero_original_refusal\(c\)/);
    expect(list).toMatch(/home_hero_refusal\(c\), null::text/);
  });

  it("is a definer read with an empty search_path", () => {
    const read = body("home_hero_pool");
    expect(read).toMatch(/security definer/);
    expect(read).toMatch(/set search_path = ''/);
  });
});
