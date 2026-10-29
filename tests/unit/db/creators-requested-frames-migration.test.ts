import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REQUESTED_FRAMES_MAX_KEYS,
  REQUESTED_FRAMES_MIN_PEOPLE,
  answeredSignaturePairs,
  publicSignatures,
} from "@/lib/frames/requested-frames";

// ---------------------------------------------------------------------------
// Migration 0148 (TODO NV11 / NV12 part 1) as text. Who /creators lists and
// what /frames/requested may publish are decided in SQL, so the rules are
// held here: the creators function counts PUBLIC cards and non-empty PUBLIC
// decks only and never lists an admin (checked once per maker); the
// requested-frames function reads the admin-only log as a definer with an
// empty search_path, returns a signature and a count only, echoes only the
// caller's own signatures, drops admins and answered pairs, counts only rows
// from before today's UTC midnight, publishes a frame only from k people on
// (the app's REQUESTED_FRAMES_MIN_PEOPLE) and caps its arrays (the app's
// REQUESTED_FRAMES_MAX_KEYS). Both are public reads, never PUBLIC, and the
// table itself stays closed to the API roles. Applied for real by the PR's
// Supabase preview branch and the CI e2e stack; the PR body carries the
// local transaction proof.
// ---------------------------------------------------------------------------

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/0148_creators_and_requested_frames.sql"),
  "utf8",
);
const body = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .replace(/\s+/g, " ")
  .toLowerCase();

const CREATORS_SIG = "public.list_public_creators(text, integer, integer)";
const FRAMES_SIG = "public.requested_frame_counts(text[], text[])";

const fnBody = (name: string) => {
  const start = body.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return body.slice(start, body.indexOf("$$;", start));
};

/** The integer a `name constant integer := N;` declaration holds. */
const constant = (fn: string, name: string) => {
  const match = fn.match(new RegExp(`${name} constant integer := (\\d+);`));
  return match ? Number(match[1]) : null;
};

describe("0148_creators_and_requested_frames.sql", () => {
  it("only reads: no table, no write, no grant all", () => {
    expect(body).not.toMatch(/create table|alter table|insert into|update public\.|delete from|grant all/);
  });

  it("states both functions' grants: public reads, never PUBLIC", () => {
    for (const sig of [CREATORS_SIG, FRAMES_SIG]) {
      expect(body).toContain(`revoke all on function ${sig} from public;`);
      expect(body).toContain(`grant execute on function ${sig} to anon, authenticated, service_role;`);
    }
    // The log itself is untouched: no grant on frame_requests.
    expect(body).not.toMatch(/on (table )?public\.frame_requests/);
  });

  describe("list_public_creators", () => {
    const fn = fnBody("list_public_creators");

    it("runs as the caller with an empty search_path", () => {
      expect(fn).toMatch(/stable security invoker set search_path = ''/);
    });

    it("lists makers by their PUBLIC cards and never an admin (0091), checked once per maker", () => {
      expect(fn).toMatch(/from public\.cards c where c\.visibility = 'public' group by c\.owner_id/);
      expect(fn).toContain("not public.owner_is_admin(m.owner_id)");
      // Materialized: an inlined CTE lets the planner push the admin filter
      // below the GROUP BY — one owner_is_admin() call per public card.
      expect(fn).toContain("with makers as materialized (");
      // A maker comes from the public-card aggregate alone — no zero-card row.
      expect(fn).not.toMatch(/left join public\.cards/);
    });

    it("counts only public decks that hold a card (0108's rule), and strips public cards only", () => {
      expect(fn).toMatch(
        /from public\.decks d where d\.owner_id = pg\.owner_id and d\.visibility = 'public' and exists \(select 1 from public\.deck_cards dc where dc\.deck_id = d\.id\)/,
      );
      expect(fn).toMatch(/array\( select c\.id from public\.cards c where c\.owner_id = pg\.owner_id and c\.visibility = 'public' order by c\.created_at desc, c\.id limit 3 \)/);
      expect(fn).not.toContain("unlisted");
    });

    it("clamps paging and sorts by the three orders", () => {
      expect(fn).toContain("limit greatest(1, least(coalesce(p_limit, 24), 60))");
      expect(fn).toContain("offset greatest(0, coalesce(p_offset, 0))");
      expect(fn).toContain("case when p_sort = 'recent' then m.last_card_at end desc");
      expect(fn).toContain("case when p_sort = 'liked' then m.likes end desc");
    });

    it("returns profile columns anon may read anyway — never is_admin or billing", () => {
      const returns = fn.slice(fn.indexOf("returns table"), fn.indexOf("language sql"));
      expect(returns).toContain("username text");
      expect(returns).not.toMatch(/is_admin|subscription|stripe|credits|email/);
    });
  });

  describe("requested_frame_counts", () => {
    const fn = fnBody("requested_frame_counts");

    it("reads the admin-only log as a definer with an empty search_path", () => {
      expect(fn).toMatch(/language plpgsql stable security definer set search_path = ''/);
      expect(fn).toContain("from public.frame_requests r");
    });

    it("returns a signature and a count — no cause, template, date or user", () => {
      const returns = fn.slice(fn.indexOf("returns table"), fn.indexOf("language plpgsql"));
      expect(returns).toBe("returns table ( signature text, people bigint ) ");
      // The select list: the only place a row's user appears is inside the count.
      const start = fn.indexOf("return query select") + "return query select".length;
      const list = fn.slice(start, fn.indexOf("from public.frame_requests"));
      expect(list.trim()).toBe("r.signature, count(distinct r.user_id)::bigint");
      expect(fn).not.toMatch(/latest_cause|r\.cause|array_agg/);
    });

    it("echoes only the caller's own signatures, never an admin's rows, never an answered pair", () => {
      expect(fn).toContain("r.signature = any(coalesce(p_signatures, '{}'::text[]))");
      expect(fn).toContain("join public.profiles p on p.id = r.user_id");
      expect(fn).toContain("not p.is_admin");
      expect(fn).toContain(
        "(r.signature || '|' || coalesce(r.template, '')) <> all(coalesce(p_answered, '{}'::text[]))",
      );
    });

    it("can't be watched live: the window ends at today's UTC midnight and is no parameter", () => {
      expect(fn).toContain(
        "window_end constant timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';",
      );
      expect(fn).toContain("r.created_at >= window_end - interval '180 days' and r.created_at < window_end");
      expect(fn).not.toMatch(/p_since|p_window|p_[a-z_]+ timestamptz/);
      // now() appears only inside the midnight.
      expect(fn.match(/now\(\)/g)).toHaveLength(1);
    });

    it("publishes a frame only from k people on — the app's REQUESTED_FRAMES_MIN_PEOPLE", () => {
      expect(constant(fn, "min_people")).toBe(REQUESTED_FRAMES_MIN_PEOPLE);
      expect(REQUESTED_FRAMES_MIN_PEOPLE).toBeGreaterThanOrEqual(2);
      expect(fn).toContain("having count(distinct r.user_id) >= min_people");
    });

    it("refuses arrays past the cap, and the app stays under it", () => {
      expect(constant(fn, "max_keys")).toBe(REQUESTED_FRAMES_MAX_KEYS);
      expect(fn).toContain(
        "if coalesce(cardinality(p_signatures), 0) > max_keys or coalesce(cardinality(p_answered), 0) > max_keys then raise exception",
      );
      expect(publicSignatures().length).toBeLessThanOrEqual(REQUESTED_FRAMES_MAX_KEYS);
      expect(answeredSignaturePairs().length).toBeLessThanOrEqual(REQUESTED_FRAMES_MAX_KEYS);
    });
  });
});
