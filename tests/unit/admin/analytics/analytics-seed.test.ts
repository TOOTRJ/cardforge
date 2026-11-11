import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// supabase/seeds/54_admin_analytics.sql — the rows that make every tab of
// /admin/analytics draw on a preview branch, the dev database and the local
// stack — as text. It runs behind the real-users guard and holds no
// credential; its tool events are events the tools really record (so the
// Tools tab reads them as uses, failures and steps, and "Why things failed"
// as codes); and what its tools' AI COST is in the credit ledger — settled,
// keyed, one charge refunded — never in an event's `credits`. A re-run adds
// nothing.
// ---------------------------------------------------------------------------

vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));

import { CREDIT_REASON_TOOLS } from "@/lib/admin/analytics/credits";
import { TOOL_CATALOG, TOOL_CLIENT_EVENTS, TOOL_USE_EVENTS, toolEventIsFailure, type ToolSlug } from "@/lib/tools/catalog";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const filesUnder = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(ROOT, path)).isDirectory() ? filesUnder(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

const seed = read("supabase/seeds/54_admin_analytics.sql");
/** The statements alone: a comment may name what the SQL must never do. */
const code = seed
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");
const text = squash(code);

/** Where each seeded tool's own code lives — where an event of it is recorded. */
const TOOL_CODE: Partial<Record<ToolSlug, string[]>> = {
  "collection-builder": ["app/api/tools/collection-builder", "lib/tools/collection", "components/tools/collection"],
  "token-kit": ["app/api/tools/token-kit", "lib/tools/token-kit", "components/tools/token-kit"],
  "rule0-sheet": ["app/api/tools/rule0-sheet", "lib/tools/rule0", "components/tools/rule0", "app/(marketing)/deck/[slug]/table-sheet"],
  "re-art-deck": ["lib/tools/re-art", "components/tools/re-art"],
};

const HOURS: Record<string, number> = { hour: 1, hours: 1, day: 24, days: 24 };
/** `interval '9 days'` as hours. */
function hoursOf(interval: string): number {
  const [, n, unit] = /^(\d+) (hours?|days?)$/.exec(interval) ?? [];
  expect(unit, `an interval of whole hours or days: “${interval}”`).toBeTruthy();
  return Number(n) * HOURS[unit];
}

type SeededEvent = { slug: string; userId: string | null; event: string; access: string | null; props: Record<string, unknown>; ageHours: number };

/** The rows of the tool_events insert. */
const events: SeededEvent[] = [
  ...code.matchAll(
    /^\s*\('([a-z0-9-]+)',\s+(?:'([0-9a-f-]{36})'::uuid|null::uuid),\s+'([a-z0-9_]+)',\s+(?:'([a-z]+)'|null::text),\s+'(\{.*\})'::jsonb,\s+interval '([^']+)'\),?\s*$/gm,
  ),
].map((m) => ({
  slug: m[1],
  userId: m[2] ?? null,
  event: m[3],
  access: m[4] ?? null,
  props: JSON.parse(m[5]) as Record<string, unknown>,
  ageHours: hoursOf(m[6]),
}));

type LedgerRow = { userId: string; delta: number; reason: string; key: string; ageHours: number };

/** The rows of the credit_ledger insert. */
const ledger: LedgerRow[] = [
  ...code.matchAll(/^\s*\('([0-9a-f-]{36})'::uuid,\s+(-?\d+),\s+'([a-z_]+)',\s+'([^']+)',\s+interval '([^']+)'\),?\s*$/gm),
].map((m) => ({ userId: m[1], delta: Number(m[2]), reason: m[3], key: m[4], ageHours: hoursOf(m[5]) }));

