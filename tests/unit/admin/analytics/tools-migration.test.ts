import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOOL_CATALOG, TOOL_CLIENT_EVENTS, TOOL_USE_EVENTS, toolEventIsFailure, toolReasonOfCode, type ToolSlug } from "@/lib/tools/catalog";

// ---------------------------------------------------------------------------
// Migration 0204 — the Tools tab's five readers — as text: each function's
// signature and return columns are the contract declared in
// types/supabase.ts; all five share ONE reading of a tool_events row (the
// period, 0199's use rule, the app's failure rule, NO credits — an event's
// `credits` is a start's price, and what a tool cost is the credit ledger's
// — the team left out); a failure's reason is a code, and the list of them
// is capped; they are the service role's alone; and the file is something
// the migration runner can send a statement at a time.
// What the functions RETURN on real rows is checked on a database (the
// PR's report); this holds the text to the rules a reviewer would read for.
// ---------------------------------------------------------------------------

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

const sql = read("supabase/migrations/0204_admin_tool_analytics.sql");
/** The statements alone: a comment may name what the SQL must never do. */
const code = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

type Contract = {
  /** As written in the migration. */
  args: string;
  /** The identity its revoke / grant name. */
  identity: string;
  /** `returns table` columns in order, or "jsonb". */
  returns: Array<[name: string, type: string]> | "jsonb";
};

const FUNCTIONS: Record<string, Contract> = {
  admin_tools_overview: {
    args: "p_since timestamptz, p_until timestamptz default now(), p_uses jsonb default null, p_include_admins boolean default false",
    identity: "timestamptz, timestamptz, jsonb, boolean",
    returns: [
      ["tool_slug", "text"],
      ["users", "bigint"],
      ["using_users", "bigint"],
      ["opens", "bigint"],
      ["uses", "bigint"],
      ["failures", "bigint"],
      ["last_event_at", "timestamptz"],
    ],
  },
  admin_tool_breakdown: {
    args: "p_slug text, p_since timestamptz, p_until timestamptz default now(), p_uses jsonb default null, p_include_admins boolean default false",
    identity: "text, timestamptz, timestamptz, jsonb, boolean",
    returns: "jsonb",
  },
  admin_tool_users: {
    args: "p_slug text, p_since timestamptz, p_until timestamptz default now(), p_uses jsonb default null, p_include_admins boolean default false, p_limit integer default 50, p_offset integer default 0",
    identity: "text, timestamptz, timestamptz, jsonb, boolean, integer, integer",
    returns: [
      ["user_id", "uuid"],
      ["username", "text"],
      ["is_admin", "boolean"],
      ["access", "text"],
      ["opens", "bigint"],
      ["uses", "bigint"],
      ["failures", "bigint"],
      ["active_days", "bigint"],
      ["first_at", "timestamptz"],
      ["last_at", "timestamptz"],
      ["total_count", "bigint"],
    ],
  },
  admin_tool_user_events: {
    args: "p_slug text, p_user_id uuid, p_limit integer default 100",
    identity: "text, uuid, integer",
    returns: [
      ["created_at", "timestamptz"],
      ["event", "text"],
      ["access", "text"],
      ["props", "jsonb"],
    ],
  },
  admin_user_tool_usage: {
    args: "p_user_id uuid, p_uses jsonb default null",
    identity: "uuid, jsonb",
    returns: [
      ["tool_slug", "text"],
      ["opens", "bigint"],
      ["uses", "bigint"],
      ["failures", "bigint"],
      ["last_at", "timestamptz"],
    ],
  },
};
const NAMES = Object.keys(FUNCTIONS);
/** The three that read a period and can leave the team out. */
const PERIOD_FUNCTIONS = ["admin_tools_overview", "admin_tool_breakdown", "admin_tool_users"];

/** One function's statement: from its `create or replace` to its `$$;`. */
function definitionOf(name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = code.indexOf("$$;", start);
  expect(end, name).toBeGreaterThan(start);
  return code.slice(start, end);
}

