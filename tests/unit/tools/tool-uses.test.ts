import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// What the admin pages count as a tool's "uses" (migration 0199, the
// 2026-11-10 tools audit's review). 0182 counted every event that is not
// `open`. Since the tools record refusals, failures, steps and endings too,
// that read five failed presses of "Build with AI" as five uses. A use is
// now one of the events the tool LISTS as a use (TOOL_USE_EVENTS), handed
// to the SQL readers as a parameter — never a list restated in SQL.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  TOOL_CATALOG,
  TOOL_CLIENT_EVENTS,
  TOOL_EVENT_RE,
  TOOL_USE_EVENTS,
  toolEventIsFailure,
  toolEventKind,
  type ToolSlug,
} from "@/lib/tools/catalog";
import { getAdminToolsOverview } from "@/lib/tools/admin-queries";

const SLUGS = TOOL_CATALOG.map((tool) => tool.slug) as ToolSlug[];

/** Where each tool's events are recorded: the files a use event must be named in. */
const SOURCES: Record<ToolSlug, string[]> = {
  "collection-builder": ["lib/tools/collection", "app/api/tools/collection-builder", "app/(app)/dashboard/tools/collection-builder"],
  "token-kit": ["lib/tools/token-kit", "components/tools/token-kit", "app/api/ai/jobs/route.ts"],
  "bulk-customize": ["lib/tools/bulk-customize"],
  "re-art-deck": ["lib/tools/re-art"],
  "pip-forge": ["lib/tools/pip-forge", "app/api/tools/pip-forge"],
  "custom-symbols": ["lib/symbols/actions.ts"],
  "set-symbol-studio": ["lib/tools/set-symbol", "app/api/tools/set-symbol-studio", "components/tools/set-symbol-studio"],
  "play-exports": ["lib/tools/play-exports"],
  "rule0-sheet": ["lib/tools/rule0", "app/api/tools/rule0-sheet", "components/tools/rule0"],
};

function sourceOf(paths: string[]): string {
  const out: string[] = [];
  const walk = (path: string) => {
    if (statSync(path).isDirectory()) for (const name of readdirSync(path)) walk(join(path, name));
    else if (/\.tsx?$/.test(path)) out.push(readFileSync(path, "utf8"));
  };
  for (const path of paths) walk(path);
  return out.join("\n");
}

describe("TOOL_USE_EVENTS — what a use is", () => {
  it("lists every tool, with names the events table accepts and no name twice", () => {
    expect(Object.keys(TOOL_USE_EVENTS).sort()).toEqual([...SLUGS].sort());
    for (const slug of SLUGS) {
      const events = TOOL_USE_EVENTS[slug];
      expect(events.length, slug).toBeGreaterThan(0);
      expect(new Set(events).size, slug).toBe(events.length);
      for (const event of events) expect(event, `${slug}/${event}`).toMatch(TOOL_EVENT_RE);
    }
  });

  it("never counts the page's visit, a refusal or a failure", () => {
    for (const slug of SLUGS) {
      for (const event of TOOL_USE_EVENTS[slug]) {
        expect(event, slug).not.toBe("open");
        expect(toolEventIsFailure(event), `${slug}/${event}`).toBe(false);
      }
    }
  });

  it("names only events the tool's code records (a renamed or removed event would count nothing)", () => {
    for (const slug of SLUGS) {
      const source = sourceOf(SOURCES[slug]);
      for (const event of TOOL_USE_EVENTS[slug]) {
        expect(source.includes(`"${event}"`), `${slug}: "${event}" is recorded nowhere in ${SOURCES[slug].join(", ")}`).toBe(true);
      }
    }
  });

  it("a browser-reported use is on its tool's browser list too (or the route drops it)", () => {
    // The uses the BROWSER reports, by name: each must be allow-listed.
    const fromBrowser: Array<[ToolSlug, string]> = [
      ["token-kit", "kit_exported"],
      ["token-kit", "art_uploaded"],
      ["set-symbol-studio", "open_png"],
      ["rule0-sheet", "copy_link"],
      ["rule0-sheet", "print"],
    ];
    for (const [slug, event] of fromBrowser) {
      expect(TOOL_USE_EVENTS[slug]).toContain(event);
      expect(TOOL_CLIENT_EVENTS[slug]).toContain(event);
    }
  });
});

describe("a name says what an event is", () => {
  it("no browser event that is a user's ACTION is named like a failure (`retry_failed` once read as one)", () => {
    // What the browser reports as a failure is an outcome it watched fail.
    const failures = SLUGS.flatMap((slug) => TOOL_CLIENT_EVENTS[slug].filter(toolEventIsFailure).map((event) => `${slug}/${event}`));
    expect(failures.sort()).toEqual(
      [
        "play-exports/export_build_failed",
        "rule0-sheet/ai_draft_lost",
        "token-kit/ai_art_failed",
        "token-kit/art_upload_failed",
        "token-kit/kit_export_failed",
      ].sort(),
    );
    expect(toolEventKind("re-art-deck", "retry")).toBe("other");
  });
});

