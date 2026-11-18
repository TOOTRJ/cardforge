import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Re-art deck — the doors of a run the server carries on (migration 0218):
//
//   * handReartRunToServerAction — the maker's "Keep painting if I close
//     this page": the tool's gate, the caller's OWN running Re-art job and
//     deck, and the one moment the server is given a sign-in to borrow. The
//     session is refreshed HERE (the maker's own request, where the rotated
//     cookies reach their browser) unless its token is fresh already — on
//     a COPY of the cookies, so a refresh that fails never signs the maker
//     out — and nowhere else: a driver never refreshes. This request is the
//     run's FIRST DRIVER, after its response.
//   * POST /api/tools/re-art-deck/stop-background — the maker's Stop: a
//     plain route (an action can wait behind a navigation and be lost),
//     sent with keepalive.
//   * GET /api/cron/reart-background — the driver every minute after that,
//     behind the cron's guard. There is no route that calls itself.
//
// The driver itself is re-art-background.test.ts.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  access: null as { userId: string; via: string } | null,
  job: null as Record<string, unknown> | null,
  jobFilters: [] as Array<[string, unknown]>,
  deck: null as { id: string } | null,
  session: null as { access_token: string } | null,
  /** The session library's own refresh on the request's client: never to be called. */
  directRefresh: vi.fn(),
  cookieStore: { getAll: () => [], set: () => undefined },
  refresh: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  drive: vi.fn(),
  after: [] as Array<() => unknown>,
  events: vi.fn(),
  revalidate: vi.fn(),
  host: "pipglyph.example" as string | null,
  adminConfigured: true,
  cronBlocked: null as Response | null,
  cronGuard: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate, revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    m.after.push(task);
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => (name === "host" ? m.host : name === "x-forwarded-proto" ? "https" : null) }),
  cookies: async () => m.cookieStore,
}));
vi.mock("@/lib/tools/re-art/session-refresh", () => ({ refreshSessionOnACopy: m.refresh }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => m.adminConfigured }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          if (table === "ai_generation_jobs") m.jobFilters.push([column, value]);
          return chain;
        },
        maybeSingle: async () => ({ data: table === "ai_generation_jobs" ? m.job : null, error: null }),
      };
      return chain;
    },
    auth: {
      getSession: async () => ({ data: { session: m.session } }),
      refreshSession: m.directRefresh,
    },
  }),
}));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: async () => m.access }));
vi.mock("@/lib/tools/events", () => ({ recordToolEventLater: m.events }));
vi.mock("@/lib/tools/re-art/server", () => ({ getOwnedDeck: async () => m.deck }));
vi.mock("@/lib/api/cron-auth", () => ({
  cronRouteGuard: (request: Request) => {
    m.cronGuard(request);
    return m.cronBlocked;
  },
}));
vi.mock("@/lib/tools/re-art/background", async (original) => {
  const real = await original<typeof import("@/lib/tools/re-art/background")>();
  return {
    FRESH_TOKEN_S: real.FRESH_TOKEN_S,
    KICK_MS: real.KICK_MS,
    SWEEP_MS: real.SWEEP_MS,
    kickMs: real.kickMs,
    tokenSecondsLeft: real.tokenSecondsLeft,
    startBackground: m.start,
    requestBackgroundStop: m.stop,
    driveBackgroundRuns: m.drive,
  };
});

import { handReartRunToServerAction } from "@/lib/tools/re-art/background-actions";
import * as backgroundActions from "@/lib/tools/re-art/background-actions";
import { POST as stopRoute } from "@/app/api/tools/re-art-deck/stop-background/route";
import { REART_STOP_BACKGROUND_ENDPOINT, requestReartBackgroundStop } from "@/lib/tools/re-art/background-client";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GET as cronRoute, maxDuration as cronMaxDuration } from "@/app/api/cron/reart-background/route";
import { KICK_MS, SWEEP_MS } from "@/lib/tools/re-art/background";
import { REART_BACKGROUND_UNAVAILABLE } from "@/lib/tools/re-art/model";
import { isToolClientEvent, toolEventKind } from "@/lib/tools/catalog";