describe("54_admin_analytics.sql — never against production, no credential", () => {
  it("refuses a database with real users before it writes anything", () => {
    const guard = /do \$guard\$([\s\S]*?)\$guard\$;/.exec(code);
    expect(guard, "the real-users guard block").not.toBeNull();
    const body = squash(guard![1]);
    expect(body).toContain(
      "if (select count(*) from auth.users where email not like '%@dev.pipglyph.test' and email not like '%@pipglyph.test') > 25 then",
    );
    expect(body).toContain("raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';");
    // the guard is the first statement: nothing is written before it
    const firstWrite = code.search(/\b(insert into|delete from|update |truncate|alter |drop )/i);
    expect(firstWrite).toBeGreaterThan(guard!.index + guard![0].length);
    expect(squash(code.slice(0, guard!.index))).toBe("");
  });

  it("holds no email, password or key — accounts are the seeded ids alone", () => {
    // whole file, comments included
    expect(seed).not.toMatch(/[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+/i);
    expect(seed).not.toMatch(/\bpassword\b|\bpasswd\b|\bsecret\b|api[_-]?key|service_role|\btoken\s*[:=]/i);
    // nothing shaped like a key: a JWT, a Supabase or Stripe key, a long opaque string
    expect(seed).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|sb_(secret|publishable)_|sk_(live|test)_|pk_(live|test)_|whsec_/);
    expect(seed).not.toMatch(/['"][A-Za-z0-9+/_-]{40,}['"]/);
    // every account named is one of the synthetic dev accounts (10_dev_data.sql)
    const ids = [...new Set([...seed.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)].map((m) => m[0]))];
    expect(ids.length).toBeGreaterThan(0);
    const devData = read("supabase/seeds/10_dev_data.sql");
    for (const id of ids) {
      expect(id, id).toMatch(/^d0000000-0000-4000-a000-00000000000\d$/);
      expect(devData, `${id} is seeded by 10_dev_data.sql`).toContain(id);
    }
  });

  it("writes only its three tables, and removes only its own marked tool events", () => {
    const inserts = [...code.matchAll(/insert into public\.(\w+)/g)].map((m) => m[1]);
    expect(inserts).toEqual(["tool_events", "card_views", "credit_ledger"]);
    expect([...code.matchAll(/delete from public\.(\w+)/g)].map((m) => m[1])).toEqual(["tool_events"]);
    expect(code).not.toMatch(/\b(truncate|drop |alter |update public\.)/i);
  });
});

describe("54_admin_analytics.sql — tool events the tools really record", () => {
  it("seeds events for four tools, from testers and visitors — never on the admin path", () => {
    expect(events).toHaveLength(21);
    // every row of the insert's VALUES was read
    const values = /insert into public\.tool_events[\s\S]*?from \(values([\s\S]*?)\) as v \(tool_slug, user_id, event, access, props, ago\)/.exec(code)?.[1] ?? "";
    expect(values.split("\n").filter((line) => line.trim().startsWith("(")).length).toBe(events.length);

    const slugs = TOOL_CATALOG.map((tool) => tool.slug as string);
    for (const row of events) expect(slugs, row.slug).toContain(row.slug);
    expect([...new Set(events.map((row) => row.slug))].sort()).toEqual(Object.keys(TOOL_CODE).sort());
    // with "Include admins" off the tab still shows people
    for (const row of events) expect(row.access, `${row.slug}/${row.event}`).not.toBe("admin");
    expect([...new Set(events.map((row) => row.access))].sort()).toEqual(["grant", "release", null].sort());
    // an event with no account is a visitor's view of a shared sheet, with no way in
    const visitors = events.filter((row) => row.userId === null);
    expect(visitors.length).toBeGreaterThan(0);
    for (const row of visitors) expect([row.slug, row.event, row.access]).toEqual(["rule0-sheet", "shared_view", null]);
    for (const row of events.filter((r) => r.userId !== null)) expect(row.access, `${row.slug}/${row.event}`).not.toBeNull();
  });

  it.each(events.map((row) => [row.slug, row.event] as const).filter(([slug, event], i, all) => all.findIndex(([s, e]) => s === slug && e === event) === i))(
    "%s / %s is the visit, a use, a failure, a browser event or a step that tool's code records",
    (slug, event) => {
      const tool = slug as ToolSlug;
      const known =
        event === "open" || TOOL_USE_EVENTS[tool].includes(event) || toolEventIsFailure(event) || TOOL_CLIENT_EVENTS[tool].includes(event);
      if (known) return;
      // A step on the way: the name is a literal in that tool's own code.
      const roots = TOOL_CODE[tool];
      expect(roots, `where ${slug}'s code lives`).toBeTruthy();
      const recorders = roots!.flatMap(filesUnder).filter((path) => read(path).includes(`"${event}"`));
      expect(recorders.length, `a file of ${slug} that records "${event}"`).toBeGreaterThan(0);
    },
  );

  it("shows every kind the tab draws: visits, uses, failures and steps", () => {
    const kinds = new Set(
      events.map((row) =>
        row.event === "open" ? "open" : toolEventIsFailure(row.event) ? "failure" : TOOL_USE_EVENTS[row.slug as ToolSlug].includes(row.event) ? "use" : "step",
      ),
    );
    expect([...kinds].sort()).toEqual(["failure", "open", "step", "use"]);
  });

  it("every failure carries a reason that 0204 reads as a code — never `other`", () => {
    const rule = /ev\.props ->> 'reason' ~ '([^']+)'/.exec(squash(read("supabase/migrations/0204_admin_tool_analytics.sql")))?.[1];
    expect(rule).toBe("^[a-z][a-z0-9_]{0,39}$");
    const failures = events.filter((row) => toolEventIsFailure(row.event));
    expect(failures.length).toBeGreaterThanOrEqual(4);
    for (const row of failures) {
      expect(typeof row.props.reason, `${row.slug}/${row.event}`).toBe("string");
      expect(row.props.reason as string, `${row.slug}/${row.event}`).toMatch(new RegExp(rule!));
    }
    // and only a failure says why
    for (const row of events.filter((r) => !toolEventIsFailure(r.event))) expect(row.props, `${row.slug}/${row.event}`).not.toHaveProperty("reason");
  });

  it("a browser's event holds what the recorder keeps: codes for strings, `credits_seen` — never `credits`", () => {
    const source = read("lib/tools/client-events.ts");
    const browserCode = new RegExp(/export const BROWSER_CODE_RE = \/(.+)\/;/.exec(source)![1]);
    const fromBrowser = events.filter((row) => TOOL_CLIENT_EVENTS[row.slug as ToolSlug].includes(row.event));
    expect(fromBrowser.length).toBeGreaterThan(0);
    for (const row of fromBrowser) {
      expect(row.props, `${row.slug}/${row.event}`).not.toHaveProperty("credits");
      for (const [key, value] of Object.entries(row.props)) {
        if (typeof value === "string") expect(value, `${row.slug}/${row.event}.${key}`).toMatch(browserCode);
      }
    }
    // what a run's own page watched go is `credits_seen`, and only a browser says it
    const seen = events.filter((row) => "credits_seen" in row.props);
    expect(seen.map((row) => [row.slug, row.event])).toEqual([["re-art-deck", "run_finished"]]);
    for (const row of seen) expect(TOOL_CLIENT_EVENTS[row.slug as ToolSlug]).toContain(row.event);
  });

  it("marks its rows, and a re-run replaces them only once the last batch is three weeks old", () => {
    expect(text).toContain("select v.tool_slug, v.user_id, v.event, v.access, v.props || jsonb_build_object('seed', 'analytics'), now() - v.ago");
    // the delete touches marked rows alone, and only when none is newer than 21 days
    expect(text).toContain(
      "delete from public.tool_events t where t.props ->> 'seed' = 'analytics' and not exists ( select 1 from public.tool_events n where n.props ->> 'seed' = 'analytics' and n.created_at > now() - interval '21 days' );",
    );
    // the insert runs only when no marked row is left: never a second batch beside the first
    expect(text).toContain("and not exists ( select 1 from public.tool_events t where t.props ->> 'seed' = 'analytics' );");
    // a missing account is skipped; a visitor's row has none to miss
    expect(text).toContain("where (v.user_id is null or exists (select 1 from public.profiles p where p.id = v.user_id))");
    // a fresh batch is well inside the three weeks (it is not replaced by the next run)
    for (const row of events) expect(row.ageHours, `${row.slug}/${row.event}`).toBeLessThan(21 * 24);
    // …and inside the tab's shortest period, so the 7-day view is not empty
    expect(Math.min(...events.map((row) => row.ageHours))).toBeLessThan(7 * 24);
  });
});