describe("toolEventKind", () => {
  it.each([
    ["collection-builder", "open", "open"],
    ["collection-builder", "ai_build", "use"],
    ["collection-builder", "ai_build_failed", "failure"],
    ["token-kit", "render_refused", "failure"],
    ["rule0-sheet", "ai_draft_lost", "failure"],
    ["re-art-deck", "plan", "other"],
    ["re-art-deck", "run_finished", "other"],
    ["play-exports", "dialog_opened", "other"],
    ["rule0-sheet", "shared_view", "other"],
    // Another tool's use is not this tool's.
    ["token-kit", "ai_build", "other"],
    ["nope", "ai_build", "other"],
  ] as const)("%s / %s is %s", (slug, event, kind) => {
    expect(toolEventKind(slug, event)).toBe(kind);
  });
});

describe("0199 — the readers take the list as a parameter", () => {
  const sql = readFileSync("supabase/migrations/0199_tool_uses_by_name.sql", "utf8");
  const statements = sql.replace(/^--.*$/gm, "");

  it("both readers gain `p_uses jsonb default null`, the old signatures go, the grants are restated", () => {
    expect(statements).toMatch(/drop function if exists public\.admin_tool_summary\(\);\s+create or replace function public\.admin_tool_summary\(p_uses jsonb default null\)/);
    expect(statements).toMatch(/drop function if exists public\.admin_tool_detail\(text, integer\);\s+create or replace function public\.admin_tool_detail\(\s+p_slug text,\s+p_days integer default 30,\s+p_uses jsonb default null\s+\)/);
    for (const signature of ["admin_tool_summary(jsonb)", "admin_tool_detail(text, integer, jsonb)"]) {
      expect(statements).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(statements).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    expect(statements).not.toMatch(/grant [^;]*\b(anon|authenticated)\b/);
  });

  it("a use is an event on its tool's list — and anything but `open` for a caller that names no list", () => {
    const rule = "<> 'open' and (p_uses is null or coalesce(p_uses -> e.tool_slug, '[]'::jsonb) ? e.event)";
    // Once in the overview, once in the detail (computed per row as `is_use`).
    expect(statements.split(rule).length - 1).toBe(1);
    expect(statements).toMatch(/\(e\.event <> 'open'\s+and \(p_uses is null or coalesce\(p_uses -> e\.tool_slug, '\[\]'::jsonb\) \? e\.event\)\) as is_use/);
    // Every "uses" count of the detail reads that one column.
    expect(statements.match(/where is_use|where ev\.is_use/g)?.length).toBe(5);
    // No list of event names in SQL: the app's list is the only one.
    for (const slug of SLUGS) for (const event of TOOL_USE_EVENTS[slug]) expect(statements).not.toContain(`'${event}'`);
  });

  it("keeps the result shapes the admin pages read", () => {
    for (const column of ["tool_slug text", "testers bigint", "interested bigint", "users_7d bigint", "users_30d bigint", "opens_30d bigint", "uses_30d bigint", "last_event_at timestamptz"]) {
      expect(statements).toContain(column);
    }
    for (const key of ["'totals'", "'daily'", "'events'", "'access'", "'top_users'", "'using_users'", "'returning_users'"]) {
      expect(statements).toContain(key);
    }
  });
});

describe("the admin pages hand the app's list to the readers", () => {
  function adminAnswering(first: { data: unknown; error: { code?: string; message: string } | null }) {
    const calls: Array<[string, unknown]> = [];
    const admin = {
      rpc: vi.fn(async (name: string, args?: unknown) => {
        calls.push([name, args]);
        return calls.length === 1 ? first : { data: [], error: null };
      }),
      from: () => ({ select: async () => ({ data: [], error: null }) }),
    };
    return { admin: admin as unknown as Parameters<typeof getAdminToolsOverview>[0], calls };
  }

  it("asks with TOOL_USE_EVENTS", async () => {
    const { admin, calls } = adminAnswering({
      data: [{ tool_slug: "token-kit", testers: 2, interested: 1, users_7d: 3, users_30d: 4, opens_30d: 9, uses_30d: 5, last_event_at: null }],
      error: null,
    });
    const rows = await getAdminToolsOverview(admin);
    expect(calls).toEqual([["admin_tool_summary", { p_uses: TOOL_USE_EVENTS }]]);
    expect(rows?.find((row) => row.tool.slug === "token-kit")).toMatchObject({ uses30d: 5, opens30d: 9 });
  });

  it("a database 0199 has not reached yet is asked the old way (never a broken page)", async () => {
    const { admin, calls } = adminAnswering({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    expect(await getAdminToolsOverview(admin)).not.toBeNull();
    expect(calls).toEqual([
      ["admin_tool_summary", { p_uses: TOOL_USE_EVENTS }],
      ["admin_tool_summary", undefined],
    ]);
  });
});
