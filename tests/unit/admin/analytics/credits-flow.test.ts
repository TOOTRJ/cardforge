import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The "Credits and AI" tab's data (lib/admin/analytics/credits.ts): the
// ledger's flow as admin_credit_flow answers it (migration 0201), read
// defensively; where credits went, by label and by tool; and the two reads.
// Each read checks the viewer is an admin ITSELF (requireAdminClient): for
// anyone else it is null and nothing is asked of the database.
// ---------------------------------------------------------------------------

type Filter = [string, string, unknown];
const db = vi.hoisted(() => ({
  rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  rpc: (): { data: unknown; error: { message: string } | null } => ({ data: null, error: null }),
  /** table → what a read of it answers. */
  tables: {} as Record<string, { data?: unknown; count?: number | null; error?: { message: string } | null }>,
  reads: [] as Array<{ table: string; select: string; head: boolean; filters: Array<[string, string, unknown]>; or: string[] }>,
  /** Whether the viewer is an admin: what requireAdminClient answers. */
  admin: true,
  /** How often a read asked who the viewer is. */
  gate: 0,
  /** The gate itself fails (the viewer's profile, or the service client). */
  gateThrows: false,
}));

function fakeAdmin() {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpcCalls.push([name, args]);
      return db.rpc();
    },
    from(table: string) {
      const read = { table, select: "", head: false, filters: [] as Filter[], or: [] as string[] };
      db.reads.push(read);
      const filter = (op: string) => (column: string, value: unknown) => {
        read.filters.push([op, column, value]);
        return chain;
      };
      const chain: Record<string, unknown> = {
        select: (columns: string, options?: { head?: boolean }) => {
          read.select = columns;
          read.head = options?.head === true;
          return chain;
        },
        eq: filter("eq"),
        gte: filter("gte"),
        lt: filter("lt"),
        or: (value: string) => {
          read.or.push(value);
          return chain;
        },
        then: (resolve: (value: unknown) => void) => {
          const answer = db.tables[table] ?? {};
          resolve({ data: answer.data ?? null, count: answer.count ?? null, error: answer.error ?? null });
        },
      };
      return chain;
    },
  };
}

// The reads' own gate: the service client for an admin, null for anyone else.
vi.mock("@/lib/admin/users-queries", () => ({
  requireAdminClient: async () => {
    db.gate += 1;
    if (db.gateThrows) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    return db.admin ? fakeAdmin() : null;
  },
}));
// …and the only way to a client: a read that built the service client
// itself would never have asked who is looking.
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => {
    throw new Error("an analytics read takes its client from requireAdminClient, never createAdminClient");
  },
}));

