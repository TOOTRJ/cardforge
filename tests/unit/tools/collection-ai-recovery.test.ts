import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// A paid Collection AI call whose response was lost (the 2026-11-10 tools
// audit and its two reviews, migration 0198).
//
// "Build with AI" and "Suggest a commander" save nothing and settle their
// credit as soon as the answer exists — a response that never arrived was
// paid for and gone, while the page said the credit "comes back by itself".
// Now the route writes what became of each request: `running` BEFORE
// anything is charged (and refuses a call it can't record), the answer as
// `done` BEFORE the credit is settled (and settles only what it kept),
// `refused` / `failed` otherwise. The page that lost its response asks, and
// says exactly what happened — "no record" can only mean "never reached us".
// Held here: the table, the writer, the route that answers, the page's
// asking. The two route tests hold where the routes call the writer.
// ---------------------------------------------------------------------------

type Filter = [string, string, unknown];
type Op = { op: "upsert" | "update" | "delete"; row?: Record<string, unknown>; options?: unknown; filters: Filter[] };

const db = vi.hoisted(() => ({
  admin: true,
  ops: [] as Array<{ op: "upsert" | "update" | "delete"; row?: Record<string, unknown>; options?: unknown; filters: Array<[string, string, unknown]> }>,
  /** Errors handed to successive upserts (then none). */
  upsertErrors: [] as Array<null | { code?: string; message: string }>,
  updateError: null as null | { code?: string; message: string },
  filters: [] as Array<[string, string, unknown]>,
  row: null as null | { status: string; result: unknown },
  readError: null as null | { message: string },
  access: { userId: "u1", via: "grant" } as null | { userId: string; via: string },
  signedIn: true,
  events: [] as Array<Record<string, unknown>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentUser: async () => (db.signedIn ? { id: "u1" } : null) }));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => db.admin,
  createAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("collection_ai_results");
      let write: Op | null = null;
      const chain: Record<string, unknown> = {
        upsert: async (row: Record<string, unknown>, options: unknown) => {
          db.ops.push({ op: "upsert", row, options, filters: [] });
          return { error: db.upsertErrors.shift() ?? null };
        },
        update: (row: Record<string, unknown>) => {
          write = { op: "update", row, filters: [] };
          db.ops.push(write);
          return chain;
        },
        delete: () => {
          write = { op: "delete", filters: [] };
          db.ops.push(write);
          return chain;
        },
        select: () => chain,
        eq: (column: string, value: unknown) => {
          (write ? write.filters : db.filters).push(["eq", column, value]);
          return chain;
        },
        lt: (column: string, value: unknown) => {
          (write ? write.filters : db.filters).push(["lt", column, value]);
          return chain;
        },
        maybeSingle: async () => ({ data: db.row, error: db.readError }),
        // An awaited update / delete.
        then: (resolve: (value: unknown) => void) => resolve({ error: write?.op === "update" ? db.updateError : null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: async () => db.access }));
vi.mock("@/lib/tools/events", () => ({ recordToolEventLater: (input: Record<string, unknown>) => void db.events.push(input) }));
vi.mock("@/lib/ai/rate-limit", () => ({ getFreshCreditBalance: async () => 4 }));

import {
  COLLECTION_AI_RESULT_DAYS,
  COLLECTION_AI_TRIM_AFTER_MS,
  endCollectionAiResult,
  keepCollectionAiResult,
  readCollectionAiResult,
  startCollectionAiResult,
  withCollectionAiRecord,
} from "@/lib/tools/collection/ai-results";
import { GET } from "@/app/api/tools/collection-builder/ai-result/route";
import {
  AI_ANSWER_CHECKING,
  AI_RECOVER_BLIND_ASKS,
  AI_RECOVER_EVERY_MS,
  AI_RECOVER_NONE_AFTER_MS,
  AI_RECOVER_UNTIL_MS,
  aiRecoveryMessage,
  aiResultHref,
  newAiRequestId,
  recoverAiAnswer,
} from "@/lib/tools/collection/ai-recover";

const REQUEST = "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b";
const upserts = () => db.ops.filter((op) => op.op === "upsert");

