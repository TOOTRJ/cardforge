import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRENDING_RANGE,
  isTrendingRange,
  TRENDING_RANGE_RULES,
  TRENDING_RANGE_WORDS,
  TRENDING_RANGES,
  TRENDING_WEIGHTS,
  trendingEventWeight,
} from "@/lib/cards/trending";

// ---------------------------------------------------------------------------
// The trending score (migration 0166, list_trending_cards) and the app's
// mirror of it (lib/cards/trending.ts). The SQL is the ONE scorer; its
// behaviour — decay order, the owner's own engagement left out, a comment
// thread counted once per person, private / unlisted / admin cards never
// trending, one card per creator — is proved on the local stack in one
// rolled-back transaction (PR body). What the source must keep:
//   * the mirror's weights, windows and half-lives are the SQL's;
//   * one event per person per card per kind, never the owner's own;
//   * public cards of real creators only (0149's owner_is_creator), one per
//     creator, a deterministic tie order, a clamped limit;
//   * SECURITY INVOKER, an empty search_path, grants stated;
//   * no padding: nothing scores a card without an event (no freshness
//     bonus).
// ---------------------------------------------------------------------------

const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const SQL = strip(
  readFileSync(join(process.cwd(), "supabase/migrations/0166_trending_card_ranges.sql"), "utf8"),
);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const FLAT = squash(SQL);

