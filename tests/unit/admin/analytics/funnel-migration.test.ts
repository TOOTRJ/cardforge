import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COHORT_STEPS } from "@/lib/admin/funnel-queries";

// ---------------------------------------------------------------------------
// Migration 0200 (the 2026-11 analytics audit): the funnel's counts take a
// PERIOD, each trial is measured over its own length, and two new reads —
// the cohort (the people who signed up in the period, followed) and the
// signups per day. The text is held to the contracts in types/supabase.ts
// and to the house rules for an admin read.
// ---------------------------------------------------------------------------

const sql = readFileSync("supabase/migrations/0200_admin_funnel_periods.sql", "utf8");
const statements = sql.replace(/^--.*$/gm, "");
const types = readFileSync("types/supabase.ts", "utf8");

/** A function's text from `create or replace` to the end of its body. */
const fn = (name: string) => {
  const start = statements.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = statements.indexOf("as $$", start);
  return statements.slice(start, statements.indexOf("$$;", open + 5));
};
/** …and its body alone. */
const body = (name: string) => fn(name).slice(fn(name).indexOf("as $$") + 5);

const FUNCTIONS = {
  admin_funnel_counts: {
    args: "p_since timestamptz,\n  p_include_admins boolean default false,\n  p_until timestamptz default null",
    signature: "timestamptz, boolean, timestamptz",
    returns: "returns table (event text, n bigint, users bigint)",
  },
  admin_trial_engagement: {
    args: "p_since timestamptz,\n  p_include_admins boolean default false,\n  p_until timestamptz default null",
    signature: "timestamptz, boolean, timestamptz",
    returns:
      "returns table (\n  user_id uuid,\n  username text,\n  started_at timestamptz,\n  ended_at timestamptz,\n  window_days integer,\n  outcome text,\n  active_days integer,\n  saves integer,\n  generations integer,\n  downloads integer\n)",
  },
  admin_funnel_cohort: {
    args: "p_since timestamptz,\n  p_until timestamptz default now(),\n  p_include_admins boolean default false",
    signature: "timestamptz, timestamptz, boolean",
    returns: "returns table (step text, users bigint)",
  },
  admin_signups_daily: {
    args: "p_since timestamptz,\n  p_until timestamptz default now(),\n  p_include_admins boolean default false",
    signature: "timestamptz, timestamptz, boolean",
    returns: "returns table (day date, method text, n bigint)",
  },
} as const;

