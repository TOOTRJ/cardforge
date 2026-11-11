import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0196: home_hero_pool() — the home page hero's one read — finds
// its cards by primary key before it checks them. 0169's body let the
// planner read every card of the table and run the original-card guard
// (whose owner_is_creator looks an owner's public cards up) on each one for
// the two fallback slots: a mean of 1.8 s on production, and 25 calls a day
// cancelled at the anonymous role's 3 s statement timeout — each a home page
// built with no featured cards. Same rows, same order, same grants.
// ---------------------------------------------------------------------------

const sql = readFileSync("supabase/migrations/0196_home_hero_pool_by_key.sql", "utf8");
const before = readFileSync("supabase/migrations/0169_featured_pool.sql", "utf8");

const definition = (text: string) => {
  const start = text.indexOf("create or replace function public.home_hero_pool()");
  expect(start).toBeGreaterThan(-1);
  return text.slice(start, text.indexOf("$$;", start));
};
const signature = (text: string) => {
  const whole = definition(text);
  return whole.slice(0, whole.indexOf("as $$")).replace(/\s+/g, " ").trim();
};
const body = definition(sql).slice(definition(sql).indexOf("as $$"));
/** One CTE of the body, by name. */
const cte = (name: string) => {
  const start = body.indexOf(`${name} as`);
  expect(start).toBeGreaterThan(-1);
  const rest = body.slice(start);
  // Up to the next CTE or the final select.
  const end = rest.search(/\n {2}(?:[a-z_]+ as (?:materialized )?\(|select s\.)/);
  return end > 0 ? rest.slice(0, end) : rest;
};

describe("0196_home_hero_pool_by_key", () => {
  it("keeps 0169's signature word for word: the columns, stable, definer, the empty search_path", () => {
    expect(signature(sql)).toBe(signature(before));
    expect(signature(sql)).toMatch(/security definer set search_path = ''$/);
  });

  it("changes that one function and nothing else", () => {
    expect([...sql.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1])).toEqual(["home_hero_pool"]);
    expect(sql).not.toMatch(/\b(create|alter|drop) (table|index|policy|trigger)\b/i);
  });

  it("each half FETCHES its cards by primary key, behind fences the planner cannot move the check across", () => {
    const pool = cte("pool_rows");
    const fallback = cte("fallback_rows");
    expect(pool).toMatch(/^pool_rows as materialized \(/);
    expect(fallback).toMatch(/^fallback_rows as materialized \(/);
    expect(pool).toMatch(/from public\.featured_pool fp\s+cross join lateral \(\s+select c as card from public\.cards c where c\.id = fp\.card_id offset 0\s+\) l/);
    expect(fallback).toMatch(/from public\.featured_cards fc\s+cross join lateral \(\s+select c as card from public\.cards c where c\.id = fc\.card_id offset 0\s+\) l/);
    // No check inside a fetch: it would run on whatever the planner reads first.
    expect(pool).not.toMatch(/refusal/);
    expect(fallback).not.toMatch(/refusal/);
    // And no plain join of `cards` anywhere a check could be pushed under.
    expect(body).not.toMatch(/join public\.cards/);
  });

  it("the pool still needs only the shown check, the fallback pair the full guard — on the fetched rows", () => {
    const shown = cte("shown");
    const poolPart = shown.slice(0, shown.indexOf("union all"));
    const fallbackPart = shown.slice(shown.indexOf("union all"));
    expect(poolPart).toMatch(/from pool_rows p\s+where public\.home_hero_shown_refusal\(p\.card\) is null/);
    expect(poolPart).not.toMatch(/home_hero_refusal|original_refusal/);
    expect(fallbackPart).toMatch(/from fallback_rows f\s+where public\.home_hero_refusal\(f\.card\) is null/);
    expect(fallbackPart).not.toMatch(/shown_refusal/);
  });

  it("numbers and orders the rows as 0169 did: the pool by added_at then id, then the slots", () => {
    const shown = cte("shown");
    expect(shown).toMatch(/'pool'::text as src,\s+\(row_number\(\) over \(order by p\.added_at, \(p\.card\)\.id\)\)::integer as rn/);
    expect(shown).toMatch(/'fallback'::text as src,\s+f\.slot as rn/);
    expect(body).toMatch(/join public\.profiles p on p\.id = s\.owner_id\s+where p\.username is not null\s+order by case s\.src when 'pool' then 0 else 1 end, s\.rn;?\s*$/);
    // The ten columns, in the declared order.
    expect(body).toMatch(
      /select s\.id, s\.src, s\.rn, s\.slug, s\.title, s\.frame_style,\s+s\.rendered_image_url, s\.rendered_thumb_url, p\.username, p\.display_name/,
    );
  });

  it("reads no card text: the columns it hands out are 0169's", () => {
    const columns = new Set([...body.matchAll(/\((?:p|f)\.card\)\.([a-z_]+)/g)].map((m) => m[1]));
    expect(columns).toEqual(new Set(["id", "owner_id", "slug", "title", "frame_style", "rendered_image_url", "rendered_thumb_url"]));
  });

  it("restates the grants: visitors may call it, PUBLIC may not", () => {
    expect(sql).toMatch(/revoke all on function public\.home_hero_pool\(\) from public;/);
    expect(sql).toMatch(/grant execute on function public\.home_hero_pool\(\) to anon, authenticated, service_role;/);
    expect(sql).not.toMatch(/grant all/i);
  });
});
