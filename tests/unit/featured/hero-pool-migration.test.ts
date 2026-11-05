import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0169 (TODO HM4): the pool is the service role's alone, visitors
// get ONE read, and the original-card guard reads only the columns it can
// judge — never a title, printed_types or any other text.
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
      "home_hero_refusal(public.cards)",
      "featured_pool_admin_list()",
      "featured_pool_suggestions(integer)",
      "featured_pool_add(uuid, uuid)",
    ]) {
      const escaped = sig.replace(/[().]/g, (c) => `\\${c}`);
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${escaped} to service_role;`));
    }
  });

  it("the guard reads only visibility, the render, the two Scryfall ids, the parent and the owner", () => {
    const guard = body("home_hero_refusal");
    const columns = [...guard.matchAll(/\bc\.([a-z_]+)/g)].map((m) => m[1]);
    expect(new Set(columns)).toEqual(
      new Set([
        "visibility",
        "rendered_image_url",
        "source_scryfall_id",
        "import_scryfall_id",
        "parent_card_id",
        "owner_id",
      ]),
    );
    expect(guard).not.toMatch(/title|printed_types|rules_text|subtypes|nickname/);
  });

  it("names the lasting reasons before the ones the card's owner can change", () => {
    const codes = [...body("home_hero_refusal").matchAll(/then '([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes).toEqual(["from_real_card", "remix", "not_creator", "not_public", "no_render"]);
  });

  it("applies the guard when a card is added and on every visitor read (pool and fallback slots)", () => {
    expect(body("featured_pool_add")).toMatch(/home_hero_refusal\(v_card\)/);
    expect(body("home_hero_pool").match(/home_hero_refusal\(c\) is null/g)).toHaveLength(2);
    expect(body("featured_pool_suggestions")).toMatch(/home_hero_refusal\(c\) is null/);
  });

  it("is a definer read with an empty search_path", () => {
    const read = body("home_hero_pool");
    expect(read).toMatch(/security definer/);
    expect(read).toMatch(/set search_path = ''/);
  });
});
