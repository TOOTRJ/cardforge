import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// How a beta tool's use is recorded (the 2026-11-10 tools audit). Three
// rules, each the fix of a number that was wrong:
//   - ONE `open` a visit. A tool page renders again after every action that
//     revalidates it, every router.refresh() and every reload, and each
//     render wrote an `open`: one session read as dozens of visits.
//   - after the response: a tool action never waits for its own bookkeeping.
//   - the browser may record only the events its tool lists: the door is
//     open to any tester, and any name was accepted. And it knocks on a
//     ROUTE (POST /api/tools/usage), never a server action: Next runs a
//     page's actions one at a time, so a tracking action made the real one
//     behind it wait.
// ---------------------------------------------------------------------------

type Filter = [string, string, unknown];

const db = vi.hoisted(() => ({
  /** The newest matching `open` row, or null. */
  recentOpen: null as null | { id: number },
  readError: null as null | { message: string },
  filters: [] as Array<[string, string, unknown]>,
  inserts: [] as Array<Record<string, unknown>>,
  countLastMinute: 0,
  countError: null as null | { message: string },
  insertError: null as null | { message: string },
  deferred: [] as Array<() => unknown>,
  access: { userId: "user-1", via: "grant" } as null | { userId: string; via: string },
  admin: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => db.admin,
  createAdminClient: () => ({
    from: () => {
      let head = false;
      const chain: Record<string, unknown> = {
        insert: async (row: Record<string, unknown>) => {
          if (db.insertError) return { error: db.insertError };
          db.inserts.push(row);
          return { error: null };
        },
        select: (_cols: string, options?: { head?: boolean }) => {
          head = options?.head === true;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          db.filters.push(["eq", column, value] as Filter);
          return chain;
        },
        gte: (column: string, value: unknown) => {
          db.filters.push(["gte", column, value] as Filter);
          return chain;
        },
        in: (column: string, value: unknown) => {
          db.filters.push(["in", column, value] as Filter);
          return chain;
        },
        limit: () => chain,
        maybeSingle: async () => ({ data: db.recentOpen, error: db.readError }),
        then: (resolve: (value: unknown) => void) =>
          resolve(head ? { count: db.countLastMinute, error: db.countError } : { data: [], error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/api/after-response", () => ({ afterResponse: (task: () => unknown) => void db.deferred.push(task) }));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: async () => db.access }));

import {
  ANONYMOUS_TOOL_EVENTS_PER_MINUTE,
  TOOL_EVENTS_PER_MINUTE,
  TOOL_VISIT_GAP_MS,
  recordToolEvent,
  recordToolEventLater,
  recordToolEventOncePerVisit,
  recordToolOpen,
} from "@/lib/tools/events";
import { CLIENT_TOOL_EVENTS_PER_MINUTE, browserEventProps, recordClientToolEvent } from "@/lib/tools/client-events";
import { TOOL_CATALOG, TOOL_CLIENT_EVENTS, TOOL_EVENT_RE, isToolClientEvent } from "@/lib/tools/catalog";

const NOW = new Date("2026-11-10T12:00:00.000Z");

beforeEach(() => {
  db.recentOpen = null;
  db.readError = null;
  db.filters = [];
  db.inserts = [];
  db.countLastMinute = 0;
  db.countError = null;
  db.insertError = null;
  db.deferred = [];
  db.access = { userId: "user-1", via: "grant" };
  db.admin = true;
});

describe("recordToolOpen — one `open` a visit", () => {
  it("writes the visit's first open, with the access path that let the user in", async () => {
    expect(await recordToolOpen({ slug: "token-kit", userId: "user-1", access: "grant", now: NOW })).toBe(true);
    expect(db.inserts).toEqual([{ tool_slug: "token-kit", user_id: "user-1", event: "open", access: "grant", props: {} }]);
  });

  it("asks for THIS user's open of THIS tool in the last half hour", async () => {
    await recordToolOpen({ slug: "token-kit", userId: "user-1", access: "grant", now: NOW });
    expect(TOOL_VISIT_GAP_MS).toBe(30 * 60_000);
    expect(db.filters).toEqual([
      ["eq", "user_id", "user-1"],
      ["eq", "tool_slug", "token-kit"],
      ["eq", "event", "open"],
      ["gte", "created_at", "2026-11-10T11:30:00.000Z"],
    ]);
  });

  it("a page rendered again in the same visit (an action, a refresh, a reload) writes nothing", async () => {
    db.recentOpen = { id: 41 };
    for (let i = 0; i < 12; i += 1) {
      expect(await recordToolOpen({ slug: "collection-builder", userId: "user-1", access: "admin", now: NOW })).toBe(false);
    }
    expect(db.inserts).toEqual([]);
  });

  it("an unreadable log records nothing — never a guess that inflates the count", async () => {
    db.readError = { message: "timeout" };
    expect(await recordToolOpen({ slug: "token-kit", userId: "user-1", access: "grant", now: NOW })).toBe(false);
    expect(db.inserts).toEqual([]);
  });

  it("an unknown tool and a deployment with no service role record nothing", async () => {
    expect(await recordToolOpen({ slug: "nope", userId: "user-1", access: null })).toBe(false);
    db.admin = false;
    expect(await recordToolOpen({ slug: "token-kit", userId: "user-1", access: null })).toBe(false);
    expect(db.inserts).toEqual([]);
    expect(db.filters).toEqual([]);
  });

  it("every tool page opens through it, after the response (never the plain event write)", () => {
    const queries = readFileSync("lib/tools/queries.ts", "utf8");
    expect(queries).toMatch(/afterResponse\(\(\) => recordToolOpen\(\{ slug, userId: entry\.userId, access: entry\.via \}\)\);/);
    expect(queries).not.toMatch(/event: "open"/);
  });
});

describe("an event a page RENDER records — once a visit, like the open", () => {
  it("writes the first one of the visit and asks for THAT event's row", async () => {
    expect(
      await recordToolEventOncePerVisit({ slug: "collection-builder", userId: "user-1", event: "buildable_decks", access: "release", props: { decks: 3 }, now: NOW }),
    ).toBe(true);
    expect(db.filters).toContainEqual(["eq", "event", "buildable_decks"]);
    expect(db.inserts).toEqual([
      { tool_slug: "collection-builder", user_id: "user-1", event: "buildable_decks", access: "release", props: { decks: 3 } },
    ]);
  });

  it("the same view rendered again in the visit writes nothing, and a name the table refuses is never asked about", async () => {
    db.recentOpen = { id: 7 };
    expect(await recordToolEventOncePerVisit({ slug: "collection-builder", userId: "user-1", event: "buildable_decks", access: "release" })).toBe(false);
    db.recentOpen = null;
    db.filters = [];
    expect(await recordToolEventOncePerVisit({ slug: "collection-builder", userId: "user-1", event: "Not A Name", access: "release" })).toBe(false);
    expect(db.inserts).toEqual([]);
    expect(db.filters).toEqual([]);
  });

  it("the collection page records \"Decks you can build\" through it", () => {
    const page = readFileSync("app/(app)/dashboard/tools/collection-builder/page.tsx", "utf8");
    expect(page).toMatch(/afterResponse\(\(\) =>\s+recordToolEventOncePerVisit\(\{ slug: "collection-builder", userId: entry\.userId, event: "buildable_decks"/);
    expect(page).not.toMatch(/recordToolEventLater/);
  });
});

describe("recordToolEventLater — after the response", () => {
  it("defers the write: nothing during the action, the row afterwards", async () => {
    recordToolEventLater({ slug: "pip-forge", userId: "user-1", event: "forge", access: "admin", props: { credits: 1, rung: 2 } });
    expect(db.inserts).toEqual([]);
    expect(db.deferred).toHaveLength(1);
    await db.deferred[0]();
    expect(db.inserts).toEqual([{ tool_slug: "pip-forge", user_id: "user-1", event: "forge", access: "admin", props: { credits: 1, rung: 2 } }]);
  });

  it("keeps only lower-case snake keys with scalar values (a camelCase key was silently dropped: name them right)", async () => {
    recordToolEventLater({
      slug: "pip-forge",
      userId: "user-1",
      event: "forge_failed",
      access: "grant",
      props: { reason: "illegible", refunded: true, aiDisc: true, prompt: { text: "x" }, ms: 1234 },
    });
    await db.deferred[0]();
    expect(db.inserts[0].props).toEqual({ reason: "illegible", refunded: true, ms: 1234 });
  });

  it("schedules nothing without a service role", () => {
    db.admin = false;
    recordToolEventLater({ slug: "pip-forge", userId: "user-1", event: "forge", access: null });
    expect(db.deferred).toEqual([]);
  });
});

describe("a ceiling on one user's rows a minute", () => {
  const row = (userId: string | null, slug = "token-kit") => recordToolEvent({ slug, userId, event: "render_failed", access: "grant" });

  it("drops what a loop writes past it — and only that user's, only that tool's, only that minute's", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-10T12:00:10Z"));
      vi.spyOn(console, "warn").mockImplementation(() => {});
      for (let i = 0; i < TOOL_EVENTS_PER_MINUTE + 50; i += 1) await row("looper");
      expect(db.inserts).toHaveLength(TOOL_EVENTS_PER_MINUTE);
      // Said once, not fifty times.
      expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(1);
      // Another user, and the same user in another tool, are untouched.
      await row("someone-else");
      await row("looper", "pip-forge");
      expect(db.inserts).toHaveLength(TOOL_EVENTS_PER_MINUTE + 2);
      // The next minute starts again.
      vi.setSystemTime(new Date("2026-11-10T12:01:00Z"));
      await row("looper");
      expect(db.inserts).toHaveLength(TOOL_EVENTS_PER_MINUTE + 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("visitors' rows (no user) share a larger one per tool", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-10T13:00:10Z"));
      vi.spyOn(console, "warn").mockImplementation(() => {});
      for (let i = 0; i < ANONYMOUS_TOOL_EVENTS_PER_MINUTE + 5; i += 1) {
        await recordToolEvent({ slug: "rule0-sheet", userId: null, event: "shared_view", access: null });
      }
      expect(db.inserts).toHaveLength(ANONYMOUS_TOOL_EVENTS_PER_MINUTE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is far above what a person does: a hundred-card batch that all fails still records every card", () => {
    expect(TOOL_EVENTS_PER_MINUTE).toBeGreaterThanOrEqual(100);
  });
});

describe("no tool code waits for its own bookkeeping", () => {
  it("nothing outside the event writers awaits recordToolEvent", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/lib\/tools\/(events|client-events)\.ts$/.test(path)) {
          if (/await recordToolEvent\(/.test(readFileSync(path, "utf8"))) offenders.push(path);
        }
      }
    };
    for (const dir of ["app", "lib", "components"]) walk(dir);
    // The beacon's keeper awaits it (its request is nothing but the write).
    expect(offenders).toEqual([]);
  });
});

describe("what a tool's browser may record", () => {
  it("lists every tool, and only names the events table accepts", () => {
    expect(Object.keys(TOOL_CLIENT_EVENTS).sort()).toEqual(TOOL_CATALOG.map((tool) => tool.slug).sort());
    for (const events of Object.values(TOOL_CLIENT_EVENTS)) {
      for (const event of events) {
        expect(event).toMatch(TOOL_EVENT_RE);
        // The page's own visit is never the browser's to write.
        expect(event).not.toBe("open");
      }
    }
  });

  it("a listed event is recorded for a viewer the tool lets in, with the path that let them in", async () => {
    expect(await recordClientToolEvent("rule0-sheet", "copy_link")).toBe(true);
    expect(await recordClientToolEvent("token-kit", "kit_exported", { kind: "pdf", tokens: 12 })).toBe(true);
    expect(db.inserts.map((row) => [row.tool_slug, row.event, row.access, row.user_id, row.props])).toEqual([
      ["rule0-sheet", "copy_link", "grant", "user-1", {}],
      ["token-kit", "kit_exported", "grant", "user-1", { kind: "pdf", tokens: 12 }],
    ]);
  });

  it.each([
    ["the page's visit", "token-kit", "open"],
    ["a server action's event", "token-kit", "kit_built"],
    ["a paid action's event", "collection-builder", "ai_build"],
    ["a name of the tester's own", "token-kit", "used_a_lot"],
    ["another tool's browser event", "token-kit", "copy_link"],
    ["an unknown tool", "nope", "copy_link"],
    ["a slug that is no string", 7, "copy_link"],
    ["an event that is no string", "token-kit", { event: "kit_exported" }],
  ])("refuses %s", async (_label, slug, event) => {
    expect(isToolClientEvent(slug as string, event as string)).toBe(false);
    expect(await recordClientToolEvent(slug, event, { cards: 99 })).toBe(false);
    expect(db.inserts).toEqual([]);
  });

  it("refuses a viewer the tool does not let in, and a burst past the minute's limit", async () => {
    db.access = null;
    expect(await recordClientToolEvent("rule0-sheet", "copy_link")).toBe(false);
    db.access = { userId: "user-1", via: "grant" };
    db.countLastMinute = CLIENT_TOOL_EVENTS_PER_MINUTE;
    expect(await recordClientToolEvent("rule0-sheet", "copy_link")).toBe(false);
    expect(db.inserts).toEqual([]);
  });

  it("the limit counts the BROWSER's rows only — a batch's server rows never cost the run its closing event", async () => {
    await recordClientToolEvent("bulk-customize", "run_finished", { made: 60 });
    expect(db.filters).toContainEqual(["in", "event", [...TOOL_CLIENT_EVENTS["bulk-customize"]]]);
    expect(db.filters).toContainEqual(["eq", "user_id", "user-1"]);
    expect(db.filters).toContainEqual(["eq", "tool_slug", "bulk-customize"]);
  });

  it("what the browser says it spent is never the tool's cost: its `credits` is stored as `credits_seen`", async () => {
    expect(browserEventProps({ credits: 100000, made: 5 })).toEqual({ made: 5, credits_seen: 100000 });
    expect(browserEventProps({ made: 5 })).toEqual({ made: 5 });
    expect(browserEventProps(undefined)).toBeUndefined();
    await recordClientToolEvent("re-art-deck", "run_finished", { credits: 100000, painted: 5000 });
    // A reader that sums `credits` reads the server's rows alone.
    expect(db.inserts.at(-1)?.props).toEqual({ painted: 5000, credits_seen: 100000 });
  });

  it("answers whether a row was really written — false past the minute's ceiling or when the write fails", async () => {
    expect(await recordClientToolEvent("rule0-sheet", "print")).toBe(true);
    db.insertError = { message: "down" };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await recordClientToolEvent("rule0-sheet", "print")).toBe(false);
    expect(await recordToolEvent({ slug: "nope", userId: "user-1", event: "print", access: null })).toBe(false);
  });

  it("never throws: a deployment with no service role records nothing", async () => {
    db.admin = false;
    expect(await recordClientToolEvent("rule0-sheet", "copy_link")).toBe(false);
  });

  it("never throws: a log whose count cannot be read records nothing (never a row past an unread limit)", async () => {
    db.countError = { message: "down" };
    expect(await recordClientToolEvent("rule0-sheet", "copy_link")).toBe(false);
    expect(db.inserts).toEqual([]);
  });

  it("no tool's browser calls a server action to record an event", () => {
    // The action is gone; nothing may bring it back under another name.
    expect(readFileSync("lib/tools/actions.ts", "utf8")).not.toMatch(/recordToolEvent|trackToolEvent/);
  });
});

describe("a shared Rule 0 sheet's views", () => {
  const page = readFileSync("app/(marketing)/deck/[slug]/table-sheet/page.tsx", "utf8");

  it("counts a person's view only — no crawler, link unfurler or prefetch — and never under a user id", () => {
    expect(page).toMatch(/\} else if \(isCountableView\(await headers\(\)\)\) \{\s+recordToolEventLater\(\{ slug: RULE0_TOOL_SLUG, userId: null, event: "shared_view", access: null, props: sheetProps \}\);/);
  });

  it("the owner's view is a visit of the tool: one open a visit, after the response", () => {
    expect(page).toMatch(/afterResponse\(\(\) => recordToolOpen\(\{ slug: RULE0_TOOL_SLUG, userId: ownerId, access: via, props: sheetProps \}\)\);/);
    expect(page).not.toMatch(/event: isOwner \? "open"/);
  });
});