/** A function's block in types/supabase.ts: its Args and Returns as text. */
function typesOf(name: string): { args: Array<[string, boolean]>; returns: string[] | "Json" } {
  const types = read("types/supabase.ts");
  const start = types.indexOf(`      ${name}: {`);
  expect(start, `${name} is declared in types/supabase.ts`).toBeGreaterThanOrEqual(0);
  const block = types.slice(start, types.indexOf("\n      };", start));
  const argsText = /Args: \{([\s\S]*?)\};/.exec(block)?.[1] ?? "";
  const args = [...argsText.matchAll(/(\w+)(\??):/g)].map((m) => [m[1], m[2] === "?"] as [string, boolean]);
  if (/Returns: Json;/.test(block)) return { args, returns: "Json" };
  const returnsText = /Returns: \{([\s\S]*?)\}\[\];/.exec(block)?.[1] ?? "";
  return { args, returns: [...returnsText.matchAll(/(\w+):/g)].map((m) => m[1]) };
}

describe("0204 — signatures are the declared contracts", () => {
  it("defines exactly the five functions, each once", () => {
    const defined = [...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    expect(defined).toEqual(NAMES);
  });

  it.each(NAMES)("%s: arguments, defaults and return columns", (name) => {
    const definition = squash(definitionOf(name));
    const contract = FUNCTIONS[name];
    expect(definition.replace(/\( /g, "(").replace(/ \)/g, ")")).toContain(`public.${name}(${contract.args})`);
    if (contract.returns === "jsonb") {
      expect(definition).toMatch(/\) returns jsonb language sql/);
    } else {
      const columns = /returns table \(([^)]*)\)/.exec(definition)?.[1] ?? "";
      expect(columns.split(",").map((column) => column.trim().split(" "))).toEqual(contract.returns);
    }
  });

  it.each(NAMES)("%s: the same names, the same optional arguments and the same columns as types/supabase.ts", (name) => {
    const contract = FUNCTIONS[name];
    const declared = typesOf(name);
    // An argument with a default is optional to a caller; one without is required.
    const args = contract.args.split(", ").map((arg) => [arg.split(" ")[0], / default /.test(arg)] as [string, boolean]);
    expect(declared.args).toEqual(args);
    if (contract.returns === "jsonb") expect(declared.returns).toBe("Json");
    else expect(declared.returns).toEqual(contract.returns.map(([column]) => column));
  });

  it.each(NAMES)("%s: plain SQL, read-only, the definer's rights with nothing on the search path", (name) => {
    const definition = squash(definitionOf(name));
    expect(definition).toMatch(/language sql stable security definer set search_path = '' as \$\$/);
  });
});

describe("0204 — the service role's alone", () => {
  it.each(NAMES)("%s is revoked from everyone and granted to service_role, by its full identity", (name) => {
    const identity = FUNCTIONS[name].identity;
    expect(code).toContain(`revoke all on function public.${name}(${identity}) from public, anon, authenticated;`);
    expect(code).toContain(`grant execute on function public.${name}(${identity}) to service_role;`);
  });

  it("grants nothing to anyone else", () => {
    const grants = [...code.matchAll(/^grant .*$/gm)].map((m) => m[0]);
    expect(grants).toHaveLength(NAMES.length);
    for (const grant of grants) expect(grant).toMatch(/ to service_role;$/);
  });
});