describe("54_admin_analytics.sql — what the tools' AI cost is the ledger's", () => {
  const spends = ledger.filter((row) => row.delta < 0);
  const refunds = ledger.filter((row) => row.delta > 0);

  it("seeds four charges and one refund, each under a key of its own", () => {
    expect(ledger).toHaveLength(5);
    const values = /insert into public\.credit_ledger[\s\S]*?from \(values([\s\S]*?)\) as v \(user_id, delta, reason, key, ago\)/.exec(code)?.[1] ?? "";
    expect(values.split("\n").filter((line) => line.trim().startsWith("(")).length).toBe(ledger.length);

    expect(spends.map((row) => row.key)).toEqual(["seed-analytics:spend:1", "seed-analytics:spend:2", "seed-analytics:spend:3", "seed-analytics:spend:4"]);
    expect(new Set(ledger.map((row) => row.key)).size).toBe(ledger.length);
    // written as the row's idempotency key, and a key already there is skipped: a re-run adds nothing
    expect(text).toContain("insert into public.credit_ledger (user_id, delta, reason, balance_after, idempotency_key, created_at, settled_at)");
    expect(text).toContain("and not exists (select 1 from public.credit_ledger l where l.idempotency_key = v.key);");
    expect(text).toContain("where exists (select 1 from auth.users u where u.id = v.user_id)");
  });

  it("every charge is SETTLED — the reconcile sweep hands back an aged unsettled spend", () => {
    // settled_at is stamped on every row that takes credits (and on no other)
    expect(text).toContain("now() - v.ago, case when v.delta < 0 then now() - v.ago end from (values");
    expect(spends.length).toBe(4);
    for (const row of spends) expect(row.delta, row.key).toBeLessThan(0);
  });

  it("one charge is refunded: the refund names its charge's key, for the same account and the whole amount", () => {
    expect(refunds).toHaveLength(1);
    const [refund] = refunds;
    expect(refund.reason).toBe("refund");
    expect(refund.key).toBe("refund:seed-analytics:spend:2");
    const charge = spends.find((row) => `refund:${row.key}` === refund.key);
    expect(charge, "the charge the refund gives back").toBeTruthy();
    expect(refund.userId).toBe(charge!.userId);
    expect(refund.delta).toBe(-charge!.delta);
    // given back when it was charged
    expect(refund.ageHours).toBe(charge!.ageHours);
  });

  it("every charge is under a tool's own spend reason, for an account with seeded events of that tool", () => {
    for (const row of spends) {
      const tool = CREDIT_REASON_TOOLS[row.reason];
      expect(tool, `${row.reason} is a tool's spend reason (CREDIT_REASON_TOOLS)`).toBeTruthy();
      expect(
        events.some((event) => event.slug === tool && event.userId === row.userId),
        `${row.key}: an event of ${tool} by the account charged`,
      ).toBe(true);
    }
    // more than one tool has a cost, so "Credits spent" differs by row
    expect(new Set(spends.map((row) => CREDIT_REASON_TOOLS[row.reason])).size).toBeGreaterThanOrEqual(2);
  });
});

describe("54_admin_analytics.sql — card page views", () => {
  it("adds two weeks of views to public cards only, and only for a card with none in the last 14 days", () => {
    expect(text).toContain("insert into public.card_views (card_id, day, viewer_key)");
    expect(text).toContain("from public.cards where visibility = 'public'");
    // 14 UTC days, today included
    expect(text).toContain("select ((now() at time zone 'utc')::date - g) as day, g from generate_series(0, 13) as g");
    // a card that already has a view in those days is left alone: a re-run on any later day does not grow
    expect(text).toContain(
      "where not exists ( select 1 from public.card_views seen where seen.card_id = c.id and seen.day >= (now() at time zone 'utc')::date - 13 ) on conflict do nothing;",
    );
  });

  it("a viewer key is 32 hex digits, as the table's CHECK asks", () => {
    expect(text).toContain("md5(c.id::text || ':' || d.day::text || ':' || v.n::text)");
    expect(read("supabase/migrations/0168_card_views_and_like_standing.sql")).toContain("check (viewer_key ~ '^[0-9a-f]{32}$')");
  });
});