const ME = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const DECK = "33333333-3333-4333-8333-333333333333";
/** An access token with `seconds` left. */
const token = (seconds: number) =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds })).toString("base64url")}.sig`;
const eventsNamed = (name: string) => m.events.mock.calls.map(([event]) => event).filter((event) => event.event === name);
const STEPS = [
  { key: "reart:0", status: "done" },
  { key: "reart:1", status: "pending" },
];
const HEADERS = { "content-type": "application/json", cookie: "the-session-cookie" };

beforeEach(() => {
  for (const fn of [m.refresh, m.directRefresh, m.start, m.stop, m.drive, m.events, m.revalidate, m.cronGuard]) fn.mockReset();
  m.refresh.mockResolvedValue(null);
  m.after.length = 0;
  m.access = { userId: ME, via: "tester" };
  m.job = { id: JOB, owner_id: ME, kind: "deck_reart", status: "generating", request: { deck_id: DECK }, steps: STEPS };
  m.jobFilters = [];
  m.deck = { id: DECK };
  m.session = { access_token: token(3500) };
  m.host = "pipglyph.example";
  m.adminConfigured = true;
  m.cronBlocked = null;
  m.start.mockResolvedValue({ ok: true, state: "started", headers: HEADERS, origin: "https://www.pipglyph.example" });
  m.stop.mockResolvedValue(true);
  m.drive.mockResolvedValue({ runs: 0, asked: 0, ended: 0 });
});

describe("handReartRunToServerAction", () => {
  it("a closed tool hands nothing over, and reads nothing", async () => {
    m.access = null;
    expect(await handReartRunToServerAction(JOB)).toEqual({ ok: false, error: "Re-art deck isn't open to you." });
    expect(m.start).not.toHaveBeenCalled();
    expect(m.jobFilters).toEqual([]);
    expect(m.events).not.toHaveBeenCalled();
  });

  it("only a job id is read", async () => {
    for (const bad of [null, 12, "", "job-1", { id: JOB }]) expect(await handReartRunToServerAction(bad)).toEqual({ ok: false, error: "That run couldn't be read." });
    expect(m.start).not.toHaveBeenCalled();
  });

  it("the run is the CALLER's own Re-art job — asked for by owner and kind — on a deck that is still theirs", async () => {
    await handReartRunToServerAction(JOB);
    expect(m.jobFilters).toEqual([
      ["id", JOB],
      ["owner_id", ME],
      ["kind", "deck_reart"],
    ]);
    m.job = null;
    expect(await handReartRunToServerAction(JOB)).toEqual({ ok: false, error: "That run isn't one of yours." });
    // A job that names no deck is no Re-art run.
    m.job = { id: JOB, owner_id: ME, kind: "deck_reart", status: "generating", request: {}, steps: STEPS };
    expect(await handReartRunToServerAction(JOB)).toEqual({ ok: false, error: "That run isn't one of yours." });
    m.job = { id: JOB, owner_id: ME, kind: "deck_reart", status: "generating", request: { deck_id: DECK }, steps: STEPS };
    m.deck = null;
    expect(await handReartRunToServerAction(JOB)).toEqual({ ok: false, error: "That run's deck isn't one of yours any more." });
    expect(m.start).toHaveBeenCalledTimes(1);
  });

  it("a run that is over is not handed over", async () => {
    for (const status of ["done", "done_with_errors", "cancelled", "failed"]) {
      m.job = { id: JOB, owner_id: ME, kind: "deck_reart", status, request: { deck_id: DECK } };
      expect(await handReartRunToServerAction(JOB)).toEqual({ ok: false, error: REART_BACKGROUND_UNAVAILABLE });
    }
    expect(m.start).not.toHaveBeenCalled();
    expect(m.after).toEqual([]);
    expect(eventsNamed("background_start_failed").map((event) => event.props)).toEqual(Array.from({ length: 4 }, () => ({ reason: "not_running" })));
  });

  it("a fresh token is borrowed as it is: no refresh — the maker's session is not touched", async () => {
    const held = token(50 * 60);
    m.session = { access_token: held };
    expect(await handReartRunToServerAction(JOB)).toEqual({ ok: true, state: "started" });
    expect(m.refresh).not.toHaveBeenCalled();
    // The run's own steps go with it (the cards that had already failed on a plan limit are remembered).
    expect(m.start).toHaveBeenCalledWith({ userId: ME, jobId: JOB, deckId: DECK, accessToken: held, steps: STEPS, requestUrl: "https://pipglyph.example/", first: false });
  });

  it("a token with less than three quarters of an hour left is refreshed HERE, in the maker's own request — on a COPY of its cookies — and the new one is what the server borrows", async () => {
    m.session = { access_token: token(20 * 60) };
    const fresh = token(3600);
    m.refresh.mockResolvedValue(fresh);
    expect(await handReartRunToServerAction(JOB)).toEqual({ ok: true, state: "started" });
    expect(m.refresh).toHaveBeenCalledTimes(1);
    // Handed the request's own cookie store (it writes there only on success)…
    expect(m.refresh).toHaveBeenCalledWith(m.cookieStore);
    // …and the session library's refresh on the request's client is NEVER
    // used: a refusal there removes the session and signs the maker out.
    expect(m.directRefresh).not.toHaveBeenCalled();
    expect(m.start.mock.calls[0][0].accessToken).toBe(fresh);
    // The log is told how long the chain has, in whole minutes — never the token.
    expect(eventsNamed("background_start")).toEqual([{ slug: "re-art-deck", userId: ME, event: "background_start", access: "tester", props: { minutes: 59 } }]);
    expect(JSON.stringify(m.events.mock.calls)).not.toContain(fresh.slice(0, 20));
  });

  it("a refresh that fails leaves the token it had: the run simply has less time — and the maker is not signed out", async () => {
    const held = token(20 * 60);
    m.session = { access_token: held };
    m.refresh.mockResolvedValue(null);
    expect(await handReartRunToServerAction(JOB)).toEqual({ ok: true, state: "started" });
    expect(m.start.mock.calls[0][0].accessToken).toBe(held);
    expect(m.directRefresh).not.toHaveBeenCalled();
  });

  it("no session at all: refused in the page's words, nothing started", async () => {
    m.session = null;
    expect(await handReartRunToServerAction(JOB)).toEqual({ ok: false, error: REART_BACKGROUND_UNAVAILABLE });
    expect(m.start).not.toHaveBeenCalled();
    // Nothing to refresh: nothing is tried.
    expect(m.refresh).not.toHaveBeenCalled();
    expect(eventsNamed("background_start_failed")[0].props).toEqual({ reason: "no_session" });
  });

  it("a hand-over the server can't make is one sentence for the maker and a reason code for the log", async () => {
    for (const reason of ["unreachable", "unavailable", "not_saved", "no_session"]) {
      m.events.mockClear();
      m.start.mockResolvedValue({ ok: false, reason });
      expect(await handReartRunToServerAction(JOB)).toEqual({ ok: false, error: REART_BACKGROUND_UNAVAILABLE });
      expect(eventsNamed("background_start_failed").map((event) => event.props)).toEqual([{ reason }]);
      expect(eventsNamed("background_start")).toEqual([]);
    }
    // Nothing is driven, and the page is not read again for nothing.
    expect(m.after).toEqual([]);
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it("says whether this is the run's FIRST hand-over (only a literal true counts): a first one is refused on a run already stopped", async () => {
    await handReartRunToServerAction(JOB, true);
    expect(m.start.mock.calls[0][0].first).toBe(true);
    for (const other of [undefined, false, "true", 1, {}]) {
      m.start.mockClear();
      await handReartRunToServerAction(JOB, other);
      expect(m.start.mock.calls[0][0].first, String(other)).toBe(false);
    }
  });

  it("a hand-over that arrives after its maker's Stop is THEIR action, not a failure: nothing is logged as one, nothing is driven", async () => {
    m.start.mockResolvedValue({ ok: false, reason: "stopped" });
    expect(await handReartRunToServerAction(JOB, true)).toEqual({ ok: false, error: REART_BACKGROUND_UNAVAILABLE });
    expect(m.events).not.toHaveBeenCalled();
    expect(m.after).toEqual([]);
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it("a run the server is carrying already is fine — and is not logged as a second start", async () => {
    m.start.mockResolvedValue({ ok: true, state: "already", headers: HEADERS, origin: "https://www.pipglyph.example" });
    expect(await handReartRunToServerAction(JOB)).toEqual({ ok: true, state: "already" });
    expect(m.events).not.toHaveBeenCalled();
  });

  it("this request is the run's FIRST DRIVER — after its response, for a few minutes, with the session it was just given", async () => {
    const held = token(50 * 60);
    m.session = { access_token: held };
    expect(await handReartRunToServerAction(JOB)).toEqual({ ok: true, state: "started" });
    // Nothing is driven before the answer is on its way.
    expect(m.drive).not.toHaveBeenCalled();
    expect(m.after).toHaveLength(1);
    await m.after[0]();
    expect(m.drive).toHaveBeenCalledTimes(1);
    expect(m.drive).toHaveBeenCalledWith({
      forMs: KICK_MS,
      only: JOB,
      requestUrl: "https://pipglyph.example/",
      // Plain values: nothing after the response reads this request's session.
      preset: { jobId: JOB, accessToken: held, headers: HEADERS, origin: "https://www.pipglyph.example" },
    });
    // The answer never carries the headers (the cookie) back to the browser.
    expect(JSON.stringify(await handReartRunToServerAction(JOB))).not.toContain("cookie");
  });

  it("a first driver that throws is logged and goes nowhere: the cron drives the run all the same", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.drive.mockRejectedValue(new Error("boom"));
    await handReartRunToServerAction(JOB);
    await expect(m.after[0]()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it("the page reads the run's row again with the answer (it then says the run can be left)", async () => {
    await handReartRunToServerAction(JOB);
    expect(m.revalidate).toHaveBeenCalledWith("/dashboard/tools/re-art-deck");
  });

  it("with no address to read, the chain is still started (it uses the site's own)", async () => {
    m.host = null;
    await handReartRunToServerAction(JOB);
    expect(m.start.mock.calls[0][0].requestUrl).toBeNull();
  });

  it("how the log reads the events: a refused hand-over is a failure; none of them is a use of the tool, or the browser's to write", () => {
    expect(toolEventKind("re-art-deck", "background_start_failed")).toBe("failure");
    expect(toolEventKind("re-art-deck", "background_start")).toBe("other");
    expect(toolEventKind("re-art-deck", "background_finished")).toBe("other");
    for (const event of ["background_start", "background_start_failed", "background_finished"]) expect(isToolClientEvent("re-art-deck", event)).toBe(false);
  });
});

describe("POST /api/tools/re-art-deck/stop-background — the maker's Stop", () => {
  const call = (body: unknown) =>
    stopRoute(new Request("https://pipglyph.example/api/tools/re-art-deck/stop-background", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("ends the server's part of the caller's OWN run, and says so", async () => {
    const response = await call({ jobId: JOB });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(m.stop).toHaveBeenCalledWith(ME, JOB);
  });

  it("a Stop that couldn't be written is SAID (the page then says the server may still be painting)", async () => {
    m.stop.mockResolvedValue(false);
    const response = await call({ jobId: JOB });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
  });

  it("is the tool's own door: closed → 404; no service role → 503; anything but a job id → 400", async () => {
    m.access = null;
    expect((await call({ jobId: JOB })).status).toBe(404);
    m.access = { userId: ME, via: "tester" };
    m.adminConfigured = false;
    expect((await call({ jobId: JOB })).status).toBe(503);
    m.adminConfigured = true;
    for (const bad of ["not json", {}, { jobId: "nope" }, { jobId: 3 }]) expect((await call(bad)).status, JSON.stringify(bad)).toBe(400);
    expect(m.stop).not.toHaveBeenCalled();
  });

  it("is a plain route, never a server action — an action waits behind the page's own refreshes, and a Stop pressed before the tab closes would be lost", () => {
    expect(Object.keys(backgroundActions)).toEqual(["handReartRunToServerAction"]);
    const studio = readFileSync(join(process.cwd(), "components/tools/re-art/reart-studio.tsx"), "utf8");
    expect(studio).toContain("requestReartBackgroundStop(");
    expect(studio).not.toMatch(/stopReartBackgroundAction/);
  });
});

describe("the browser's Stop request", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const answer = (status: number, body: unknown = { ok: status === 200 }) => new Response(JSON.stringify(body), { status });

  it("is sent with keepalive — it leaves the browser even if the tab is closed right after the press", async () => {
    fetchMock.mockResolvedValue(answer(200));
    expect(await requestReartBackgroundStop(JOB)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(REART_STOP_BACKGROUND_ENDPOINT);
    expect(url).toBe("/api/tools/re-art-deck/stop-background");
    expect(init).toMatchObject({ method: "POST", keepalive: true, body: JSON.stringify({ jobId: JOB }) });
  });

  it("is true ONLY when the server said it stopped", async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: false }));
    expect(await requestReartBackgroundStop(JOB)).toBe(false);
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    expect(await requestReartBackgroundStop(JOB)).toBe(false);
  });

  it("a network failure or a server error is tried once more; a refusal is not", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(answer(200));
    expect(await requestReartBackgroundStop(JOB)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(answer(500));
    expect(await requestReartBackgroundStop(JOB)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(answer(404));
    expect(await requestReartBackgroundStop(JOB)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await requestReartBackgroundStop(JOB)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/cron/reart-background — the driver, every minute", () => {
  const request = () => new Request("https://pipglyph.example/api/cron/reart-background");

  it("runs only past the cron's guard", async () => {
    m.cronBlocked = new Response("no", { status: 401 });
    const blocked = await cronRoute(request());
    expect(blocked.status).toBe(401);
    expect(m.drive).not.toHaveBeenCalled();
    expect(m.cronGuard).toHaveBeenCalledTimes(1);
  });

  it("drives every run being carried for the best part of the minute, and says what it did", async () => {
    m.drive.mockResolvedValue({ runs: 2, asked: 7, ended: 1 });
    const response = await cronRoute(request());
    expect(await response.json()).toEqual({ ok: true, runs: 2, asked: 7, ended: 1 });
    // Every run (no `only`), with no session of its own (no `preset`): each run's kept token is its sign-in.
    expect(m.drive).toHaveBeenCalledWith({ forMs: SWEEP_MS, requestUrl: "https://pipglyph.example/api/cron/reart-background" });
  });

  it("is called every minute, ends before the next call, and may run a little past it (the lease keeps two apart)", () => {
    const crons: Array<{ path: string; schedule: string }> = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")).crons;
    expect(crons.filter((cron) => cron.path === "/api/cron/reart-background")).toEqual([{ path: "/api/cron/reart-background", schedule: "* * * * *" }]);
    expect(SWEEP_MS).toBeLessThan(60_000);
    expect(cronMaxDuration * 1000).toBeGreaterThan(SWEEP_MS + 20_000);
  });
});

describe("no request calls itself in a chain", () => {
  // Vercel's recursion protection answers the fourth or so link of such a
  // chain with 508 (INFINITE_LOOP_DETECTED): a run would stop after a few
  // minutes on production while working on a laptop. The drivers are the
  // hand-over's own request and the cron — both ask the STEP DOOR only.
  it("there is no route for the server to call itself by, and the driver asks the step door alone", () => {
    expect(existsSync(join(process.cwd(), "app/api/tools/re-art-deck/background/route.ts"))).toBe(false);
    const src = readFileSync(join(process.cwd(), "lib/tools/re-art/background.ts"), "utf8");
    const code = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
      .join("\n");
    // Every request it makes is to stepDoorUrl(…).
    const fetches = code.match(/fetch\(([^,)]+)/g) ?? [];
    expect(fetches.length).toBeGreaterThan(0);
    for (const call of fetches) expect(call).toMatch(/fetch\(stepDoorUrl\(/);
    expect(code).not.toMatch(/api\/cron|api\/tools\/re-art-deck/);
  });

  it("the hand-over's driver fits inside the page's own time limit", () => {
    const page = readFileSync(join(process.cwd(), "app/(app)/dashboard/tools/re-art-deck/page.tsx"), "utf8");
    const limit = Number(page.match(/export const maxDuration = (\d+);/)?.[1]);
    expect(limit * 1000).toBeGreaterThanOrEqual(KICK_MS + 30_000);
  });
});