describe("0204 — one reading of a row", () => {
  it.each(PERIOD_FUNCTIONS)("%s reads [p_since, p_until): since included, until excluded", (name) => {
    const definition = squash(definitionOf(name));
    expect(definition).toContain("e.created_at >= p_since");
    expect(definition).toContain("e.created_at < coalesce(p_until, now())");
  });

  it.each(PERIOD_FUNCTIONS)("%s leaves the team out unless asked: admins now, and rows recorded on the admin path", (name) => {
    const definition = squash(definitionOf(name));
    expect(definition).toContain("coalesce(p_include_admins, false) or (");
    expect(definition).toContain("e.access is distinct from 'admin'");
    expect(definition).toContain("e.user_id not in (select p.id from public.profiles p where p.is_admin)");
  });

  it("an event with no user is nobody's: kept in the numbers, never in the list of people", () => {
    for (const name of ["admin_tools_overview", "admin_tool_breakdown"]) {
      expect(squash(definitionOf(name)), name).toContain(
        "e.user_id is null or e.user_id not in (select p.id from public.profiles p where p.is_admin)",
      );
    }
    expect(squash(definitionOf("admin_tool_users"))).toContain("e.user_id is not null");
  });

  it("a use is 0199's rule, word for word, wherever a use is counted", () => {
    const rule = "(e.event <> 'open' and (p_uses is null or coalesce(p_uses -> e.tool_slug, '[]'::jsonb) ? e.event))";
    const bare = rule.slice(1, -1);
    // 0199 is where the rule comes from.
    expect(squash(read("supabase/migrations/0199_tool_uses_by_name.sql"))).toContain(rule);
    const text = squash(code);
    const reads = text.split("p_uses ->").length - 1;
    const rules = text.split(bare).length - 1;
    expect(reads).toBe(4); // overview, breakdown, users, one user's tools
    expect(rules).toBe(reads);
    for (const name of [...PERIOD_FUNCTIONS, "admin_user_tool_usage"]) expect(squash(definitionOf(name)), name).toContain(bare);
  });

  it("a failure is the app's rule: the regex is toolEventIsFailure's own", () => {
    const source = read("lib/tools/catalog.ts");
    const appRegex = /export function toolEventIsFailure\(event: string\): boolean \{\s*return \/(.+)\/\.test\(event\);/.exec(source)?.[1];
    expect(appRegex).toBe("_(failed|refused|lost)$");
    const patterns = [...code.matchAll(/event ~ '([^']+)'/g)].map((m) => m[1]);
    expect(patterns).toHaveLength(4); // overview, breakdown, users, one user's tools
    for (const pattern of patterns) expect(pattern).toBe(appRegex);

    // …and it reads every event name the tools know the way the app does.
    const sqlRegex = new RegExp(patterns[0]);
    const slugs = TOOL_CATALOG.map((tool) => tool.slug) as ToolSlug[];
    const names = new Set<string>(["open", "plan", "shared_view", "render_refused", "ai_draft_lost", "failed", "lost_and_found", "refused_once"]);
    for (const slug of slugs) {
      for (const event of [...TOOL_USE_EVENTS[slug], ...TOOL_CLIENT_EVENTS[slug]]) {
        names.add(event);
        names.add(`${event}_failed`);
        names.add(`${event}_refused`);
      }
    }
    for (const event of names) expect(sqlRegex.test(event), event).toBe(toolEventIsFailure(event));
  });

  it("NO credits: nothing here reads an event's `credits` — a start's price, a refused run's price — summed or any other way", () => {
    // The statements never name credits at all: not the server's `credits`
    // prop, not a browser's `credits_seen`, not a column, not a key.
    expect(code).not.toMatch(/credits/i);
    // …and add nothing up: every number here is a count (or the newest date).
    expect(code).not.toMatch(/\bsum\s*\(/i);
    expect(code).not.toMatch(/::numeric/);
    // No reader hands a credits column or key back.
    for (const name of NAMES) expect(squash(definitionOf(name)), name).not.toContain("credits");
    expect(typesOf("admin_tools_overview").returns).not.toContain("credits");
    // The header says why, and where a tool's cost is read instead.
    const header = squash(
      sql
        .split("\n")
        .filter((line) => line.startsWith("--"))
        .map((line) => line.replace(/^--\s?/, ""))
        .join("\n"),
    );
    expect(header).toContain("NO CREDITS here. An event's `credits` prop is not a charge");
    expect(header).toContain("a refused start carries the price of a run that never began");
    expect(header).toContain("What a tool cost is the credit LEDGER's, by reason (lib/admin/analytics/credits.ts CREDIT_REASON_TOOLS");
    // …and the app's map it names is really there.
    expect(read("lib/admin/analytics/credits.ts")).toContain("export const CREDIT_REASON_TOOLS");
  });

  it("the breakdown's totals are exactly the seven keys the header lists — counts and a date", () => {
    const definition = squash(definitionOf("admin_tool_breakdown"));
    const totals = /'totals', \( select jsonb_build_object\((.*?)\) from ev \)/.exec(definition)?.[1] ?? "";
    const keys = [...totals.matchAll(/'(\w+)',/g)].map((m) => m[1]);
    expect(keys).toEqual(["users", "using_users", "opens", "uses", "failures", "visitor_events", "last_event_at"]);
    expect(squash(sql)).toContain("totals { users, using_users, opens, uses, failures, -- visitor_events, last_event_at }");
  });

  it("days are UTC", () => {
    const text = squash(code);
    expect(text).toContain("(e.created_at at time zone 'utc')::date as day");
    expect(text).toContain("(p_since at time zone 'utc')::date");
    expect(text).toContain("count(distinct (ev.created_at at time zone 'utc')::date) as active_days");
    // never the session's zone
    expect(text).not.toMatch(/created_at::date|current_date/);
  });

  it("the lists are held to a size: 1..200 people a page, 1..500 events", () => {
    expect(squash(definitionOf("admin_tool_users"))).toContain(
      "limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))",
    );
    expect(squash(definitionOf("admin_tool_user_events"))).toContain("limit greatest(1, least(coalesce(p_limit, 100), 500))");
  });

  it("everyone who used a tool is ordered so a page never repeats or drops a person", () => {
    expect(squash(definitionOf("admin_tool_users"))).toContain("order by u.uses desc, u.last_at desc, u.user_id");
    expect(squash(definitionOf("admin_tool_users"))).toContain("count(*) over ()");
  });

  it("'*' reads every tool together, and a tool's slug reads that tool", () => {
    const definition = squash(definitionOf("admin_tool_breakdown"));
    expect(definition).toContain("select p_slug as tool_slug where p_slug <> '*'");
    expect(definition).toContain("where p_slug = '*' and s.tool_slug is not null");
    // the keys the app reads (lib/admin/analytics/tools-view.ts parseToolBreakdown)
    for (const key of ["slug", "totals", "daily", "events", "reasons", "users", "using_users", "opens", "uses", "failures", "visitor_events", "last_event_at", "day", "event", "count", "reason"]) {
      expect(definition, key).toContain(`'${key}'`);
    }
  });
});

describe("0204 — why things failed: a reason is a code, and the list is capped", () => {
  /** The `reasons` list of admin_tool_breakdown, from its key to the end. */
  const reasons = () => {
    const definition = squash(definitionOf("admin_tool_breakdown"));
    const at = definition.indexOf("'reasons',");
    expect(at).toBeGreaterThan(0);
    return definition.slice(at);
  };
  /** The one pattern a kept reason matches, as written in the SQL. */
  const codePattern = () => /ev\.props ->> 'reason' ~ '([^']+)'/.exec(reasons())?.[1] ?? "";

  it("keeps a reason that is a short lower-case code and counts anything else as `other`", () => {
    expect(codePattern()).toBe("^[a-z][a-z0-9_]{0,39}$");
    expect(reasons()).toContain(
      "select case when ev.props ->> 'reason' ~ '^[a-z][a-z0-9_]{0,39}$' then ev.props ->> 'reason' else 'other' end as reason",
    );
    // The raw prop is read nowhere else: only through the rule.
    expect(squash(code).split("props ->> 'reason'").length - 1).toBe(2);
    // Grouped by what the rule answers, so everything that is not a code is
    // ONE row per tool and event — never a row per string someone posted.
    expect(reasons()).toContain("group by ev.tool_slug, ev.event, r.reason");
    expect(reasons()).toContain("jsonb_build_object('tool_slug', x.tool_slug, 'event', x.event, 'reason', x.reason, 'count', x.n)");
    // Still only failures, and only a reason that is a string.
    expect(reasons()).toContain("where ev.is_failure and jsonb_typeof(ev.props -> 'reason') = 'string'");
  });

  it("the rule reads the reasons the tools write as codes, and text as `other`", () => {
    const rule = new RegExp(codePattern());
    const said = (reason: string) => (rule.test(reason) ? reason : "other");
    // What the tools write (lib/tools/catalog.ts toolReasonOfCode, the AI
    // failure kinds, a browser's export error) — each kept as itself.
    const codes = [
      toolReasonOfCode("INSUFFICIENT_CREDITS"),
      toolReasonOfCode("CARD_CAPACITY"),
      toolReasonOfCode("RATE_LIMITED"),
      toolReasonOfCode("DAILY_LIMIT"),
      toolReasonOfCode("AI_UNAVAILABLE"),
      "invalid",
      "upgrade_required",
      "design_busy",
      "art_timeout",
      "error",
      "http_500",
      "a",
      `a${"b".repeat(39)}`, // 40 characters: the longest code
    ];
    for (const code of codes) expect(said(code), code).toBe(code);
    // Anything a person could type — or a code in another shape — is `other`.
    const text = [
      "Out of credits!",
      "out of credits",
      "<script>alert(1)</script>",
      "someone@example.test",
      "INSUFFICIENT_CREDITS",
      "Insufficient_credits",
      "http-500",
      "render.error",
      "kind:zip",
      "500",
      "_private",
      "é",
      "",
      " ",
      "rate_limited ",
      "rate_limited\nand more",
      `a${"b".repeat(40)}`, // 41 characters
    ];
    for (const reason of text) expect(said(reason), JSON.stringify(reason)).toBe("other");
    // `other` is itself a code: the rows it gathers read as one reason.
    expect(said("other")).toBe("other");
  });

  it("every reason the rule keeps is one a browser may post (the browser's own rule is the wider one)", () => {
    const source = read("lib/tools/client-events.ts");
    const browser = /export const BROWSER_CODE_RE = \/(.+)\/;/.exec(source)?.[1];
    expect(browser).toBe("^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$");
    const browserRule = new RegExp(browser!);
    const rule = new RegExp(codePattern());
    for (const reason of ["insufficient_credits", "rate_limited", "capacity", "error", "a", `a${"b".repeat(39)}`, "x9_y"]) {
      expect(rule.test(reason), reason).toBe(true);
      expect(browserRule.test(reason), reason).toBe(true);
    }
    // …so what the browser's rule lets through and this one does not is
    // stored and then read as `other`, never printed as it was posted.
    for (const reason of ["PDF", "http-500", "kind:zip", "9lives"]) {
      expect(browserRule.test(reason), reason).toBe(true);
      expect(rule.test(reason), reason).toBe(false);
    }
  });

  it("returns only the 50 most frequent — cut before the list is built, in the order it is shown", () => {
    const text = reasons();
    // The cap is on the grouped rows, most frequent first, with the same tie
    // order as the list: the 50 kept are the top 50, not any 50.
    expect(text).toContain("group by ev.tool_slug, ev.event, r.reason order by count(*) desc, ev.event, r.reason, ev.tool_slug limit 50 ) x");
    expect(text).toContain("order by x.n desc, x.event, x.reason, x.tool_slug");
    // One cap, and it is this list's: the other lists of the file keep theirs.
    expect(squash(code).split("limit 50").length - 1).toBe(1);
    // Nothing a caller passes can raise it.
    expect(text).not.toMatch(/limit (p_|greatest|least|coalesce)/);
  });
});

describe("0204 — a file the runner can apply, twice", () => {
  it("is read-only: functions and their grants, no table, row, index or older function touched", () => {
    expect(code).not.toMatch(/\b(create table|alter table|create index|drop |insert into|update public\.|delete from|truncate)\b/i);
    const statements = code
      .split(/;\s*$/m)
      .map((statement) => squash(statement))
      .filter(Boolean)
      // a function's body ends `$$`, the statement's own `;` after it
      .filter((statement) => !statement.startsWith("$$"));
    for (const statement of statements) {
      expect(statement).toMatch(/^(create or replace function public\.|revoke all on function public\.|grant execute on function public\.)/);
    }
  });

  it("has no top-level transaction or lock (the runner sends one statement at a time)", () => {
    expect(code).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(code).not.toMatch(/lock table/i);
  });

  it("names every table by its schema (the search path is empty)", () => {
    expect(code).not.toMatch(/\b(from|join)\s+(tool_events|profiles)\b/);
    expect(code).toMatch(/from public\.tool_events e/);
  });

  it("says how it ships", () => {
    expect(sql).toMatch(/Ships through a PR; never\s+--\s+applied ad-hoc\./);
    expect(sql).toMatch(/Grants are explicit \(0097\)/);
  });
});