describe("the trending ranges", () => {
  it("are week, month, year and all time, month by default", () => {
    expect(TRENDING_RANGES).toEqual(["week", "month", "year", "all"]);
    expect(DEFAULT_TRENDING_RANGE).toBe("month");
  });

  it("each prints its own words", () => {
    expect(TRENDING_RANGE_WORDS.month.heading).toBe("Hot this month");
    expect(TRENDING_RANGE_WORDS.week.heading).toBe("Hot this week");
    expect(TRENDING_RANGE_WORDS.all.tab).toBe("All time");
    for (const range of TRENDING_RANGES) {
      const words = TRENDING_RANGE_WORDS[range];
      expect(words.tab && words.heading && words.period && words.empty).toBeTruthy();
    }
  });

  it("only a decayed range says the recent count most; every homepage heading reads as a sentence", () => {
    for (const range of ["week", "month", "year"] as const) {
      expect(TRENDING_RANGE_WORDS[range].description).toMatch(/most recent count most/);
      expect(TRENDING_RANGE_WORDS[range].homeHeading).toBe(`What the community is forging ${TRENDING_RANGE_WORDS[range].period}`);
    }
    expect(TRENDING_RANGE_WORDS.all.description).not.toMatch(/recent/);
    expect(TRENDING_RANGE_WORDS.all.homeHeading).not.toMatch(/forging all time/);
    expect(TRENDING_RANGE_WORDS.all.rankedBy).not.toMatch(/all time's/);
  });

  it("isTrendingRange accepts the four and nothing else", () => {
    for (const range of TRENDING_RANGES) expect(isTrendingRange(range)).toBe(true);
    for (const other of ["day", "", null, undefined, 7, "Month"]) expect(isTrendingRange(other)).toBe(false);
  });
});

describe("trendingEventWeight (the SQL's term)", () => {
  it("weighs a fresh event by its kind: a remix over a like over a commenter", () => {
    expect(trendingEventWeight("like", 0, "month")).toBe(TRENDING_WEIGHTS.like);
    expect(trendingEventWeight("remix", 0, "month")).toBeGreaterThan(trendingEventWeight("like", 0, "month"));
    expect(trendingEventWeight("like", 0, "month")).toBeGreaterThan(trendingEventWeight("comment", 0, "month"));
  });

  it("halves an event's weight every half-life", () => {
    for (const range of ["week", "month", "year"] as const) {
      const half = TRENDING_RANGE_RULES[range].halfLifeDays!;
      expect(trendingEventWeight("like", half, range)).toBeCloseTo(TRENDING_WEIGHTS.like / 2, 10);
      expect(trendingEventWeight("like", 2 * half, range)).toBeCloseTo(TRENDING_WEIGHTS.like / 4, 10);
    }
  });

  it("drops an event past the range's window; all time keeps every event undecayed", () => {
    expect(trendingEventWeight("like", 8, "week")).toBe(0);
    expect(trendingEventWeight("like", 31, "month")).toBe(0);
    expect(trendingEventWeight("like", 366, "year")).toBe(0);
    expect(trendingEventWeight("like", 3000, "all")).toBe(TRENDING_WEIGHTS.like);
  });

  it("a newer like outranks an older one, so a burst today beats the same burst last week", () => {
    expect(trendingEventWeight("like", 1, "week")).toBeGreaterThan(trendingEventWeight("like", 5, "week"));
  });
});

describe("migration 0166 — list_trending_cards", () => {
  it("holds the mirror's weights", () => {
    expect(FLAT).toContain(
      `case e.kind when 'like' then ${TRENDING_WEIGHTS.like}.0 when 'comment' then ${TRENDING_WEIGHTS.comment}.0 else ${TRENDING_WEIGHTS.remix}.0 end`,
    );
  });

  it("holds the mirror's windows and half-lives; anything unknown reads as month", () => {
    expect(FLAT).toContain(
      `when 'week' then now() - interval '${TRENDING_RANGE_RULES.week.windowDays} days' ` +
        `when 'year' then now() - interval '${TRENDING_RANGE_RULES.year.windowDays} days' ` +
        `when 'all' then '-infinity'::timestamptz ` +
        `else now() - interval '${TRENDING_RANGE_RULES.month.windowDays} days'`,
    );
    expect(FLAT).toContain(
      `when 'week' then ${TRENDING_RANGE_RULES.week.halfLifeDays}.0 ` +
        `when 'year' then ${TRENDING_RANGE_RULES.year.halfLifeDays}.0 ` +
        `when 'all' then null else ${TRENDING_RANGE_RULES.month.halfLifeDays}.0`,
    );
    expect(TRENDING_RANGE_RULES.all).toEqual({ windowDays: null, halfLifeDays: null });
    expect(FLAT).toContain("power(0.5, greatest(extract(epoch from (now() - e.at)), 0) / 86400.0 / cfg.half_life_days)");
  });

  it("counts one event per person per card per kind, never the owner's own", () => {
    // A like is one row per liker (card_likes' unique key); a commenter and
    // a remixer are grouped to one event each.
    expect(FLAT).toMatch(/from public\.card_comments cm, cfg where cm\.created_at >= cfg\.since group by cm\.card_id, cm\.author_id/);
    expect(FLAT).toMatch(
      /from public\.cards r, cfg where r\.parent_card_id is not null and r\.created_at >= cfg\.since and r\.visibility in \('public', 'unlisted'\) group by r\.parent_card_id, r\.owner_id/,
    );
    expect(FLAT).toContain("and e.actor <> c.owner_id");
  });

  it("ranks public cards of real creators only, one per creator, in a deterministic order", () => {
    expect(FLAT).toContain("where c.visibility = 'public'");
    expect(FLAT).toContain("where public.owner_is_creator(s.owner_id)");
    expect(FLAT).toContain("partition by s.owner_id");
    expect(FLAT).toContain("where b.creator_rank = 1");
    expect(FLAT).toContain(
      "order by b.score desc, b.people desc, b.likes_count desc, b.created_at desc, b.id",
    );
    expect(FLAT).toContain("limit least(greatest(coalesce(p_limit, 6), 1), 24)");
  });

  it("pads nothing: the score is a sum over events (no freshness bonus)", () => {
    expect(FLAT).toContain("from events e join public.cards c on c.id = e.card_id");
    expect(FLAT).not.toMatch(/fresh/i);
  });

  it("is SECURITY INVOKER with an empty search_path, and states its grants", () => {
    expect(FLAT).toMatch(/language sql stable security invoker set search_path = ''/);
    expect(FLAT).toContain("revoke all on function public.list_trending_cards(text, integer) from public;");
    expect(FLAT).toContain(
      "grant execute on function public.list_trending_cards(text, integer) to anon, authenticated, service_role;",
    );
  });
});