beforeEach(() => {
  db.admin = true;
  db.ops = [];
  db.upsertErrors = [];
  db.updateError = null;
  db.filters = [];
  db.row = null;
  db.readError = null;
  db.access = { userId: "u1", via: "grant" };
  db.signedIn = true;
  db.events = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("0198 — the table", () => {
  const sql = readFileSync("supabase/migrations/0198_collection_ai_results.sql", "utf8");

  it("keeps ONE row per request (overlapping calls never take each other's), in four states, going with the account", () => {
    expect(sql).toMatch(/create table if not exists public\.collection_ai_results/);
    expect(sql).toMatch(/user_id uuid not null references public\.profiles \(id\) on delete cascade/);
    expect(sql).toMatch(/request_id uuid not null/);
    expect(sql).toMatch(/kind text not null check \(kind in \('build', 'suggest'\)\)/);
    expect(sql).toMatch(/status text not null check \(status in \('running', 'refused', 'done', 'failed'\)\)/);
    expect(sql).toMatch(/primary key \(user_id, request_id\)/);
    // An answer exactly when the call is done.
    expect(sql).toMatch(/check \(\(status = 'done'\) = \(result is not null\)\)/);
  });

  it("is the service role's alone: RLS on, no policy, the API roles revoked, the grant stated", () => {
    expect(sql).toMatch(/alter table public\.collection_ai_results enable row level security;/);
    expect(sql).not.toMatch(/create policy/);
    expect(sql).toMatch(/revoke all on public\.collection_ai_results from public, anon, authenticated;/);
    expect(sql).toMatch(/grant select, insert, update, delete on public\.collection_ai_results to service_role;/);
    expect(sql).not.toMatch(/grant [^;]*\b(anon|authenticated)\b/);
  });

  it("needs no transaction of its own: no top-level LOCK, BEGIN or COMMIT (the runner sends statements one at a time)", () => {
    expect(sql.replace(/^--.*$/gm, "")).not.toMatch(/^\s*(lock table|begin;|commit;)/im);
  });

  it("is pruned by the weekly cron, and a database without it never fails the run", () => {
    const cron = readFileSync("app/api/cron/prune-funnel-events/route.ts", "utf8");
    expect(COLLECTION_AI_RESULT_DAYS).toBe(7);
    expect(cron).toMatch(/from\("collection_ai_results"\)\.delete\(\{ count: "exact" \}\)\.lt\("created_at", aiResultCutoff\)/);
    expect(cron).toMatch(/\["PGRST205", "42P01"\]\.includes\(aiResults\.error\.code/);
  });
});

describe("start — the request on record before anything is charged", () => {
  it("writes its own row as running, then drops the user's rows of that kind older than an hour", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
      expect(await startCollectionAiResult("u1", "build", REQUEST)).toBe("started");
      expect(db.ops[0]).toMatchObject({
        op: "upsert",
        row: { user_id: "u1", request_id: REQUEST, kind: "build", status: "running", result: null },
        options: { onConflict: "user_id,request_id" },
      });
      expect(db.ops[1]).toMatchObject({ op: "delete" });
      expect(db.ops[1]!.filters).toEqual([
        ["eq", "user_id", "u1"],
        ["eq", "kind", "build"],
        ["lt", "created_at", "2026-11-11T11:00:00.000Z"],
      ]);
      // A page stops asking long before an hour is up.
      expect(COLLECTION_AI_TRIM_AFTER_MS).toBeGreaterThan(10 * 60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a write that FAILS says so — the route refuses the call: a request that may be charged always has a row", async () => {
    db.upsertErrors = [{ message: "connection reset" }];
    expect(await startCollectionAiResult("u1", "build", REQUEST)).toBe("failed");
  });

  it("a table that is not there yet (the app deployed first) and a deployment with no service role go on as before", async () => {
    db.upsertErrors = [{ code: "PGRST205", message: "Could not find the table" }];
    expect(await startCollectionAiResult("u1", "build", REQUEST)).toBe("unavailable");
    db.admin = false;
    expect(await startCollectionAiResult("u1", "build", REQUEST)).toBe("unavailable");
  });

  it.each([
    ["no id (a page from before this)", undefined],
    ["a null id", null],
    ["an id that is no uuid", "abc"],
  ])("%s is skipped: nothing to record, nothing to ask for again", async (_label, id) => {
    expect(await startCollectionAiResult("u1", "suggest", id)).toBe("skipped");
    expect(await keepCollectionAiResult("u1", "suggest", id, { overview: "x" })).toBe("skipped");
    await endCollectionAiResult("u1", "suggest", id, "failed");
    expect(db.ops).toEqual([]);
  });
});

describe("keep — the answer, before the credit is settled", () => {
  it("writes the request's row as done with its answer", async () => {
    expect(await keepCollectionAiResult("u1", "build", REQUEST, { draft: { total: 100 }, truncated: false })).toBe("kept");
    expect(upserts()).toHaveLength(1);
    expect(upserts()[0]).toMatchObject({ row: { request_id: REQUEST, status: "done", result: { draft: { total: 100 }, truncated: false } }, options: { onConflict: "user_id,request_id" } });
  });

  it("is tried twice: one failed write does not lose a paid answer", async () => {
    db.upsertErrors = [{ message: "timeout" }];
    expect(await keepCollectionAiResult("u1", "build", REQUEST, { draft: {} })).toBe("kept");
    expect(upserts()).toHaveLength(2);
  });

  it("says FAILED when it could not be kept — the route then leaves the credit unsettled", async () => {
    db.upsertErrors = [{ message: "timeout" }, { message: "timeout" }];
    expect(await keepCollectionAiResult("u1", "build", REQUEST, { draft: {} })).toBe("failed");
    expect(upserts()).toHaveLength(2);
  });

  it("with nothing to keep it in (no table yet, no service role) it is skipped: settled as before this existed", async () => {
    db.upsertErrors = [{ code: "42P01", message: "relation does not exist" }];
    expect(await keepCollectionAiResult("u1", "build", REQUEST, {})).toBe("skipped");
    db.admin = false;
    expect(await keepCollectionAiResult("u1", "build", REQUEST, {})).toBe("skipped");
  });
});

describe("end — refused or failed, on its own row only", () => {
  it("names the request, and never overwrites an answer already kept", async () => {
    await endCollectionAiResult("u1", "suggest", REQUEST, "failed");
    expect(db.ops[0]).toMatchObject({ op: "update", row: { status: "failed", result: null } });
    expect(db.ops[0]!.filters).toEqual([
      ["eq", "user_id", "u1"],
      ["eq", "request_id", REQUEST],
      ["eq", "status", "running"],
    ]);
    await endCollectionAiResult("u1", "suggest", REQUEST, "refused");
    expect(db.ops[1]).toMatchObject({ op: "update", row: { status: "refused", result: null } });
  });

  it("never throws", async () => {
    db.updateError = { message: "down" };
    await expect(endCollectionAiResult("u1", "build", REQUEST, "refused")).resolves.toBeUndefined();
  });
});

describe("withCollectionAiRecord — every way out of a paid route ends its row", () => {
  const ended = () => db.ops.filter((op) => op.op === "update").map((op) => op.row?.status);
  const ok = () => new Response("ok");

  it("a return that wrote no ending before the charge is `refused`", async () => {
    await withCollectionAiRecord("build", async (call) => {
      call.userId = "u1";
      call.requestId = REQUEST;
      return ok();
    });
    expect(ended()).toEqual(["refused"]);
  });

  it("…after the charge it is `failed` (never settled: the sweep returns the credit) — a throw too, which still propagates", async () => {
    await expect(
      withCollectionAiRecord("build", async (call) => {
        call.userId = "u1";
        call.requestId = REQUEST;
        call.charged = true;
        throw new Error("nobody caught this");
      }),
    ).rejects.toThrow("nobody caught this");
    expect(ended()).toEqual(["failed"]);
  });

  it("a route that wrote its own ending, a request not on record and a viewer not let in write nothing", async () => {
    await withCollectionAiRecord("build", async (call) => {
      call.userId = "u1";
      call.requestId = REQUEST;
      call.charged = true;
      call.ended = true;
      return ok();
    });
    await withCollectionAiRecord("build", async (call) => {
      call.userId = "u1";
      return ok();
    });
    await withCollectionAiRecord("build", async () => ok());
    expect(db.ops).toEqual([]);
  });
});

describe("reading it back", () => {
  it("asks for THIS user's row of THIS request and THIS kind", async () => {
    db.row = { status: "done", result: { draft: { total: 100 } } };
    expect(await readCollectionAiResult("u1", "build", REQUEST)).toEqual({ state: "done", result: { draft: { total: 100 } } });
    expect(db.filters).toEqual([
      ["eq", "user_id", "u1"],
      ["eq", "request_id", REQUEST],
      ["eq", "kind", "build"],
    ]);
  });

  it.each(["running", "refused", "failed"])("tells %s apart", async (status) => {
    db.row = { status, result: null };
    expect(await readCollectionAiResult("u1", "build", REQUEST)).toEqual({ state: status });
  });

  it("no row is `none`", async () => {
    expect(await readCollectionAiResult("u1", "build", REQUEST)).toEqual({ state: "none" });
  });

  it("answers null — ask again — for an unreadable table, a done row with no object and an id that is no uuid: never 'no record'", async () => {
    db.readError = { message: "down" };
    expect(await readCollectionAiResult("u1", "build", REQUEST)).toBeNull();
    db.readError = null;
    db.row = { status: "done", result: ["not", "an", "object"] };
    expect(await readCollectionAiResult("u1", "build", REQUEST)).toBeNull();
    db.filters = [];
    expect(await readCollectionAiResult("u1", "build", "nope")).toBeNull();
    expect(db.filters).toEqual([]);
  });
});

describe("GET /api/tools/collection-builder/ai-result", () => {
  const get = (query: string) => GET(new Request(`http://x/api/tools/collection-builder/ai-result${query}`));

  it("hands the viewer's kept answer back with their balance, never cached, and records the recovery", async () => {
    db.row = { status: "done", result: { draft: { total: 100 }, truncated: true } };
    const response = await get(`?kind=build&request=${REQUEST}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, state: "done", result: { draft: { total: 100 }, truncated: true }, credits: 4 });
    expect(db.filters).toContainEqual(["eq", "user_id", "u1"]);
    expect(db.events).toEqual([expect.objectContaining({ slug: "collection-builder", userId: "u1", event: "ai_recovered", access: "grant", props: { kind: "build" } })]);
  });

  it.each(["running", "failed", "refused"])("says %s with the balance as it is now — and records nothing", async (status) => {
    db.row = { status, result: null };
    expect(await (await get(`?kind=suggest&request=${REQUEST}`)).json()).toEqual({ ok: true, state: status, credits: 4 });
    expect(db.events).toEqual([]);
  });

  it("says no record when there is none", async () => {
    expect(await (await get(`?kind=suggest&request=${REQUEST}`)).json()).toEqual({ ok: true, state: "none", credits: 4 });
  });

  it("a read that failed here is a 503 (asked again) — never 'no record', which the page reads as 'nothing was charged'", async () => {
    db.readError = { message: "down" };
    const response = await get(`?kind=build&request=${REQUEST}`);
    expect(response.status).toBe(503);
    expect((await response.json()).state).toBeUndefined();
  });

  it("is the tool's gate: 401 signed out, 404 not let in, 400 for a kind or an id it can't read — nothing of the answer in any", async () => {
    expect((await get("?kind=deck&request=" + REQUEST)).status).toBe(400);
    expect((await get("?kind=build&request=1")).status).toBe(400);
    expect((await get("?kind=build")).status).toBe(400);
    db.row = { status: "done", result: { draft: {} } };
    db.access = null;
    const closed = await get(`?kind=build&request=${REQUEST}`);
    expect(closed.status).toBe(404);
    expect(JSON.stringify(await closed.json())).not.toMatch(/draft/);
    db.signedIn = false;
    expect((await get(`?kind=build&request=${REQUEST}`)).status).toBe(401);
  });
});

describe("the page asking again", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const html = () => new Response("<html>Sign in to the hotel wifi</html>", { status: 200, headers: { "content-type": "text/html" } });
  type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

  function clock(start = 1_000) {
    let at = start;
    return {
      now: () => at,
      sleep: async (ms: number) => {
        at += ms;
      },
      advance: (ms: number) => {
        at += ms;
      },
    };
  }
  type Clock = Pick<ReturnType<typeof clock>, "now" | "sleep">;
  const ask = <T>(kind: "build" | "suggest", startedAt: number, fetchImpl: Fetch, time: Clock, more: { signal?: AbortSignal; onReach?: (reached: boolean) => void } = {}) =>
    recoverAiAnswer<T>(kind, REQUEST, startedAt, { fetchImpl: fetchImpl as unknown as typeof fetch, now: time.now, sleep: time.sleep, ...more });
  /** Answers in order, then the last one for ever. */
  const answering = (...responses: Array<() => Response>) => {
    let i = 0;
    return vi.fn<Fetch>(async () => responses[Math.min(i++, responses.length - 1)]!());
  };
  const state = (value: string, more: Record<string, unknown> = {}) => () => json({ ok: true, state: value, credits: 3, ...more });

  it("makes a request id, and asks by it", () => {
    expect(newAiRequestId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(aiResultHref("build", REQUEST)).toBe(`/api/tools/collection-builder/ai-result?kind=build&request=${REQUEST}`);
  });

  it("done: returns the answer as soon as it is there — the route was still running when the connection dropped", async () => {
    const time = clock();
    const fetchImpl = answering(state("running"), state("running"), state("done", { result: { draft: { total: 100 } } }));
    expect(await ask("build", time.now(), fetchImpl, time)).toEqual({ state: "done", result: { draft: { total: 100 } }, credits: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0]![0]).toBe(aiResultHref("build", REQUEST));
  });

  it.each(["failed", "refused"] as const)("%s: said at once, with the balance", async (value) => {
    const time = clock();
    const fetchImpl = answering(state(value));
    expect(await ask("build", time.now(), fetchImpl, time)).toEqual({ state: value, credits: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("none: 'no record' is believed only once the request has had time to reach the route", async () => {
    const time = clock();
    const startedAt = time.now();
    expect(await ask("build", startedAt, answering(state("none")), time)).toEqual({ state: "none", credits: 3 });
    expect(time.now() - startedAt).toBeGreaterThanOrEqual(AI_RECOVER_NONE_AFTER_MS);
    expect(time.now() - startedAt).toBeLessThan(AI_RECOVER_NONE_AFTER_MS + AI_RECOVER_EVERY_MS);
    // …so a request that never left the browser is answered in seconds, not the call's two minutes.
    expect(AI_RECOVER_NONE_AFTER_MS).toBeLessThanOrEqual(30_000);
  });

  it("unfinished: the server STILL says running when the call can no longer be — its credit was never settled", async () => {
    const time = clock();
    const startedAt = time.now();
    expect(await ask("suggest", startedAt, answering(state("running")), time)).toEqual({ state: "unfinished", credits: 3 });
    expect(time.now() - startedAt).toBeGreaterThanOrEqual(AI_RECOVER_UNTIL_MS - AI_RECOVER_EVERY_MS);
    expect(time.now() - startedAt).toBeLessThanOrEqual(AI_RECOVER_UNTIL_MS);
  });

  it("never decides 'unfinished' from an old 'running': after it, asks that tell nothing (a 503, a captive portal's page) decide nothing — the answer is found when one gets through", async () => {
    const time = clock();
    const startedAt = time.now();
    // "running" once at 0 s; then 40 asks (200 s, well past the deadline) that tell nothing; then the truth.
    const responses = [state("running"), ...Array.from({ length: 20 }, () => () => json({ ok: false }, 503)), ...Array.from({ length: 20 }, () => html), state("done", { result: { draft: { total: 7 } } })];
    expect(await ask<{ draft: { total: number } }>("build", startedAt, answering(...responses), time)).toEqual({
      state: "done",
      result: { draft: { total: 7 } },
      credits: 3,
    });
    expect(time.now() - startedAt).toBeGreaterThan(AI_RECOVER_UNTIL_MS);
  });

  it("a row that was running and is gone was trimmed: unknown, never 'nothing was charged'", async () => {
    const time = clock();
    time.advance(AI_RECOVER_NONE_AFTER_MS);
    expect(await ask("build", 1_000, answering(state("running"), state("none")), time)).toEqual({ state: "unknown", credits: 3 });
  });

  it("an offline browser keeps checking, says so, and has its answer on the first ask that gets through — however long it was away", async () => {
    const time = clock();
    const startedAt = time.now();
    let online = false;
    const reach: boolean[] = [];
    const fetchImpl = vi.fn<Fetch>(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return json({ ok: true, state: "done", result: { draft: { total: 99 } }, credits: 2 });
    });
    const recovered = await ask<{ draft: { total: number } }>(
      "build",
      startedAt,
      fetchImpl,
      {
        now: time.now,
        sleep: async (ms: number) => {
          time.advance(ms);
          // The lid was closed for an hour after a minute of asking: no asks meanwhile, none lost.
          if (time.now() - startedAt > 60_000 && !online) {
            time.advance(60 * 60_000);
            online = true;
          }
        },
      },
      { onReach: (reached) => reach.push(reached) },
    );
    expect(recovered).toEqual({ state: "done", result: { draft: { total: 99 } }, credits: 2 });
    // Said once each way, not once an ask.
    expect(reach).toEqual([false, true]);
  });

  it("…but not for ever: unknown after AI_RECOVER_BLIND_ASKS asks that told nothing", async () => {
    const time = clock();
    const fetchImpl = vi.fn<Fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await ask("build", time.now(), fetchImpl, time)).toEqual({ state: "unknown", credits: null });
    expect(fetchImpl).toHaveBeenCalledTimes(AI_RECOVER_BLIND_ASKS);
    // Ten minutes of them while the page is awake.
    expect(AI_RECOVER_BLIND_ASKS * AI_RECOVER_EVERY_MS).toBe(10 * 60_000);
  });

  it("ONE 401 or 404 does not end it (a failed read looks the same); three in a row do, and anything else in between starts the count again", async () => {
    const time = clock();
    const refuse = (status: number) => () => json({ ok: false }, status);
    expect((await ask("build", time.now(), answering(refuse(404), state("done", { result: { draft: {} } })), time)).state).toBe("done");

    const refused = answering(refuse(401));
    expect(await ask("build", time.now(), refused, time)).toEqual({ state: "unknown", credits: null });
    expect(refused).toHaveBeenCalledTimes(3);

    const broken = answering(refuse(401), refuse(401), refuse(503), refuse(401), state("done", { result: { draft: {} } }));
    expect((await ask("build", time.now(), broken, time)).state).toBe("done");
  });

  it("a request it can't name (400) and no request id are unknown at once", async () => {
    const time = clock();
    const fetchImpl = answering(() => json({ ok: false }, 400));
    expect(await ask("build", time.now(), fetchImpl, time)).toEqual({ state: "unknown", credits: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const none = vi.fn();
    expect(await recoverAiAnswer("build", null, 0, { fetchImpl: none as unknown as typeof fetch })).toEqual({ state: "unknown", credits: null });
    expect(none).not.toHaveBeenCalled();
  });

  it("stops when the page goes away — before asking, and between asks", async () => {
    const fetchImpl = answering(state("running"));
    const time = clock();
    expect(await ask("build", 0, fetchImpl, time, { signal: AbortSignal.abort() })).toEqual({ state: "aborted" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const gone = new AbortController();
    expect(await ask("build", time.now(), fetchImpl, { now: time.now, sleep: async () => gone.abort() }, { signal: gone.signal })).toEqual({ state: "aborted" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("says only what is true of each outcome", () => {
    // Failed: the route refunds there (or leaves it to the sweep).
    expect(aiRecoveryMessage("build", "failed")).toBe("The AI build failed. The credit it took was returned, or comes back by itself within the hour.");
    // Refused, and no record: nothing was charged — a request is on record before any charge.
    expect(aiRecoveryMessage("build", "refused")).toBe("The AI build was turned down before anything was made, and nothing was charged. Try again.");
    expect(aiRecoveryMessage("build", "none")).toBe("We have no record of that request, so nothing was made and nothing was charged for it. Check your connection and try again.");
    // Unfinished: unsettled, so the sweep returns it.
    expect(aiRecoveryMessage("suggest", "unfinished")).toBe("The suggestions didn't finish. The credit it took comes back by itself within the hour.");
    // Unknown: nothing is asserted that could be false.
    expect(aiRecoveryMessage("build", "unknown")).toBe("We couldn't check whether the AI build finished. If a credit was taken and nothing was made, it comes back by itself within the hour.");
    expect(aiRecoveryMessage("suggest", "unknown")).toMatch(/^We couldn't check whether the suggestions finished\./);
    // While it asks — and while it can't, it does not promise "two minutes".
    expect(AI_ANSWER_CHECKING("build")).toMatch(/Checking whether the AI build finished\. This can take up to two minutes\./);
    expect(AI_ANSWER_CHECKING("build", true)).toBe("You seem to be offline. This page will check whether the AI build finished as soon as the connection is back.");
    // The sweep's own numbers behind "within the hour": 15 minutes' grace, a run every 30.
    expect(readFileSync("lib/billing/credit-reconcile.ts", "utf8")).toMatch(/RECONCILE_GRACE_MS = 15 \* 60_000/);
    expect(readFileSync("vercel.json", "utf8")).toMatch(/"path": "\/api\/cron\/reconcile-credits",\s+"schedule": "\*\/30 \* \* \* \*"/);
  });
});