import {
  CREDIT_REASON_TOOLS,
  creditDaySeries,
  getAiGenerationCounts,
  getCreditFlow,
  parseCreditFlow,
  spendingByLabel,
  spendingByTool,
  withoutAdminsFilter,
} from "@/lib/admin/analytics/credits";
import { analyticsPeriod } from "@/lib/admin/analytics/params";
import { LEDGER_REASON_LABELS } from "@/lib/billing/ledger-reasons";
import { TOOL_CATALOG } from "@/lib/tools/catalog";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const filesUnder = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(ROOT, path)).isDirectory() ? filesUnder(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

/** What 0201 answers for the rows its own check inserts (admins left out). */
const ANSWER = {
  since: "2031-03-01T00:00:00+00:00",
  until: "2031-03-11T00:00:00+00:00",
  totals: { spent: 7, spends: 6, refunded: 8, refunds: 7, granted: 132, grants: 5, taken_back: 12, take_backs: 1 },
  spent_by_reason: [
    { reason: "generate_random_card", spent: 2, spends: 1, refunded: 2, refunds: 1 },
    { reason: "fill_card", spent: 2, spends: 2, refunded: 1, refunds: 1 },
    { reason: "forge_pip", spent: 2, spends: 2, refunded: 0, refunds: 0 },
    { reason: "analyze_deck", spent: 1, spends: 1, refunded: 0, refunds: 0 },
    { reason: "deck_reart_art", spent: 0, spends: 0, refunded: 1, refunds: 1 },
    { reason: "remix_card", spent: 0, spends: 0, refunded: 1, refunds: 1 },
  ],
  refunded_unattributed: { credits: 3, refunds: 3 },
  granted_by_reason: [
    { reason: "plan_credits_once", credits: 60, grants: 1 },
    { reason: "pack_purchase", credits: 30, grants: 1 },
  ],
  days: [
    { day: "2031-03-01", spent: 1, granted: 0, refunded: 1 },
    { day: "2031-03-02", spent: 3, granted: 0, refunded: 1 },
    { day: "2031-03-06", spent: 0, granted: 85, refunded: 0 },
  ],
};

beforeEach(() => {
  db.rpcCalls = [];
  db.rpc = () => ({ data: null, error: null });
  db.tables = {};
  db.reads = [];
  db.admin = true;
  db.gate = 0;
  db.gateThrows = false;
});

describe("parseCreditFlow", () => {
  it("reads the function's object key by key", () => {
    expect(parseCreditFlow(ANSWER)).toEqual({
      totals: { spent: 7, spends: 6, refunded: 8, refunds: 7, granted: 132, grants: 5, takenBack: 12, takeBacks: 1 },
      spentByReason: ANSWER.spent_by_reason,
      refundedUnattributed: { credits: 3, refunds: 3 },
      grantedByReason: ANSWER.granted_by_reason,
      days: ANSWER.days,
    });
  });

  it("an answer that is not that object is a failed read (null), never zeros", () => {
    for (const bad of [null, undefined, [], "ok", 12, {}, { totals: null }, { totals: [] }, { spent_by_reason: [] }]) {
      expect(parseCreditFlow(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("a missing key is 0 or an empty list; a row without its reason, or a day that is no date, is skipped", () => {
    const flow = parseCreditFlow({
      totals: { spent: "12", spends: null, refunded: -3, granted: Number.NaN, grants: "many" },
      spent_by_reason: [
        { reason: "fill_card", spent: "5", spends: 5 },
        { reason: "", spent: 9 },
        { spent: 9 },
        "fill_card",
        null,
      ],
      refunded_unattributed: "none",
      granted_by_reason: { reason: "plan_credits_once" },
      days: [{ day: "2031-03-01T00:00:00+00:00", spent: 1 }, { day: "yesterday", spent: 4 }, { spent: 4 }],
    });
    expect(flow).toEqual({
      totals: { spent: 12, spends: 0, refunded: 0, refunds: 0, granted: 0, grants: 0, takenBack: 0, takeBacks: 0 },
      spentByReason: [{ reason: "fill_card", spent: 5, spends: 5, refunded: 0, refunds: 0 }],
      refundedUnattributed: { credits: 0, refunds: 0 },
      grantedByReason: [],
      days: [{ day: "2031-03-01", spent: 1, granted: 0, refunded: 0 }],
    });
  });
});

describe("where credits went", () => {
  const flow = parseCreditFlow(ANSWER)!;

  it("groups reasons under the label the usage ledger prints — one row a label, largest spend first", () => {
    const rows = spendingByLabel([
      { reason: "generate_deck", spent: 4, spends: 1, refunded: 0, refunds: 0 },
      { reason: "fill_card", spent: 9, spends: 9, refunded: 2, refunds: 2 },
      { reason: "generate_deck_cards", spent: 30, spends: 30, refunded: 5, refunds: 5 },
      { reason: "a_new_action", spent: 1, spends: 1, refunded: 0, refunds: 0 },
    ]);
    expect(rows).toEqual([
      { key: "AI deck generation", label: "AI deck generation", spent: 34, spends: 31, refunded: 5, refunds: 5 },
      { key: "AI card fill", label: "AI card fill", spent: 9, spends: 9, refunded: 2, refunds: 2 },
      // A reason the label table doesn't know is humanised, never dropped.
      { key: "A new action", label: "A new action", spent: 1, spends: 1, refunded: 0, refunds: 0 },
    ]);
    // Nothing is lost by the grouping.
    const grouped = spendingByLabel(flow.spentByReason);
    expect(grouped.reduce((n, row) => n + row.spent, 0)).toBe(flow.totals.spent);
    expect(grouped.reduce((n, row) => n + row.refunded, 0)).toBe(flow.totals.refunded - flow.refundedUnattributed.credits);
  });

  it("a reason charged before the period and refunded in it keeps its row (spent 0), after the ones that spent", () => {
    const grouped = spendingByLabel(flow.spentByReason);
    expect(grouped.at(-1)).toMatchObject({ spent: 0, refunded: 1 });
    expect(grouped.map((row) => row.label)).toContain("Re-art deck AI art");
  });

  it("splits the spend by beta tool, every mapped tool in the catalog's order, the rest in one last row", () => {
    const byTool = spendingByTool([
      { reason: "build_collection_deck", spent: 6, spends: 6, refunded: 1, refunds: 1 },
      { reason: "suggest_collection_commander", spent: 3, spends: 3, refunded: 0, refunds: 0 },
      { reason: "forge_pip", spent: 2, spends: 2, refunded: 0, refunds: 0 },
      { reason: "fill_card", spent: 40, spends: 40, refunded: 4, refunds: 4 },
      { reason: "generate_random_card", spent: 10, spends: 5, refunded: 0, refunds: 0 },
      { reason: "constructor", spent: 1, spends: 1, refunded: 0, refunds: 0 },
    ]);
    expect(byTool.tools.map((tool) => [tool.slug, tool.spent, tool.spends, tool.refunded])).toEqual([
      ["collection-builder", 9, 9, 1],
      ["bulk-customize", 0, 0, 0],
      ["re-art-deck", 0, 0, 0],
      ["pip-forge", 2, 2, 0],
      ["set-symbol-studio", 0, 0, 0],
      ["rule0-sheet", 0, 0, 0],
    ]);
    // Named as the catalog names them.
    expect(byTool.tools[0].label).toBe("Collection Deck Builder");
    for (const tool of byTool.tools) expect(tool.label).toBe(TOOL_CATALOG.find((t) => t.slug === tool.slug)?.name);
    // Token Kit's fills, the creator's and anything unknown: not a tool's.
    expect(byTool.other).toMatchObject({ label: "The card creator and everything else", spent: 51, spends: 46, refunded: 4 });
  });

  it("fills the quiet days of a measure", () => {
    const keys = ["2031-03-01", "2031-03-02", "2031-03-03", "2031-03-04", "2031-03-05", "2031-03-06"];
    expect(creditDaySeries(keys, flow.days, "spent").map((p) => p.value)).toEqual([1, 3, 0, 0, 0, 0]);
    expect(creditDaySeries(keys, flow.days, "granted").map((p) => p.value)).toEqual([0, 0, 0, 0, 0, 85]);
    expect(creditDaySeries(keys, flow.days, "refunded").map((p) => p.day)).toEqual(keys);
  });
});

describe("CREDIT_REASON_TOOLS", () => {
  /** Where each mapped tool's own server code lives. */
  const TOOL_CODE: Record<string, string> = {
    "collection-builder": "app/api/tools/collection-builder",
    "set-symbol-studio": "app/api/tools/set-symbol-studio",
    "pip-forge": "app/api/tools/pip-forge",
    "rule0-sheet": "app/api/tools/rule0-sheet",
    "bulk-customize": "lib/tools/bulk-customize",
    "re-art-deck": "lib/tools/re-art",
  };
  const pairs = Object.entries(CREDIT_REASON_TOOLS);
  const actionLabels = [
    ...read("lib/ai/rate-limit.ts")
      .split("export type AiActionLabel =")[1]
      .split(";")[0]
      .matchAll(/"([a-z_0-9]+)"/g),
  ].map((m) => m[1]);
  const toolFiles = [...filesUnder("app/api/tools"), ...filesUnder("lib/tools")].filter((path) => path !== "lib/tools/catalog.ts");

  it("maps the reasons of the six tools that have one of their own", () => {
    expect(CREDIT_REASON_TOOLS).toEqual({
      build_collection_deck: "collection-builder",
      suggest_collection_commander: "collection-builder",
      generate_set_icon: "set-symbol-studio",
      forge_pip: "pip-forge",
      draft_table_sheet: "rule0-sheet",
      bulk_customize_art: "bulk-customize",
      deck_reart_art: "re-art-deck",
    });
    expect(Object.keys(TOOL_CODE).sort()).toEqual([...new Set(Object.values(CREDIT_REASON_TOOLS))].sort());
  });

  it.each(pairs)("%s is a real AI action with a ledger label, spent by %s's own code and no other tool's", (reason, slug) => {
    expect(actionLabels.length).toBeGreaterThan(20);
    expect(actionLabels).toContain(reason);
    expect(LEDGER_REASON_LABELS[reason]).toBeTruthy();
    expect(TOOL_CATALOG.map((tool) => tool.slug)).toContain(slug);
    const spenders = toolFiles.filter((path) => read(path).includes(`"${reason}"`));
    expect(spenders.length, `a file of ${slug} that spends as "${reason}"`).toBeGreaterThan(0);
    for (const path of spenders) expect(path.startsWith(`${TOOL_CODE[slug]}/`), `${path} spends as "${reason}"`).toBe(true);
  });

  it("Token Kit has no reason of its own: its art is a card fill, charged as the creator's fills are", () => {
    expect(Object.values(CREDIT_REASON_TOOLS)).not.toContain("token-kit");
    expect(Object.keys(CREDIT_REASON_TOOLS)).not.toContain("fill_card");
    // The fill job knows the tool that asked; the charge is the fill's.
    expect(read("app/api/ai/jobs/route.ts")).toMatch(/tool: z\.enum\(\[[^\]]*"token-kit"/);
    expect(read("lib/ai/generation-jobs.ts")).toContain('"fill_card"');
    const ownSpend = [...filesUnder("app/api/tools/token-kit"), ...filesUnder("lib/tools/token-kit")].filter((path) =>
      /spendCredits\(|withCreditedStep\(/.test(read(path)),
    );
    expect(ownSpend).toEqual([]);
  });
});

describe("getCreditFlow", () => {
  const window = { since: new Date("2031-03-01T00:00:00Z"), until: new Date("2031-03-11T00:00:00Z") };

  it("asks the function for exactly the window, with the admin switch", async () => {
    db.rpc = () => ({ data: ANSWER, error: null });
    const flow = await getCreditFlow(window, false);
    expect(db.rpcCalls).toEqual([
      ["admin_credit_flow", { p_since: "2031-03-01T00:00:00.000Z", p_until: "2031-03-11T00:00:00.000Z", p_include_admins: false }],
    ]);
    expect(flow?.totals.spent).toBe(7);
    await getCreditFlow(window, true);
    expect(db.rpcCalls[1][1].p_include_admins).toBe(true);
  });

  it("a failed read, an answer that is not the object, or a gate that throws is null — and logged", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    db.rpc = () => ({ data: null, error: { message: "permission denied for function admin_credit_flow" } });
    expect(await getCreditFlow(window, false)).toBeNull();
    db.rpc = () => ({ data: [], error: null });
    expect(await getCreditFlow(window, false)).toBeNull();
    db.gateThrows = true;
    expect(await getCreditFlow(window, false)).toBeNull();
    expect(logged).toHaveBeenCalledTimes(3);
    logged.mockRestore();
  });
});

describe("a viewer who is not an admin gets nothing — each read asks for itself", () => {
  const window = { since: new Date("2031-03-01T00:00:00Z"), until: new Date("2031-03-11T00:00:00Z") };
  const period = analyticsPeriod(30, new Date("2026-11-10T15:00:00Z"));

  it("getCreditFlow and getAiGenerationCounts are null, and no function or table is read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    db.admin = false;
    // A database that WOULD answer: nothing below may reach it.
    db.rpc = () => ({ data: ANSWER, error: null });
    db.tables.profiles = { data: [] };
    db.tables.funnel_events = { count: 41 };

    expect(await getCreditFlow(window, false)).toBeNull();
    expect(await getCreditFlow(window, true)).toBeNull();
    expect(await getAiGenerationCounts(period, false)).toBeNull();
    expect(await getAiGenerationCounts(period, true)).toBeNull();

    // each asked who the viewer is…
    expect(db.gate).toBe(4);
    // …and stopped there
    expect(db.rpcCalls).toEqual([]);
    expect(db.reads).toEqual([]);
    // not a failed read: nothing to log
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("an admin's read asks who the viewer is once, before anything else", async () => {
    db.rpc = () => ({ data: ANSWER, error: null });
    expect(await getCreditFlow(window, false)).not.toBeNull();
    expect(db.gate).toBe(1);
    db.tables.funnel_events = { count: 7 };
    expect(await getAiGenerationCounts(period, true)).toEqual({ current: 7, previous: 7 });
    expect(db.gate).toBe(2);
  });
});

describe("getAiGenerationCounts", () => {
  const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  // The page's period for "the last 30 days", read on Nov 10 at 15:00 UTC:
  // [Oct 12 00:00, Nov 10 15:00), and the same stretch 30 days earlier, cut
  // at the same time of day: [Sep 12 00:00, Oct 11 15:00).
  const period = analyticsPeriod(30, new Date("2026-11-10T15:00:00Z"));

  it("keeps rows with no user and drops only the admins'", () => {
    expect(withoutAdminsFilter([])).toBeNull();
    expect(withoutAdminsFilter([ADMIN])).toBe(`user_id.is.null,user_id.not.in.(${ADMIN})`);
    expect(withoutAdminsFilter([ADMIN, "x); drop", ""])).toBe(`user_id.is.null,user_id.not.in.(${ADMIN})`);
  });

  it("counts ai_generation rows of [since, until) and of [previousSince, previousUntil) — the same stretch 30 days earlier — without the admins'", async () => {
    db.tables.profiles = { data: [{ id: ADMIN }] };
    db.tables.funnel_events = { count: 41 };
    expect(await getAiGenerationCounts(period, false)).toEqual({ current: 41, previous: 41 });
    const counts = db.reads.filter((r) => r.table === "funnel_events");
    expect(counts).toHaveLength(2);
    for (const read of counts) {
      expect(read.head).toBe(true);
      expect(read.filters[0]).toEqual(["eq", "event", "ai_generation"]);
      expect(read.or).toEqual([`user_id.is.null,user_id.not.in.(${ADMIN})`]);
    }
    expect(counts.map((r) => r.filters.slice(1))).toEqual([
      [
        ["gte", "created_at", "2026-10-12T00:00:00.000Z"],
        ["lt", "created_at", "2026-11-10T15:00:00.000Z"],
      ],
      // The period before stops at Oct 11 15:00 — 30 days before `until` —
      // not at this period's start: the rest of Oct 11 is counted in neither.
      [
        ["gte", "created_at", "2026-09-12T00:00:00.000Z"],
        ["lt", "created_at", "2026-10-11T15:00:00.000Z"],
      ],
    ]);
    const [current, before] = counts.map((r) => r.filters.slice(1).map(([, , value]) => Date.parse(String(value))));
    // Exactly as long as each other, 30 days apart at both ends.
    expect(before[1] - before[0]).toBe(current[1] - current[0]);
    expect(current[0] - before[0]).toBe(30 * 86_400_000);
    expect(current[1] - before[1]).toBe(30 * 86_400_000);
  });

  it("with admins included it reads no admin ids and filters nothing", async () => {
    db.tables.funnel_events = { count: 7 };
    expect(await getAiGenerationCounts(period, true)).toEqual({ current: 7, previous: 7 });
    expect(db.reads.map((r) => r.table)).toEqual(["funnel_events", "funnel_events"]);
    expect(db.reads.every((r) => r.or.length === 0)).toBe(true);
  });

  it("no number rather than a wrong one: null when the admins' ids or a count cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    db.tables.profiles = { error: { message: "statement timeout" } };
    db.tables.funnel_events = { count: 41 };
    expect(await getAiGenerationCounts(period, false)).toBeNull();
    // The team's rows were never counted as everyone's.
    expect(db.reads.some((r) => r.table === "funnel_events")).toBe(false);
    db.tables.profiles = { data: [] };
    db.tables.funnel_events = { error: { message: "statement timeout" } };
    expect(await getAiGenerationCounts(period, false)).toBeNull();
    db.gateThrows = true;
    expect(await getAiGenerationCounts(period, true)).toBeNull();
    logged.mockRestore();
  });
});
