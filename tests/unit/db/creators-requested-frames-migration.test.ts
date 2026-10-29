import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0147 (TODO NV11 / NV12 part 1) as text. Who /creators lists and
// what /frames/requested may publish are decided in SQL, so the rules are
// held here: the creators function counts PUBLIC cards and non-empty PUBLIC
// decks only and never lists an admin; the requested-frames function reads
// the admin-only log as a definer with an empty search_path, returns three
// aggregate columns, echoes only the caller's own signatures, drops admins
// and answered pairs, and fixes its window. Both are public reads, never
// PUBLIC, and the table itself stays closed to the API roles. Applied for
// real by the PR's Supabase preview branch and the CI e2e stack; the PR
// body carries the local transaction proof.
// ---------------------------------------------------------------------------

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/0147_creators_and_requested_frames.sql"),
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

describe("0147_creators_and_requested_frames.sql", () => {
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

    it("lists makers by their PUBLIC cards and never an admin (0091)", () => {
      expect(fn).toMatch(/from public\.cards c where c\.visibility = 'public' group by c\.owner_id/);
      expect(fn).toContain("not public.owner_is_admin(m.owner_id)");
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
      expect(fn).toMatch(/stable security definer set search_path = ''/);
      expect(fn).toContain("from public.frame_requests r");
    });

    it("returns three aggregate columns and no identifying one", () => {
      const returns = fn.slice(fn.indexOf("returns table"), fn.indexOf("language sql"));
      expect(returns).toBe("returns table ( signature text, people bigint, latest_cause text ) ");
      // The select list: the signature, a distinct count and the latest cause —
      // the only places a row's user or date appear are inside the aggregates.
      const list = fn.slice(fn.indexOf("as $$ select") + "as $$ select".length, fn.indexOf("from public.frame_requests"));
      expect(list.trim()).toBe(
        "r.signature, count(distinct r.user_id)::bigint as people, (array_agg(r.cause order by r.created_at desc))[1] as latest_cause",
      );
    });

    it("echoes only the caller's own signatures, never an admin's rows, never an answered pair", () => {
      expect(fn).toContain("r.signature = any(coalesce(p_signatures, '{}'::text[]))");
      expect(fn).toContain("join public.profiles p on p.id = r.user_id");
      expect(fn).toContain("not p.is_admin");
      expect(fn).toContain("(r.signature || '|' || coalesce(r.template, '')) <> all(coalesce(p_answered, '{}'::text[]))");
    });

    it("fixes its window in the body — not a parameter a caller could narrow", () => {
      expect(fn).toContain("r.created_at >= now() - interval '180 days'");
      expect(fn).not.toMatch(/p_since|p_window|timestamptz\s*(,|\))/);
    });
  });
});
