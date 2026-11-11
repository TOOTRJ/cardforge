import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 0203_admin_content_stats.sql — the Content tab's function, as text: the
// declared signature, the service role's alone, the admin filter on owners
// and likers (views carry no user), PUBLIC-only top lists (an admin page
// never hands out a private or unlisted title), frame previews never
// counted, the two periods — [p_since, p_until) and the same stretch N UTC
// days earlier, the rest of that earlier day in neither — and the keys the
// page reads. Its results are checked on a real database by the PR's
// Supabase preview.
// ---------------------------------------------------------------------------

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0203_admin_content_stats.sql"), "utf8");
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8");
const SIGNATURE = "public.admin_content_stats(timestamptz, timestamptz, boolean)";

/** One CTE's text: from "<name> as" to the next top-level CTE or the final select. */
function cte(name: string): string {
  const start = code.search(new RegExp(`\\b${name} as (materialized )?\\(`));
  expect(start, `CTE ${name}`).toBeGreaterThan(-1);
  const rest = code.slice(start + 1);
  const next = rest.search(/\n {2}\w+ as (materialized )?\(|\n {2}select jsonb_build_object/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("0203 admin_content_stats", () => {
  it("has the declared signature and is idempotent", () => {
    expect(types).toMatch(/admin_content_stats: \{\s*Args: \{ p_since: string; p_until\?: string; p_include_admins\?: boolean \};\s*Returns: Json;/);
    expect(code).toContain(`drop function if exists ${SIGNATURE};`);
    expect(code).toMatch(
      /create or replace function public\.admin_content_stats\(\s*p_since timestamptz,\s*p_until timestamptz default now\(\),\s*p_include_admins boolean default false\s*\)\s*returns jsonb/,
    );
  });

  it("is a stable SQL function with a fixed empty search_path, every table schema-qualified", () => {
    expect(code).toMatch(/language sql\s+stable\s+security definer\s+set search_path = ''/);
    for (const table of ["cards", "decks", "card_likes", "deck_likes", "card_views", "deck_views", "profiles"]) {
      expect(code).toContain(`public.${table}`);
      expect(code).not.toMatch(new RegExp(`(from|join)\\s+${table}\\b`));
    }
  });

  it("is the service role's alone", () => {
    expect(code).toContain(`revoke all on function ${SIGNATURE} from public, anon, authenticated;`);
    expect(code).toContain(`grant execute on function ${SIGNATURE} to service_role;`);
    expect(code).not.toMatch(/to (anon|authenticated)\b/);
  });

  it("leaves admins out by OWNER for cards and decks and by LIKER for likes, unless asked to include them", () => {
    expect(cte("admins")).toContain("select p.id from public.profiles p where p.is_admin");
    const include = "coalesce(p_include_admins, false) or";
    expect(cte("cards_made")).toContain(`${include} c.owner_id not in (select a.id from admins a)`);
    expect(cte("decks_made")).toContain(`${include} d.owner_id not in (select a.id from admins a)`);
    expect(cte("card_likes_given")).toContain(`${include} l.user_id not in (select a.id from admins a)`);
    expect(cte("deck_likes_given")).toContain(`${include} l.user_id not in (select a.id from admins a)`);
  });

  it("views carry no user: they follow the content that is kept in", () => {
    expect(cte("card_views_seen")).toContain("c.owner_id not in (select a.id from admins a)");
    expect(cte("deck_views_seen")).toContain("d.owner_id not in (select a.id from admins a)");
    expect(code).not.toMatch(/viewer_key/);
    expect(sql).toContain("VIEWS carry no user at all");
  });

  it("never counts an admin's frame preview, whatever the switch says", () => {
    // A condition of its own beside the switch's — never inside its "or".
    const always = /\n\s+and not c\.frame_preview\n\s+and \(coalesce\(p_include_admins, false\) or c\.owner_id not in \(select a\.id from admins a\)\)/;
    expect(cte("cards_made")).toMatch(always);
    expect(cte("card_views_seen")).toMatch(always);
    // In cards_made it follows the period test directly: the three are the whole WHERE.
    expect(cte("cards_made")).toMatch(
      /where \(c\.created_at >= b\.since or c\.created_at < b\.previous_until\)\s+and not c\.frame_preview\s+and \(coalesce\(p_include_admins, false\) or [^\n]+\)\s*\),?\s*$/,
    );
    expect(code.match(/c\.frame_preview/g)).toHaveLength(2);
    expect(code).not.toMatch(/\bor\s+(not\s+)?c\.frame_preview|c\.frame_preview\s+or\b/);
  });

  it("names only PUBLIC cards and decks in its top lists, ten of each, and says why", () => {
    expect(cte("top_cards")).toContain("join public.cards c on c.id = seen.card_id and c.visibility = 'public'");
    expect(cte("top_decks")).toContain("join public.decks d on d.id = seen.deck_id and d.visibility = 'public'");
    expect(cte("top_cards")).toMatch(/limit 10\b/);
    expect(cte("top_decks")).toMatch(/limit 10\b/);
    expect(sql).toContain("WHY PUBLIC ONLY");
    // A title leaves the function through those two lists only.
    expect(code.match(/'title'/g)).toHaveLength(2);
  });

  it("counts the period [p_since, p_until) and the same stretch N UTC days earlier: [p_since − N days, p_until − N days)", () => {
    // What was asked, then the bounds worked out from it — in that order.
    expect(code).toContain("with asked as materialized (");
    expect(code.indexOf("with asked as materialized (")).toBeLessThan(code.indexOf("\n  bounds as materialized ("));
    const asked = cte("asked");
    expect(asked).toContain("p_since as since,");
    expect(asked).toContain("coalesce(p_until, now()) as until,");
    // N = the UTC days the period touches, from its two UTC dates (never
    // under 1) — not its length in seconds rounded up to days.
    expect(asked).toMatch(
      /greatest\(\s*1,\s*\(\(coalesce\(p_until, now\(\)\) at time zone 'utc'\)::date - \(p_since at time zone 'utc'\)::date\) \+ 1\s*\) as n_days/,
    );
    expect(code).not.toContain("extract(epoch");
    // Both ends go back the same N days, in exact seconds: the two periods
    // are exactly as long as each other.
    const bounds = cte("bounds");
    expect(bounds).toContain("r.since - make_interval(secs => 86400.0 * r.n_days) as previous_since,");
    expect(bounds).toContain("r.until - make_interval(secs => 86400.0 * r.n_days) as previous_until");
    expect(bounds).toMatch(/from asked r\s*\)\s*,?\s*$/);
    expect(code).not.toMatch(/interval '\d+ days?'/);

    // Rows are read from the previous period's start to the period's end and
    // marked with the period they belong to — but for the rest of that
    // earlier day, [previous_until, since), which is in neither.
    const stamped = [
      ["cards_made", "c.created_at"],
      ["decks_made", "d.created_at"],
      ["card_likes_given", "l.created_at"],
      ["deck_likes_given", "l.created_at"],
    ];
    const viewed = ["card_views_seen", "deck_views_seen"];
    for (const [name, at] of stamped) {
      expect(cte(name), name).toContain(`${at} >= b.previous_since and ${at} < b.until`);
      expect(cte(name), name).toContain(`(${at} >= b.since) as in_period`);
      expect(cte(name), name).toContain(`where (${at} >= b.since or ${at} < b.previous_until)`);
    }
    // A view belongs to its UTC day; the day counts when its START is in a
    // period (the instants are the exact test, the dates the index's range).
    const dayStart = "(v.day::timestamp at time zone 'utc')";
    for (const name of viewed) {
      expect(cte(name), name).toContain("v.day >= (b.previous_since at time zone 'utc')::date");
      expect(cte(name), name).toContain("v.day <= (b.until at time zone 'utc')::date");
      expect(cte(name), name).toContain(`where ${dayStart} >= b.previous_since`);
      expect(cte(name), name).toContain(`and ${dayStart} < b.until`);
      expect(cte(name), name).toContain(`(${dayStart} >= b.since) as in_period`);
      expect(cte(name), name).toContain(`and (${dayStart} >= b.since or ${dayStart} < b.previous_until)`);
    }
    // "previous" is every row read that is not the period's, so each of the
    // six reads the totals count must drop the gap itself — and does.
    expect(code).toContain("'previous', (select t.numbers from totals t where not t.in_period),");
    const counted = [...cte("totals").matchAll(/from (\w+) x where x\.in_period = w\.in_period/g)].map((m) => m[1]);
    expect([...new Set(counted)].sort()).toEqual([...stamped.map(([name]) => name), ...viewed].sort());
    expect(code.match(/< b\.previous_until\)/g)).toHaveLength(6);
    expect(code).toContain("(x.created_at at time zone 'utc')::date");
    // The header says so in words.
    expect(sql).toContain("[p_since − N days, p_until − N days)");
    expect(sql).toContain("is in neither period");
  });

  it("answers every key the page reads", () => {
    for (const key of ["since", "until", "previousSince", "previousUntil", "current", "previous", "perDay", "topCards", "topDecks"]) {
      expect(code).toContain(`'${key}',`);
    }
    // The four bounds it used, as it worked them out.
    expect(code).toMatch(
      /'since', b\.since,\s+'until', b\.until,\s+'previousSince', b\.previous_since,\s+'previousUntil', b\.previous_until,/,
    );
    for (const key of ["cardsCreated", "cardsPublic", "cardsUnlisted", "cardsPrivate", "decksCreated", "cardLikes", "deckLikes", "cardViews", "deckViews"]) {
      expect(cte("totals")).toContain(`'${key}',`);
    }
    for (const key of ["day", "cardsCreated", "decksCreated", "cardViews"]) {
      expect(code.slice(code.indexOf("'perDay'"), code.indexOf("'topCards'"))).toContain(`'${key}',`);
    }
    for (const key of ["id", "title", "slug", "ownerId", "username", "views"]) {
      expect(code.slice(code.indexOf("'topCards'"), code.indexOf("'topDecks'"))).toContain(`'${key}',`);
      expect(code.slice(code.indexOf("'topDecks'"))).toContain(`'${key}',`);
    }
  });

  it("runs as the migration runner sends it: no transaction or lock statements of its own, nothing written", () => {
    expect(code).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(code).not.toMatch(/\block table\b/i);
    expect(code).not.toMatch(/\b(insert into|update public\.|delete from)\b/i);
  });

  it("says in its header how it ships", () => {
    expect(sql).toContain("Ships through a PR; never");
    expect(sql).toContain("Grants are explicit (0097)");
  });
});