describe("0200_admin_funnel_periods", () => {
  it.each(Object.entries(FUNCTIONS))("%s has the contract's arguments and columns, and is the service role's alone", (name, spec) => {
    const text = fn(name);
    expect(text).toContain(`public.${name}(\n  ${spec.args}\n)`);
    expect(text).toContain(spec.returns);
    expect(text).toMatch(/language sql\s+stable\s+security definer\s+set search_path = ''\s+as \$\$/);
    expect(statements).toContain(`revoke all on function public.${name}(${spec.signature}) from public, anon, authenticated;`);
    expect(statements).toContain(`grant execute on function public.${name}(${spec.signature}) to service_role;`);
    // The app's types name the same arguments.
    const declared = types.slice(types.indexOf(`      ${name}: {`), types.indexOf("Returns:", types.indexOf(`      ${name}: {`)));
    for (const arg of ["p_since", "p_until", "p_include_admins"]) expect(declared).toContain(arg);
  });

  it.each(["admin_funnel_counts", "admin_trial_engagement"])("%s: the two-argument signature goes first, so one name never resolves two ways", (name) => {
    const drop = statements.indexOf(`drop function if exists public.${name}(timestamptz, boolean);`);
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(statements.indexOf(`create or replace function public.${name}(`));
    // One definition of each name in the file.
    expect(statements.split(`create or replace function public.${name}(`).length - 1).toBe(1);
  });

  it.each(Object.keys(FUNCTIONS))("%s leaves the team's own accounts out unless asked", (name) => {
    expect(body(name)).toMatch(/p_include_admins\s+(or e\.user_id is null\s+)?or e\.user_id not in \(select p\.id from public\.profiles p where p\.is_admin\)/);
  });

  it("a row with no user — an anonymous step, a deleted account — is never an admin's, where rows are counted", () => {
    for (const name of ["admin_funnel_counts", "admin_signups_daily"]) {
      expect(body(name)).toMatch(/p_include_admins\s+or e\.user_id is null\s+or e\.user_id not in/);
    }
  });

  it("the period is [p_since, p_until): the end is open, and a call that names no end has none (or now)", () => {
    for (const name of ["admin_funnel_counts", "admin_trial_engagement"]) {
      expect(body(name)).toContain("e.created_at >= p_since");
      expect(body(name)).toContain("(p_until is null or e.created_at < p_until)");
    }
    for (const name of ["admin_funnel_cohort", "admin_signups_daily"]) {
      expect(body(name)).toMatch(/e\.created_at >= p_since\s+and e\.created_at < p_until/);
    }
    expect(statements).not.toMatch(/created_at <= p_until|between p_since/);
  });

  it("the counts keep 0197's shape: events and distinct users per event", () => {
    const text = body("admin_funnel_counts");
    expect(text).toMatch(/count\(\*\)::bigint as n,\s+count\(distinct e\.user_id\)::bigint as users/);
    expect(text).toContain("group by e.event");
  });

  describe("admin_trial_engagement", () => {
    const text = body("admin_trial_engagement");

    it("lists the trials STARTED in the period, newest first, 200 at most", () => {
      expect(text).toMatch(/where e\.event = 'trial_started'\s+and e\.user_id is not null\s+and e\.created_at >= p_since/);
      expect(text).toMatch(/order by e\.created_at desc, e\.id desc\s+limit 200/);
      expect(text).toMatch(/order by m\.started_at desc, m\.id desc\s*$/);
    });

    it("a trial's end is its LATEST converted / lapsed row, matched on the subscription id", () => {
      expect(text).toMatch(
        /where f\.event in \('trial_converted', 'trial_lapsed'\)\s+and f\.props ->> 'subscriptionId' = t\.sub_id\s+order by f\.created_at desc\s+limit 1/,
      );
      expect(text).toContain("o.created_at as ended_at");
    });

    it("measures each trial over its own length — start to its end (now while it runs), 60 days at most — never a fixed 7 days", () => {
      expect(text).toMatch(/least\(coalesce\(d\.ended_at, now\(\)\), d\.started_at \+ interval '60 days'\)/);
      expect(text).not.toContain("interval '7 days'");
      // Whole days, at least 1.
      expect(text).toMatch(/greatest\(1, round\(extract\(epoch from \(m\.window_end - m\.started_at\)\) \/ 86400\.0\)::integer\) as window_days/);
    });

    it("counts the activity inside that window and nowhere else — not clipped to the period's start", () => {
      const activity = text.slice(text.indexOf("cross join lateral ("), text.indexOf(") a\n"));
      expect(activity).toMatch(/where f\.user_id = m\.user_id\s+and f\.event in \('card_saved', 'ai_generation', 'download'\)\s+and f\.created_at >= m\.started_at\s+and f\.created_at <= m\.window_end/);
      expect(activity).not.toMatch(/p_since|p_until/);
      // Active days are UTC days.
      expect(activity).toContain("count(distinct (f.created_at at time zone 'utc')::date)::integer as active_days");
    });

    it("an end that was never recorded is 'ongoing' for 60 days and 'unknown' after", () => {
      expect(text).toMatch(/coalesce\(\s+m\.end_event,\s+case when m\.started_at \+ interval '60 days' > now\(\) then 'ongoing' else 'unknown' end\s+\) as outcome/);
    });
  });

  describe("admin_funnel_cohort", () => {
    const text = body("admin_funnel_cohort");

    it("the cohort is the accounts whose signup row is in the period — one that can still be followed", () => {
      expect(text).toMatch(/select distinct e\.user_id\s+from public\.funnel_events e\s+where e\.event = 'signup'\s+and e\.user_id is not null/);
    });

    it("answers the app's six steps, in funnel order, a step nobody reached as a row of 0", () => {
      const steps = [...text.matchAll(/\('([a-z_]+)', (\d)\)/g)].map((match) => [match[1], Number(match[2])]);
      expect(steps).toEqual(COHORT_STEPS.map((step, index) => [step, index + 1]));
      // Every step is a row (a scalar count per step), in its position.
      expect(text).toMatch(/from steps s\s+order by s\.position/);
    });

    it("counts cohort members who have the step's event at ANY time — distinct people, never events", () => {
      const count = text.slice(text.indexOf("select count(distinct f.user_id)"), text.indexOf(")::bigint as users"));
      expect(count).toMatch(/where f\.event = s\.step\s+and f\.user_id in \(select c\.user_id from cohort c\)/);
      expect(count).not.toMatch(/created_at/);
    });
  });

  it("admin_signups_daily: signups per UTC day and method — a row with no method is the email form's (its only writer before 0197)", () => {
    const text = body("admin_signups_daily");
    expect(text).toContain("(e.created_at at time zone 'utc')::date as day");
    expect(text).toContain("coalesce(nullif(e.props ->> 'method', ''), 'email') as method");
    expect(text).not.toContain("'not recorded'");
    expect(text).toContain("where e.event = 'signup'");
    expect(text).toMatch(/group by 1, 2\s+order by 1, 2/);
  });

  it("every table a body reads is schema-qualified (search_path is empty)", () => {
    for (const name of Object.keys(FUNCTIONS)) {
      const tables = [...body(name).matchAll(/\b(?:from|join)\s+(?!lateral\b)([a-z_.]+)/g)]
        .map((match) => match[1])
        // `extract(epoch from (…))` and the function's own CTEs are not tables.
        .filter((table) => !["trials", "ended", "measured", "cohort", "steps"].includes(table));
      expect(tables.length).toBeGreaterThan(0);
      for (const table of tables) expect(table).toMatch(/^public\.(funnel_events|profiles)$/);
    }
  });

  it("is safe for the runner, which sends one statement at a time: no bare lock, no begin / commit", () => {
    expect(statements).not.toMatch(/\block table\b/i);
    expect(statements).not.toMatch(/^\s*(begin|commit|start transaction)\b\s*;/im);
  });

  it("changes no table and grants nothing to a visitor", () => {
    expect(statements).not.toMatch(/\b(alter|create|drop) (table|index|policy|trigger)\b/i);
    expect(statements).not.toMatch(/\b(insert into|update|delete from)\b/i);
    expect(statements).not.toMatch(/grant [^;]* to (anon|authenticated|public)\b/i);
    expect(statements).not.toMatch(/grant all/i);
  });

  it("says in its header how it ships", () => {
    expect(sql).toContain("Idempotent. Ships through a PR; never applied ad-hoc.");
    expect(sql).toContain("Grants are explicit (0097)");
  });
});
