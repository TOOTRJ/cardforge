import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Re-art deck — a run the SERVER carries on after its page is closed
// (migration 0218, lib/tools/re-art/background.ts; owner 2026-11-18: "borrow
// the sign-in").
//
//   * the server is given ONE access token and never refreshes it: it is
//     kept SEALED beside the run (never in the clear, never the refresh
//     token), the cookie the step door is sent holds no real refresh token,
//     a driver stops asking while the token still has minutes to spare, and
//     the run then PAUSES with the kept token erased;
//   * a DRIVER asks the browser's own step door for cards — one request a
//     card, never more than two being painted, the page's included — and
//     awaits none of them. It is the hand-over's request for a few minutes
//     and then a cron: never a request that calls itself in a chain
//     (Vercel's recursion protection ends such a chain after a few links);
//   * the row is the driver's LEASE: two drivers never work one run;
//   * a run ends on the maker's Stop (at once), a NEW plan-limit failure, a
//     door that keeps refusing, a run that was closed — and "finished" when
//     nothing is left; the maker is told in the bell once, unless they
//     stopped it themselves.
//
// The database here is a small fake that runs the real statements' filters,
// so the lease is exercised, not assumed.
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;
type Filter = [string, "eq" | "is" | "lt", unknown];
type Step = { key: string; status: "pending" | "running" | "done" | "failed"; error_code?: "INSUFFICIENT_CREDITS" | "CARD_CAPACITY" | "RATE_LIMITED" | null; retry_after_seconds?: number | null; claimed_at?: string | null };
type BgRow = {
  job_id: string;
  owner_id: string;
  deck_id: string;
  state: string;
  reason: string | null;
  driver: string | null;
  driven_until: string | null;
  beat_at: string;
  door_errors: number;
  limited_keys: string[];
  finished_at?: string | null;
};

const db = vi.hoisted(() => ({
  rows: [] as Rec[],
  tokens: [] as Rec[],
  notices: [] as Rec[],
  jobs: new Map<string, { steps: Step[]; status: string; owner?: string; kind?: string }>(),
  fail: [] as Array<{ table: string; op: string; error: { message: string; code?: string } }>,
  reads: [] as string[],
}));
const m = vi.hoisted(() => ({
  adminConfigured: vi.fn(),
  step: vi.fn(),
  rate: vi.fn(),
  setSession: vi.fn(),
  sessionRead: vi.fn(),
  event: vi.fn(),
}));

function fakeClient() {
  const tableOf = (name: string): Rec[] | null => (name === "deck_reart_background" ? db.rows : name === "deck_reart_background_tokens" ? db.tokens : name === "notifications" ? db.notices : null);
  const matches = (row: Rec, filters: Filter[]) =>
    filters.every(([column, op, value]) => (op === "eq" ? row[column] === value : op === "is" ? (row[column] ?? null) === value : String(row[column]) < String(value)));
  return {
    from: (table: string) => {
      const q = { op: "select", patch: null as unknown, filters: [] as Filter[], returning: false, order: null as string | null, limit: Infinity };
      const run = async (): Promise<{ data: Rec[] | null; error: { message: string; code?: string } | null }> => {
        const failing = db.fail.findIndex((f) => f.table === table && f.op === q.op);
        if (failing >= 0) return { data: null, error: db.fail.splice(failing, 1)[0].error };
        if (q.op === "select") db.reads.push(table);
        if (table === "decks") return { data: [{ title: "Embers of the Fen" }], error: null };
        if (table === "ai_generation_jobs") {
          const asked = (column: string) => q.filters.find(([name]) => name === column)?.[2];
          const job = db.jobs.get(asked("id") as string);
          // The job's own owner and kind (the maker's deck_reart run unless a test says otherwise).
          const mine = job && (asked("owner_id") === undefined || asked("owner_id") === (job.owner ?? "11111111-1111-4111-8111-111111111111")) && (asked("kind") === undefined || asked("kind") === (job.kind ?? "deck_reart"));
          return { data: job && mine ? [{ steps: job.steps.map((step) => ({ ...step })), status: job.status, request: { deck_id: "33333333-3333-4333-8333-333333333333" } }] : [], error: null };
        }
        const rows = tableOf(table);
        if (!rows) return { data: [], error: null };
        if (q.op === "insert" || q.op === "upsert") {
          const row = q.patch as Rec;
          const at = rows.findIndex((existing) => existing.job_id === row.job_id);
          if (at >= 0 && q.op === "insert") return { data: null, error: { message: "duplicate key", code: "23505" } };
          const defaults: Rec = table === "deck_reart_background" ? { state: "running", reason: null, driver: null, driven_until: null, door_errors: 0, limited_keys: [], beat_at: new Date().toISOString() } : {};
          if (at >= 0) Object.assign(rows[at], row);
          else rows.push({ ...defaults, ...row });
          return { data: null, error: null };
        }
        let hit = rows.filter((row) => matches(row, q.filters));
        if (q.op === "update") {
          for (const row of hit) Object.assign(row, q.patch);
          return { data: q.returning ? hit.map((row) => ({ ...row })) : null, error: null };
        }
        if (q.op === "delete") {
          for (const row of hit) rows.splice(rows.indexOf(row), 1);
          return { data: null, error: null };
        }
        if (q.order) hit = [...hit].sort((a, b) => String(a[q.order!]).localeCompare(String(b[q.order!])));
        return { data: hit.slice(0, q.limit).map((row) => ({ ...row })), error: null };
      };
      const chain = {
        select: () => {
          if (q.op !== "select") q.returning = true;
          return chain;
        },
        insert: (row: unknown) => ((q.op = "insert"), (q.patch = row), chain),
        upsert: (row: unknown) => ((q.op = "upsert"), (q.patch = row), chain),
        update: (patch: unknown) => ((q.op = "update"), (q.patch = patch), chain),
        delete: () => ((q.op = "delete"), chain),
        eq: (column: string, value: unknown) => (q.filters.push([column, "eq", value]), chain),
        is: (column: string, value: unknown) => (q.filters.push([column, "is", value]), chain),
        lt: (column: string, value: unknown) => (q.filters.push([column, "lt", value]), chain),
        order: (column: string) => ((q.order = column), chain),
        limit: (n: number) => ((q.limit = n), chain),
        maybeSingle: async () => {
          const result = await run();
          return { data: result.data?.[0] ?? null, error: result.error };
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => run().then(resolve, reject),
      };
      return chain;
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseEnv: () => ({ url: "https://abcdefgh.supabase.co", anonKey: "anon" }) }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => m.adminConfigured(), createAdminClient: () => fakeClient() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain = { select: () => chain, eq: () => chain, then: (resolve: (value: unknown) => unknown) => Promise.resolve(m.sessionRead()).then(resolve) };
      return chain;
    },
  }),
}));
// The sign-in library: it validates the token and writes the session cookie
// through the cookie methods it is given.
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (cookies: Array<{ name: string; value: string }>) => void } }) => ({
    auth: {
      setSession: async (session: { access_token: string; refresh_token: string }) => {
        const answer = await m.setSession(session);
        if (answer?.ok) options.cookies.setAll([{ name: "sb-abcdefgh-auth-token", value: `base64-${session.access_token.slice(0, 40)}` }]);
        return answer?.ok ? { data: { session: { access_token: session.access_token } }, error: null } : { data: { session: null }, error: { message: "bad jwt" } };
      },
    },
  }),
}));
vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://pipglyph.example" }));
vi.mock("@/lib/tools/events", () => ({ recordToolEventLater: m.event }));

import {
  FRESH_TOKEN_S,
  KICK_MS,
  SWEEP_MS,
  countsOf,
  doorOrigins,
  driveBackgroundRuns,
  eraseExpiredTokens,
  kickMs,
  limitedKeysOf,
  reachableDoorOrigin,
  readBackgrounds,
  requestBackgroundStop,
  sessionCookieHeader,
  startBackground,
  stepDoorUrl,
  tokenSecondsLeft,
} from "@/lib/tools/re-art/background";
import { openToken, sealToken } from "@/lib/tools/re-art/token-seal";
import { REART_BACKGROUND_STALE_MS, reartBackgroundIsLive } from "@/lib/tools/re-art/model";

const ME = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const JOB2 = "55555555-5555-4555-8555-555555555555";
const DECK = "33333333-3333-4333-8333-333333333333";
const OTHER_DRIVER = "99999999-9999-4999-8999-999999999999";
const NOW = Date.parse("2026-11-18T12:00:00Z");
const SITE = "https://pipglyph.example";
const DOOR = `${SITE}/api/ai/jobs/${JOB}/step`;
/** An access token that expires `seconds` from NOW. */
const token = (seconds: number) => `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ exp: NOW / 1000 + seconds, sub: ME })).toString("base64url")}.sig`;
const HOUR = token(3600);
const COOKIE = `sb-abcdefgh-auth-token=base64-${HOUR.slice(0, 40)}`;
const row = (over: Partial<BgRow> = {}): BgRow => ({
  job_id: JOB,
  owner_id: ME,
  deck_id: DECK,
  state: "running",
  reason: null,
  driver: null,
  driven_until: null,
  beat_at: new Date(NOW).toISOString(),
  door_errors: 0,
  limited_keys: [],
  ...over,
});
const stepsOf = (...statuses: Array<Step["status"]>): Step[] => statuses.map((status, index) => ({ key: `reart:${index}`, status }));
const pendingJob = (cards: number) => ({ steps: stepsOf(...Array.from({ length: cards }, () => "pending" as const)), status: "generating" });
const keep = (jobId = JOB, held = HOUR) => db.tokens.push({ job_id: jobId, sealed: sealToken(held, jobId), expires_at: new Date(NOW + 3_600_000).toISOString() });
const theRow = (jobId = JOB) => db.rows.find((r) => r.job_id === jobId) as unknown as BgRow & { finished_at?: string | null };

type Sent = { method: string; body?: string; headers: Record<string, string>; signal?: AbortSignal; redirect?: string };
const fetchMock = vi.fn();
const net = {
  /** What a GET of the step door answers, by the address asked (default 405: it is there). */
  probe: (() => new Response(null, { status: 405 })) as (url: string) => Response,
  busiest: 0,
  /** How long the door takes to claim a card once asked (a cold start). */
  claimAfterMs: 0,
};
/** The step door: claims the next waiting card and paints it (30 s), as the
 *  real one does — or what `script` says for that card. A request let go by
 *  its caller goes on painting. */
function door(script: Record<string, Partial<Step>> = {}) {
  m.step.mockImplementation(async (jobId: string) => {
    const job = db.jobs.get(jobId);
    if (!job) return { ok: false, error: "Job not found." };
    if (net.claimAfterMs > 0) await new Promise((resolve) => setTimeout(resolve, net.claimAfterMs));
    const next = job.status === "generating" ? job.steps.find((step) => step.status === "pending") : undefined;
    if (!next) return { ok: true, job: { steps: job.steps, status: job.status }, inFlight: job.steps.some((s) => s.status === "running") };
    next.status = "running";
    next.claimed_at = new Date().toISOString();
    net.busiest = Math.max(net.busiest, job.steps.filter((s) => s.status === "running").length);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    Object.assign(next, { status: "done" }, script[next.key] ?? {});
    if (job.steps.every((s) => s.status === "done" || s.status === "failed")) job.status = "done";
    return { ok: true, job: { steps: job.steps, status: job.status } };
  });
}
/** What the server's own requests meet: the step door, answering as the
 *  real route does (the AI's limit first, then one step; GET is not its). */
function network() {
  fetchMock.mockImplementation((url: string, init: Sent) => {
    if (init.method === "GET") return Promise.resolve(net.probe(String(url)));
    const work = (async () => {
      const rate = await m.rate();
      if (!rate.ok) return new Response(JSON.stringify({ ok: false, error: rate.message }), { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
      let result: { ok: boolean; error?: string; job?: unknown; inFlight?: boolean };
      try {
        result = await m.step(String(url).split("/").at(-2));
      } catch {
        return new Response("boom", { status: 500 });
      }
      if (!result.ok) return new Response(JSON.stringify({ ok: false, error: result.error }), { status: 502 });
      return new Response(JSON.stringify({ ok: true, job: result.job, inFlight: result.inFlight ?? false, credits: 5 }), { status: 200 });
    })();
    return new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      work.then(resolve, reject);
    });
  });
}
const asks = () => fetchMock.mock.calls.filter(([, init]) => (init as Sent).method === "POST");

async function settle<T>(work: Promise<T>): Promise<T> {
  let done = false;
  const tracked = work.finally(() => {
    done = true;
  });
  for (let i = 0; i < 4000 && !done; i += 1) await vi.advanceTimersByTimeAsync(250);
  return tracked;
}
const drive = (over: Partial<Parameters<typeof driveBackgroundRuns>[0]> = {}) => settle(driveBackgroundRuns({ forMs: SWEEP_MS, requestUrl: null, ...over }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("SUPABASE_SECRET_KEY", "a-server-secret-for-tests");
  db.rows.length = 0;
  db.tokens.length = 0;
  db.notices.length = 0;
  db.fail.length = 0;
  db.reads.length = 0;
  db.jobs.clear();
  for (const fn of Object.values(m)) fn.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  m.adminConfigured.mockReturnValue(true);
  m.rate.mockResolvedValue({ ok: true });
  m.setSession.mockResolvedValue({ ok: true });
  net.probe = () => new Response(null, { status: 405 });
  net.busiest = 0;
  net.claimAfterMs = 0;
  door();
  network();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the token the server borrows", () => {
  it("is read for how long it has left — and garbage, or an expired one, has nothing", () => {
    expect(tokenSecondsLeft(token(3600), NOW)).toBe(3600);
    expect(tokenSecondsLeft(token(3600), NOW + 600_000)).toBe(3000);
    expect(tokenSecondsLeft(token(-5), NOW)).toBe(0);
    for (const bad of [null, undefined, "", "abc", "a.b.c", `x.${Buffer.from("{}").toString("base64url")}.y`]) expect(tokenSecondsLeft(bad, NOW)).toBe(0);
  });

  it("goes to the step door as a session cookie of the access token ALONE: the refresh token it carries is not one", async () => {
    expect(await sessionCookieHeader(HOUR)).toBe(COOKIE);
    // The maker's real refresh token is never handed to the server's requests.
    expect(m.setSession.mock.calls).toEqual([[{ access_token: HOUR, refresh_token: "none" }]]);
  });

  it("a token the sign-in service refuses, or one already expired, makes no cookie", async () => {
    m.setSession.mockResolvedValue({ ok: false });
    expect(await sessionCookieHeader(HOUR)).toBeNull();
    m.setSession.mockClear();
    expect(await sessionCookieHeader(token(-5))).toBeNull();
    expect(m.setSession).not.toHaveBeenCalled();
  });

  it("is kept SEALED: not readable in the table, opened only by this server, and only for its own run", () => {
    const sealed = sealToken(HOUR, JOB);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain(HOUR.split(".")[1]);
    expect(Buffer.from(sealed.slice(3), "base64url").toString("latin1")).not.toContain(HOUR.split(".")[1]);
    expect(openToken(sealed, JOB)).toBe(HOUR);
    // Two seals of one token differ (a fresh nonce each time).
    expect(sealToken(HOUR, JOB)).not.toBe(sealed);
    // Moved to another run's row, changed by a byte, or cut short: nothing.
    expect(openToken(sealed, JOB2)).toBeNull();
    const raw = Buffer.from(sealed.slice(3), "base64url");
    raw[raw.length - 1] ^= 1;
    expect(openToken(`v1.${raw.toString("base64url")}`, JOB)).toBeNull();
    expect(openToken("v1.AAAA", JOB)).toBeNull();
    expect(openToken(HOUR, JOB)).toBeNull();
    // Another server secret (it was rotated): nothing.
    vi.stubEnv("SUPABASE_SECRET_KEY", "another-secret");
    expect(openToken(sealed, JOB)).toBeNull();
    // No secret at all: nothing is sealed in the clear.
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(() => sealToken(HOUR, JOB)).toThrow();
  });

  it("the hand-over refreshes a session whose token is less than three quarters of an hour from its end", () => {
    expect(FRESH_TOKEN_S).toBe(45 * 60);
  });
});

describe("where a card is asked for", () => {
  it("is the browser's own step door at this deployment's own address — never a host a request on a deployed site named", () => {
    expect(doorOrigins(null)).toEqual([SITE]);
    expect(doorOrigins("https://evil.example/anything")).toEqual([SITE]);
    expect(doorOrigins("not a url")).toEqual([SITE]);
    expect(stepDoorUrl(SITE, JOB)).toBe(DOOR);
  });

  it("a local dev server is reached by the address it was called on", () => {
    expect(doorOrigins("http://localhost:3111/dashboard")).toEqual(["http://localhost:3111"]);
    expect(doorOrigins("http://127.0.0.1:3000/")).toEqual(["http://127.0.0.1:3000"]);
  });

  it("a preview asks its OWN deployment and nothing it was configured with — a preview's session must never be sent to the public site", () => {
    // The site URL (here pipglyph.example) could be set for previews too, and
    // production's name is set on every deployment: neither is asked.
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "pipglyph-prod.example");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_BRANCH_URL", "cardforge-git-my-branch.vercel.app");
    vi.stubEnv("VERCEL_URL", "cardforge-abc123.vercel.app");
    expect(doorOrigins(null)).toEqual(["https://cardforge-git-my-branch.vercel.app", "https://cardforge-abc123.vercel.app"]);
    vi.stubEnv("VERCEL_BRANCH_URL", "");
    expect(doorOrigins(null)).toEqual(["https://cardforge-abc123.vercel.app"]);
    // With no address of its own it asks nobody (the hand-over is then refused).
    vi.stubEnv("VERCEL_URL", "");
    expect(doorOrigins(null)).toEqual([]);
  });

  it("production has a second name for itself, tried only there", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "pipglyph-prod.example");
    vi.stubEnv("VERCEL_ENV", "");
    expect(doorOrigins(null)).toEqual([SITE]);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(doorOrigins(null)).toEqual([SITE, "https://pipglyph-prod.example"]);
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "pipglyph.example");
    expect(doorOrigins(null)).toEqual([SITE]);
  });

  it("the door is found by a GET, which claims nothing (it answers 405): the address that answers is the one used", async () => {
    const headers = { cookie: COOKIE };
    expect(await reachableDoorOrigin(null, JOB, headers)).toBe(SITE);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DOOR);
    expect(init.method).toBe("GET");
    expect(init.headers).toBe(headers);
    expect(init.redirect).toBe("manual");
    // A wall, a page, an error, no route: not reachable.
    for (const status of [401, 200, 404, 500]) {
      net.probe = () => new Response(null, { status });
      expect(await reachableDoorOrigin(null, JOB, headers)).toBeNull();
    }
    fetchMock.mockRejectedValue(new Error("no route"));
    expect(await reachableDoorOrigin(null, JOB, headers)).toBeNull();
  });

  it("a site that sends its bare name to www (or back) is followed that ONE step by hand — a redirect followed by fetch would drop the cookie", async () => {
    const www = "https://www.pipglyph.example";
    net.probe = (url) =>
      url.startsWith(`${SITE}/`) ? new Response(null, { status: 308, headers: { location: url.replace(SITE, www) } }) : new Response(null, { status: 405 });
    expect(await reachableDoorOrigin(null, JOB, { cookie: COOKIE })).toBe(www);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([DOOR, `${www}/api/ai/jobs/${JOB}/step`]);
    // Anywhere else — a sign-in wall on another host, another site — is not followed: the cookie goes nowhere.
    for (const elsewhere of ["https://vercel.com/sso-api?url=x", "https://evil.example/x", "http://www.pipglyph.example/x", "https://www.pipglyph.example:8443/x"]) {
      fetchMock.mockClear();
      net.probe = () => new Response(null, { status: 307, headers: { location: elsewhere } });
      expect(await reachableDoorOrigin(null, JOB, { cookie: COOKIE })).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    // …and a twin that redirects again is not chased.
    fetchMock.mockClear();
    net.probe = (url) => new Response(null, { status: 308, headers: { location: url.startsWith(`${SITE}/`) ? url.replace(SITE, www) : url.replace(www, SITE) } });
    expect(await reachableDoorOrigin(null, JOB, { cookie: COOKIE })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("on production its second name is tried when the first doesn't answer", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "pipglyph-prod.example");
    net.probe = (url) => new Response(null, { status: url.startsWith("https://pipglyph-prod.example/") ? 405 : 503 });
    expect(await reachableDoorOrigin(null, JOB, { cookie: COOKIE })).toBe("https://pipglyph-prod.example");
  });
});

describe("how long a driver works", () => {
  it("the cron's is under the minute between two calls; the hand-over's fits its own request", () => {
    expect(SWEEP_MS).toBeLessThan(60_000);
    expect(KICK_MS).toBeLessThanOrEqual(240_000);
  });

  it("the hand-over's can be made shorter for a check — never on production", () => {
    vi.stubEnv("REART_BACKGROUND_KICK_MS", "1000");
    vi.stubEnv("NODE_ENV", "development");
    expect(kickMs()).toBe(1000);
    vi.stubEnv("REART_BACKGROUND_KICK_MS", String(KICK_MS * 10));
    expect(kickMs()).toBe(KICK_MS);
    vi.stubEnv("REART_BACKGROUND_KICK_MS", "1000");
    vi.stubEnv("NODE_ENV", "production");
    expect(kickMs()).toBe(KICK_MS);
  });
});

describe("whether the server is carrying a run right now", () => {
  it("only a row that says running AND was looked at lately: a run nobody drives is not carried", () => {
    const beatAt = new Date(NOW).toISOString();
    expect(reartBackgroundIsLive({ state: "running", beatAt }, NOW + 60_000)).toBe(true);
    expect(reartBackgroundIsLive({ state: "running", beatAt }, NOW + REART_BACKGROUND_STALE_MS + 1)).toBe(false);
    for (const state of ["paused", "stopped", "finished"] as const) expect(reartBackgroundIsLive({ state, beatAt }, NOW)).toBe(false);
    expect(reartBackgroundIsLive(null, NOW)).toBe(false);
    expect(reartBackgroundIsLive({ state: "running", beatAt: "not a date" }, NOW)).toBe(false);
    // The cron looks every minute: a missed call or two is not "stopped".
    expect(REART_BACKGROUND_STALE_MS).toBeGreaterThanOrEqual(3 * 60_000);
  });

  it("the studio reads the deck's rows through the owner's own session; a failed read shows none", async () => {
    m.sessionRead.mockReturnValue({ data: [{ job_id: JOB, state: "paused", reason: "expired", beat_at: new Date(NOW).toISOString() }], error: null });
    expect(await readBackgrounds(DECK)).toEqual(new Map([[JOB, { jobId: JOB, state: "paused", reason: "expired", beatAt: new Date(NOW).toISOString() }]]));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.sessionRead.mockReturnValue({ data: null, error: { message: "boom" } });
    expect(await readBackgrounds(DECK)).toEqual(new Map());
    m.sessionRead.mockReturnValue({ data: null, error: { message: "no table", code: "PGRST205" } });
    expect(await readBackgrounds(DECK)).toEqual(new Map());
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});

describe("handing a run to the server", () => {
  const hand = (over: Partial<Parameters<typeof startBackground>[0]> = {}) =>
    settle(startBackground({ userId: ME, jobId: JOB, deckId: DECK, accessToken: HOUR, steps: stepsOf("pending", "pending"), requestUrl: null, ...over }));

  it("makes the run's row and keeps the token SEALED beside it — nothing is asked of the step door yet", async () => {
    const result = await hand();
    expect(result).toEqual({ ok: true, state: "started", headers: { "content-type": "application/json", cookie: COOKIE }, origin: SITE });
    expect(db.rows).toHaveLength(1);
    expect(theRow()).toMatchObject({ job_id: JOB, owner_id: ME, deck_id: DECK, state: "running", reason: null, door_errors: 0, limited_keys: [] });
    expect(db.tokens).toHaveLength(1);
    const kept = db.tokens[0] as { job_id: string; sealed: string; expires_at: string };
    expect(kept.job_id).toBe(JOB);
    // Never in the clear…
    expect(JSON.stringify(db.tokens)).not.toContain(HOUR);
    expect(JSON.stringify(db.rows)).not.toContain(HOUR.split(".")[1]);
    // …and it opens to the token it was given, with that token's own end.
    expect(openToken(kept.sealed, JOB)).toBe(HOUR);
    expect(kept.expires_at).toBe(new Date(NOW + 3_600_000).toISOString());
    expect(asks()).toEqual([]);
  });

  it("first asks whether this deployment can reach its own step door — a GET, which claims nothing — and refuses at once if it can't", async () => {
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass-value");
    await hand();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DOOR);
    expect(init.method).toBe("GET");
    expect(init.headers.cookie).toBe(COOKIE);
    expect(init.headers["x-vercel-protection-bypass"]).toBe("bypass-value");
    expect(init.redirect).toBe("manual");
    // A preview behind a wall with no way through: nothing is kept.
    db.rows.length = 0;
    db.tokens.length = 0;
    for (const status of [401, 302, 200, 500]) {
      net.probe = () => new Response(null, { status });
      expect(await hand()).toEqual({ ok: false, reason: "unreachable" });
    }
    fetchMock.mockRejectedValue(new Error("no route"));
    expect(await hand()).toEqual({ ok: false, reason: "unreachable" });
    expect(db.rows).toEqual([]);
    expect(db.tokens).toEqual([]);
  });

  it("remembers which cards had already failed on a plan limit: only a NEW such failure will stop the run", async () => {
    const steps: Step[] = [
      { key: "reart:0", status: "failed", error_code: "INSUFFICIENT_CREDITS" },
      { key: "reart:1", status: "failed", error_code: null },
      { key: "reart:2", status: "failed", error_code: "CARD_CAPACITY" },
      { key: "reart:3", status: "pending" },
    ];
    expect(limitedKeysOf(steps)).toEqual(["reart:0", "reart:2"]);
    await hand({ steps });
    expect(theRow().limited_keys).toEqual(["reart:0", "reart:2"]);
  });

  it("a run the server is carrying already stays so — its token is replaced by the fresher one", async () => {
    db.rows.push(row({ driver: OTHER_DRIVER, driven_until: new Date(NOW + 10_000).toISOString(), door_errors: 2 }));
    keep(JOB, token(900));
    expect(await hand()).toMatchObject({ ok: true, state: "already" });
    expect(db.rows).toHaveLength(1);
    // The driver at work keeps its lease.
    expect(theRow()).toMatchObject({ state: "running", driver: OTHER_DRIVER, door_errors: 0 });
    expect(db.tokens).toHaveLength(1);
    expect(openToken((db.tokens[0] as { sealed: string }).sealed, JOB)).toBe(HOUR);
  });

  it("a run that paused, stopped or went quiet is taken up again", async () => {
    db.rows.push(row({ state: "paused", reason: "expired", door_errors: 3, limited_keys: ["reart:9"], finished_at: new Date(NOW - 60_000).toISOString() }));
    expect(await hand()).toMatchObject({ ok: true, state: "started" });
    expect(theRow()).toMatchObject({ state: "running", reason: null, door_errors: 0, limited_keys: [], finished_at: null, beat_at: new Date(NOW).toISOString() });
    // …and one that says running but nobody has looked at for too long.
    db.rows[0] = row({ beat_at: new Date(NOW - REART_BACKGROUND_STALE_MS - 1_000).toISOString() });
    expect(await hand()).toMatchObject({ ok: true, state: "started" });
    expect(Date.parse(theRow().beat_at)).toBeGreaterThanOrEqual(NOW);
  });

  it("a run's FIRST hand-over is refused on a run its maker has already stopped (the Stop arrived first); Continue's takes it up", async () => {
    db.rows.push(row({ state: "stopped", reason: "stopped", finished_at: new Date(NOW - 1_000).toISOString() }));
    expect(await hand({ first: true })).toEqual({ ok: false, reason: "stopped" });
    expect(theRow()).toMatchObject({ state: "stopped", reason: "stopped" });
    expect(db.tokens).toEqual([]);
    // Continue is the maker asking for it.
    expect(await hand()).toMatchObject({ ok: true, state: "started" });
    expect(theRow()).toMatchObject({ state: "running", reason: null });
    // A first hand-over on a run that ended some OTHER way (paused) goes ahead.
    db.rows[0] = row({ state: "paused", reason: "expired" });
    expect(await hand({ first: true })).toMatchObject({ ok: true, state: "started" });
  });

  it("a token with too little left, one the sign-in service refuses, no service role and a write that failed keep NOTHING", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await hand({ accessToken: token(120) })).toEqual({ ok: false, reason: "no_session" });
    m.setSession.mockResolvedValue({ ok: false });
    expect(await hand()).toEqual({ ok: false, reason: "no_session" });
    m.setSession.mockResolvedValue({ ok: true });
    m.adminConfigured.mockReturnValue(false);
    expect(await hand()).toEqual({ ok: false, reason: "unavailable" });
    m.adminConfigured.mockReturnValue(true);
    db.fail.push({ table: "deck_reart_background", op: "insert", error: { message: "boom" } });
    expect(await hand()).toEqual({ ok: false, reason: "not_saved" });
    // A database 0218 hasn't reached: unavailable, never an error to the maker.
    db.fail.push({ table: "deck_reart_background", op: "select", error: { message: "no table", code: "PGRST205" } });
    expect(await hand()).toEqual({ ok: false, reason: "unavailable" });
    expect(db.rows).toEqual([]);
    expect(db.tokens).toEqual([]);
    logged.mockRestore();
  });

  it("a token that couldn't be kept leaves no run to carry: the row says so, and the run is the page's alone", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.fail.push({ table: "deck_reart_background_tokens", op: "upsert", error: { message: "boom" } });
    expect(await hand()).toEqual({ ok: false, reason: "not_saved" });
    expect(theRow()).toMatchObject({ state: "paused", reason: "error" });
    expect(db.tokens).toEqual([]);
    // No bell row: the maker is looking at the page (it says so there).
    expect(db.notices).toEqual([]);
    // …and an OLDER token kept for the run is not left behind either.
    db.rows[0] = row({ state: "paused", reason: "expired" });
    keep(JOB, token(900));
    db.fail.push({ table: "deck_reart_background_tokens", op: "upsert", error: { message: "boom" } });
    expect(await hand()).toEqual({ ok: false, reason: "not_saved" });
    expect(db.tokens).toEqual([]);
    logged.mockRestore();
  });

  it("every hand-over erases the kept tokens that outlived their own end (where no cron runs, nothing else would)", async () => {
    db.tokens.push({ job_id: JOB2, sealed: sealToken(token(-900), JOB2), expires_at: new Date(NOW - 900_000).toISOString() });
    await hand();
    expect(db.tokens.map((kept) => kept.job_id)).toEqual([JOB]);
  });
});

describe("kept tokens nobody ended", () => {
  it("are erased a few minutes past their OWN end — never one still in use, never one that only just ended (its run is paused first, with the right reason)", async () => {
    db.tokens.push(
      { job_id: "a", sealed: "x".repeat(50), expires_at: new Date(NOW - 6 * 60_000).toISOString() },
      { job_id: "b", sealed: "x".repeat(50), expires_at: new Date(NOW - 60_000).toISOString() },
      { job_id: "c", sealed: "x".repeat(50), expires_at: new Date(NOW + 3_000_000).toISOString() },
    );
    await eraseExpiredTokens();
    expect(db.tokens.map((kept) => kept.job_id)).toEqual(["b", "c"]);
    m.adminConfigured.mockReturnValue(false);
    await expect(eraseExpiredTokens()).resolves.toBeUndefined();
  });

  it("the cron's driver does it on every call; the hand-over's own driver leaves it to them", async () => {
    db.tokens.push({ job_id: "a", sealed: "x".repeat(50), expires_at: new Date(NOW - 6 * 60_000).toISOString() });
    await drive({ only: JOB, preset: { jobId: JOB, accessToken: HOUR, headers: { cookie: COOKIE }, origin: SITE } });
    expect(db.tokens).toHaveLength(1);
    await drive();
    expect(db.tokens).toEqual([]);
  });
});

describe("a driver", () => {
  it("with nothing being carried it is one read and done — the cron's every-minute call", async () => {
    expect(await drive()).toEqual({ runs: 0, asked: 0, ended: 0 });
    expect(db.reads).toEqual(["deck_reart_background"]);
    expect(fetchMock).not.toHaveBeenCalled();
    m.adminConfigured.mockReturnValue(false);
    expect(await drive()).toEqual({ runs: 0, asked: 0, ended: 0 });
  });

  it("asks the STEP DOOR for the cards that are left, never more than two at once, and ends the run FINISHED — the maker told once, the kept token erased", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, { steps: stepsOf("done", "pending", "pending", "pending", "pending", "pending"), status: "generating" });
    const result = await drive({ forMs: 240_000 });
    expect(result).toMatchObject({ runs: 1, ended: 1 });
    expect(db.jobs.get(JOB)!.steps.every((s) => s.status === "done")).toBe(true);
    expect(net.busiest).toBe(2);
    expect(theRow()).toMatchObject({ state: "finished", reason: null, driver: null, driven_until: null });
    expect(theRow().finished_at).toBeTruthy();
    expect(db.tokens).toEqual([]);
    expect(db.notices).toEqual([
      {
        recipient_id: ME,
        actor_id: null,
        type: "reart_run",
        payload: { jobId: JOB, deckId: DECK, deckTitle: "Embers of the Fen", state: "finished", reason: null, painted: 6, failed: 0, waiting: 0 },
      },
    ]);
    // The tool's log: counts and codes.
    expect(m.event.mock.calls).toEqual([[{ slug: "re-art-deck", userId: ME, event: "background_finished", access: null, props: { state: "finished", painted: 6, failed: 0, waiting: 0 } }]]);
  });

  it("each ask is the browser's own request: a POST that names no step, with the access-token-only cookie", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(2));
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass-value");
    await drive({ forMs: 240_000 });
    expect(asks().length).toBeGreaterThanOrEqual(2);
    for (const [url, init] of asks()) {
      expect(url).toBe(DOOR);
      expect(init.body).toBe("{}");
      expect(init.headers.cookie).toBe(COOKIE);
      expect(init.headers["x-vercel-protection-bypass"]).toBe("bypass-value");
      expect(init.redirect).toBe("manual");
    }
    // The cookie is made from the kept token ONCE a driver, and holds no refresh token.
    expect(m.setSession.mock.calls).toEqual([[{ access_token: HOUR, refresh_token: "none" }]]);
    // Nothing here calls the driver again: no request to anything but the door
    // (one GET to find it, then the asks).
    expect(fetchMock.mock.calls.every(([url]) => url === DOOR)).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "GET")).toHaveLength(1);
  });

  it("awaits no card: at its time it lets go — the cards being painted go on, the run stays the server's, and the next driver takes it", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(12));
    const first = await drive();
    expect(first).toMatchObject({ runs: 1, ended: 0 });
    // Under a minute: two cards painted, two more being painted.
    const job = db.jobs.get(JOB)!;
    expect(job.steps.filter((s) => s.status === "done")).toHaveLength(2);
    expect(job.steps.filter((s) => s.status === "running")).toHaveLength(2);
    // Let go: its requests hung up, the lease free, the run still running.
    for (const [, init] of asks().slice(-2)) expect(init.signal.aborted).toBe(true);
    expect(theRow()).toMatchObject({ state: "running", driver: null, driven_until: null, door_errors: 0 });
    expect(db.notices).toEqual([]);
    expect(db.tokens).toHaveLength(1);
    // The next minute's driver goes on from there — and no card is painted twice.
    await drive({ forMs: 400_000 });
    expect(job.steps.every((s) => s.status === "done")).toBe(true);
    expect(m.step.mock.calls.length).toBeLessThanOrEqual(12 + 6);
    expect(theRow().state).toBe("finished");
    expect(net.busiest).toBe(2);
  });

  it("while the PAGE is painting two cards it asks for none", async () => {
    db.rows.push(row());
    keep();
    const claimed = new Date(NOW).toISOString();
    db.jobs.set(JOB, { steps: [{ key: "reart:0", status: "running", claimed_at: claimed }, { key: "reart:1", status: "running", claimed_at: claimed }, { key: "reart:2", status: "pending" }], status: "generating" });
    expect(await drive()).toMatchObject({ runs: 1, asked: 0, ended: 0 });
    expect(asks()).toEqual([]);
    // …and with one being painted, for one.
    db.jobs.get(JOB)!.steps[1].status = "done";
    const result = await drive({ forMs: 5_000 });
    expect(result.asked).toBe(1);
  });

  it("a claim that went stale (its request died) is the door's to take back: one ask finds it", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, { steps: [{ key: "reart:0", status: "running", claimed_at: new Date(NOW - 6 * 60_000).toISOString() }], status: "generating" });
    const result = await drive({ forMs: 20_000 });
    expect(result.asked).toBe(1);
    // …and it is not asked over and over while the door doesn't take it.
    expect((await drive({ forMs: 50_000 })).asked).toBeLessThanOrEqual(2);
  });

  it("a run another driver holds is left to it; a lease that lapsed is taken", async () => {
    db.rows.push(row({ driver: OTHER_DRIVER, driven_until: new Date(NOW + 15_000).toISOString() }));
    keep();
    db.jobs.set(JOB, pendingJob(4));
    expect(await drive({ forMs: 9_000 })).toEqual({ runs: 0, asked: 0, ended: 0 });
    expect(theRow().driver).toBe(OTHER_DRIVER);
    expect(asks()).toEqual([]);
    // The other driver died: its lease runs out, and this one takes the run.
    vi.setSystemTime(NOW + 60_000);
    const result = await drive({ forMs: 9_000 });
    expect(result).toMatchObject({ runs: 1 });
    expect(result.asked).toBeGreaterThan(0);
  });

  it("the hand-over's driver, with another driver on its run already, ends at once", async () => {
    db.rows.push(row({ driver: OTHER_DRIVER, driven_until: new Date(NOW + 15_000).toISOString() }));
    db.jobs.set(JOB, pendingJob(4));
    const before = Date.now();
    expect(await drive({ forMs: KICK_MS, only: JOB, preset: { jobId: JOB, accessToken: HOUR, headers: { cookie: COOKIE }, origin: SITE } })).toEqual({ runs: 0, asked: 0, ended: 0 });
    expect(Date.now() - before).toBeLessThan(1_000);
  });

  it("the hand-over's driver works its own run alone, with the session it was just given: nothing about the sign-in is asked again", async () => {
    db.rows.push(row(), { ...row(), job_id: JOB2 });
    keep();
    keep(JOB2);
    db.jobs.set(JOB, pendingJob(2));
    db.jobs.set(JOB2, pendingJob(2));
    const result = await drive({ forMs: KICK_MS, only: JOB, preset: { jobId: JOB, accessToken: HOUR, headers: { "content-type": "application/json", cookie: "given-cookie" }, origin: SITE } });
    expect(result).toMatchObject({ runs: 1, ended: 1 });
    // Every request is an ask (the door was found at the hand-over).
    expect(fetchMock.mock.calls.every(([url, init]) => url === DOOR && init.method === "POST" && init.headers.cookie === "given-cookie")).toBe(true);
    expect(m.setSession).not.toHaveBeenCalled();
    expect(db.reads).not.toContain("deck_reart_background_tokens");
    // The other run is the cron's.
    expect(db.jobs.get(JOB2)!.steps.every((s) => s.status === "pending")).toBe(true);
    expect(theRow(JOB2).driver).toBeNull();
  });

  it("works several makers' runs side by side, each with its own token", async () => {
    db.rows.push(row(), { ...row(), job_id: JOB2 });
    keep();
    const other = token(3000);
    keep(JOB2, other);
    db.jobs.set(JOB, pendingJob(2));
    db.jobs.set(JOB2, pendingJob(2));
    expect(await drive({ forMs: 240_000 })).toMatchObject({ runs: 2, ended: 2 });
    const cookieOf = (jobId: string) => [...new Set(asks().filter(([url]) => String(url).includes(jobId)).map(([, init]) => init.headers.cookie))];
    expect(cookieOf(JOB)).toEqual([COOKIE]);
    expect(cookieOf(JOB2)).toEqual([`sb-abcdefgh-auth-token=base64-${other.slice(0, 40)}`]);
    expect(db.tokens).toEqual([]);
  });

  it("NEVER asks on a token about to expire: with minutes to spare it PAUSES the run (“expired”), erases the token and tells the maker — nothing is refreshed", async () => {
    db.rows.push(row());
    // Five minutes left is NOT enough: a step's last writes come up to three
    // minutes later, and the sign-in library gives a token up 90 s early.
    keep(JOB, token(320));
    db.jobs.set(JOB, pendingJob(2));
    expect(await drive()).toMatchObject({ runs: 1, asked: 0, ended: 1 });
    expect(theRow()).toMatchObject({ state: "paused", reason: "expired" });
    expect(db.tokens).toEqual([]);
    expect(db.notices[0].payload).toMatchObject({ state: "paused", reason: "expired", painted: 0, waiting: 2 });
    expect(m.setSession).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("…and with just enough of it left, it asks", async () => {
    db.rows.push(row());
    keep(JOB, token(400));
    db.jobs.set(JOB, pendingJob(2));
    const result = await drive({ forMs: 5_000 });
    expect(result.asked).toBe(2);
  });

  it("a run the token runs out on mid-way is paused at the next look, with what was painted", async () => {
    db.rows.push(row());
    keep(JOB, token(330 + 40));
    db.jobs.set(JOB, pendingJob(8));
    await drive({ forMs: 240_000 });
    expect(theRow()).toMatchObject({ state: "paused", reason: "expired" });
    // The cards asked for while there was time were let finish.
    const job = db.jobs.get(JOB)!;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(job.steps.filter((s) => s.status === "done").length).toBeGreaterThanOrEqual(2);
    expect(job.steps.filter((s) => s.status === "pending").length).toBeGreaterThanOrEqual(4);
  });

  it("no kept token (it was erased past its own end) pauses the run as expired; one that doesn't open (the server's secret changed) as an error", async () => {
    db.rows.push(row());
    db.jobs.set(JOB, pendingJob(2));
    expect(await drive()).toMatchObject({ asked: 0, ended: 1 });
    expect(theRow()).toMatchObject({ state: "paused", reason: "expired" });
    db.rows[0] = row();
    db.tokens.push({ job_id: JOB, sealed: sealToken(HOUR, JOB2), expires_at: new Date(NOW + 3_600_000).toISOString() });
    expect(await drive()).toMatchObject({ asked: 0, ended: 1 });
    expect(theRow()).toMatchObject({ state: "paused", reason: "error" });
    expect(db.tokens).toEqual([]);
  });

  it("a token the sign-in service refuses now (the maker signed out) carries nothing on: paused, no card asked for", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(2));
    m.setSession.mockResolvedValue({ ok: false });
    expect(await drive()).toMatchObject({ asked: 0, ended: 1 });
    expect(theRow()).toMatchObject({ state: "paused", reason: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a NEW plan-limit failure stops the run and says which limit; one that was there when it was handed over does not", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(6));
    door({ "reart:1": { status: "failed", error_code: "INSUFFICIENT_CREDITS" } });
    await drive({ forMs: 240_000 });
    expect(theRow()).toMatchObject({ state: "stopped", reason: "credits" });
    expect(db.notices[0].payload).toMatchObject({ state: "stopped", reason: "credits", failed: 1 });
    expect(db.jobs.get(JOB)!.steps.filter((s) => s.status === "pending").length).toBeGreaterThanOrEqual(2);
    // Continued after credits were bought: the old failure is not this run's to stop on.
    db.rows[0] = row({ limited_keys: ["reart:1"] });
    keep();
    db.notices.length = 0;
    door();
    await drive({ forMs: 240_000 });
    expect(theRow()).toMatchObject({ state: "finished" });
    expect(db.notices[0].payload).toMatchObject({ state: "finished", painted: 5, failed: 1, waiting: 0 });
    // The card limit is named as itself.
    db.rows[0] = row();
    keep();
    db.jobs.set(JOB, pendingJob(4));
    door({ "reart:0": { status: "failed", error_code: "CARD_CAPACITY" } });
    await drive({ forMs: 240_000 });
    expect(theRow()).toMatchObject({ state: "stopped", reason: "capacity" });
  });

  it("a door that keeps refusing (signed out, the job gone) pauses the run after three refusals — it never spins", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(2));
    m.step.mockResolvedValue({ ok: false, error: "Sign in to continue generation." });
    expect(await drive()).toMatchObject({ runs: 1, ended: 1 });
    expect(theRow()).toMatchObject({ state: "paused", reason: "error" });
    expect(m.step.mock.calls.length).toBeLessThanOrEqual(4);
    expect(db.notices[0].payload).toMatchObject({ state: "paused", reason: "error", painted: 0, waiting: 2 });
    // A door that throws is the same.
    db.rows[0] = row();
    keep();
    m.step.mockReset();
    m.step.mockRejectedValue(new Error("boom"));
    await drive();
    expect(theRow()).toMatchObject({ state: "paused", reason: "error" });
  });

  it("the refusals are counted ACROSS drivers (one a minute would never reach three otherwise), and a card that starts clears them", async () => {
    db.rows.push(row({ door_errors: 2 }));
    keep();
    db.jobs.set(JOB, pendingJob(1));
    m.step.mockResolvedValueOnce({ ok: false, error: "A hiccup." });
    await drive({ forMs: 9_000 });
    expect(theRow()).toMatchObject({ state: "paused", reason: "error" });
    // …while one card that starts begins the count again.
    db.rows[0] = row({ door_errors: 2 });
    keep();
    db.jobs.set(JOB, pendingJob(6));
    door();
    await drive({ forMs: 40_000 });
    expect(theRow()).toMatchObject({ state: "running", door_errors: 0 });
  });

  it("requests it let go of at its end are NOT refusals", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(6));
    for (let minute = 0; minute < 3; minute += 1) await drive({ forMs: 9_000 });
    expect(theRow()).toMatchObject({ state: "running", door_errors: 0 });
  });

  it("waits out the AI's per-minute limit — it is not asked again before the door said; the daily one pauses the run", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(1));
    const slow = { ok: false, reason: "per_minute", retryAfterSeconds: 30, message: "Slow down." };
    m.rate.mockResolvedValueOnce(slow).mockResolvedValue({ ok: true });
    const startedAt = Date.now();
    await drive({ forMs: 240_000 });
    expect(theRow()).toMatchObject({ state: "finished" });
    // One refused ask, then nothing for the 30 s the door named, then the card.
    expect(asks()).toHaveLength(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(60_000);
    db.rows[0] = row();
    keep();
    db.jobs.set(JOB, pendingJob(1));
    m.rate.mockResolvedValue({ ok: false, reason: "per_day", retryAfterSeconds: 3600, message: "Daily quota." });
    m.step.mockClear();
    db.notices.length = 0;
    await drive();
    expect(theRow()).toMatchObject({ state: "paused", reason: "quota" });
    expect(db.notices[0].payload).toMatchObject({ state: "paused", reason: "quota" });
    expect(m.step).not.toHaveBeenCalled();
  });

  it("a 429 that is not the door's own (something in front of it) is a refusal like any other — never “today's AI limit”", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(2));
    fetchMock.mockImplementation(async (_url: string, init: Sent) =>
      init.method === "GET" ? new Response(null, { status: 405 }) : new Response("<html>Too many requests</html>", { status: 429, headers: { "Retry-After": "3600" } }),
    );
    await drive();
    expect(theRow()).toMatchObject({ state: "paused", reason: "error" });
  });

  it("one ask that answers at once does not let the others be asked for twice: never more than two cards at a time", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(8));
    net.claimAfterMs = 7_000;
    const paint = m.step.getMockImplementation()!;
    // The first ask is refused at once; the second is a door still starting up.
    m.step.mockImplementationOnce(async () => ({ ok: false, error: "A hiccup." }));
    m.step.mockImplementation(paint);
    const working = driveBackgroundRuns({ forMs: 240_000, requestUrl: null });
    await vi.advanceTimersByTimeAsync(6_000);
    // One more was asked for (the refused one's place) — not two.
    expect(asks()).toHaveLength(3);
    await settle(working);
    expect(net.busiest).toBe(2);
    expect(theRow().state).toBe("finished");
  });

  it("a door slow to start (a cold function) is not asked for the same cards again while it gets going", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(8));
    // Seven seconds before a card shows as being painted: two looks go by.
    net.claimAfterMs = 7_000;
    const working = driveBackgroundRuns({ forMs: 240_000, requestUrl: null });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(asks()).toHaveLength(2);
    await settle(working);
    expect(net.busiest).toBe(2);
    expect(theRow().state).toBe("finished");
  });

  it("the door can't be found just now: a refusal like any other — three, and the run is paused", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(2));
    net.probe = () => new Response(null, { status: 503 });
    expect(await drive()).toMatchObject({ runs: 1, asked: 0, ended: 1 });
    expect(theRow()).toMatchObject({ state: "paused", reason: "error" });
  });

  it("a fresher token kept since this driver read its own (the maker pressed Continue) is the run's token: it is not paused on the old one's end, and the new one is not erased", async () => {
    db.rows.push(row());
    const old = token(330 + 20);
    keep(JOB, old);
    db.jobs.set(JOB, pendingJob(8));
    const working = driveBackgroundRuns({ forMs: 240_000, requestUrl: null });
    await vi.advanceTimersByTimeAsync(10_000);
    // The hand-over again, with a new session's token.
    const fresh = token(3500);
    db.tokens[0] = { job_id: JOB, sealed: sealToken(fresh, JOB), expires_at: new Date(NOW + 3_500_000).toISOString() };
    await settle(working);
    expect(theRow()).toMatchObject({ state: "finished" });
    const cookies = [...new Set(asks().map(([, init]) => init.headers.cookie))];
    expect(cookies).toEqual([`sb-abcdefgh-auth-token=base64-${old.slice(0, 40)}`, `sb-abcdefgh-auth-token=base64-${fresh.slice(0, 40)}`]);
  });

  it("a run stopped and handed over again within one driver's time starts afresh: nothing of the old sign-in is carried over", async () => {
    db.rows.push(row(), { ...row(), job_id: JOB2 });
    keep();
    keep(JOB2);
    db.jobs.set(JOB, pendingJob(12));
    db.jobs.set(JOB2, pendingJob(12));
    const working = driveBackgroundRuns({ forMs: 120_000, requestUrl: null });
    await vi.advanceTimersByTimeAsync(10_000);
    await requestBackgroundStop(ME, JOB);
    await vi.advanceTimersByTimeAsync(10_000);
    // Continue: the same row, running again, with another session's token.
    const next = token(3000);
    Object.assign(theRow(), { state: "running", reason: null, finished_at: null });
    keep(JOB, next);
    await settle(working);
    const later = asks().filter(([url]) => String(url).includes(JOB)).map(([, init]) => init.headers.cookie);
    expect(later.at(-1)).toBe(`sb-abcdefgh-auth-token=base64-${next.slice(0, 40)}`);
  });

  it("cards a quota put back in line are given the wait they ask for once, then asked for — also when other cards wait behind them", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, { steps: [{ key: "reart:0", status: "pending", error_code: "RATE_LIMITED", retry_after_seconds: 8 }, { key: "reart:1", status: "pending" }], status: "generating" });
    const looking = driveBackgroundRuns({ forMs: 240_000, requestUrl: null });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(asks()).toEqual([]);
    await settle(looking);
    expect(theRow().state).toBe("finished");
  });

  it("a run that was closed (the maker started another run of the deck) is not carried: ended quietly", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, { steps: stepsOf("done", "pending"), status: "cancelled" });
    expect(await drive()).toMatchObject({ asked: 0, ended: 1 });
    expect(theRow()).toMatchObject({ state: "stopped", reason: "stopped" });
    expect(db.notices).toEqual([]);
    expect(db.tokens).toEqual([]);
  });

  it("a run with nothing left is simply finished, whatever driver finds it", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, { steps: stepsOf("done", "failed"), status: "done_with_errors" });
    expect(await drive()).toMatchObject({ asked: 0, ended: 1 });
    expect(db.notices[0].payload).toMatchObject({ state: "finished", painted: 1, failed: 1 });
  });

  it("a read of the run that FAILED is not “nothing left”: it is looked at again", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(1));
    db.fail.push({ table: "ai_generation_jobs", op: "select", error: { message: "timeout" } });
    await drive({ forMs: 240_000 });
    expect(theRow()).toMatchObject({ state: "finished" });
    expect(db.notices).toHaveLength(1);
    logged.mockRestore();
  });

  it("beats as it looks, so the studio knows the server is carrying the run", async () => {
    db.rows.push(row({ beat_at: new Date(NOW - 120_000).toISOString() }));
    keep();
    db.jobs.set(JOB, pendingJob(8));
    await drive();
    expect(Date.parse(theRow().beat_at)).toBeGreaterThan(NOW + 40_000);
  });
});

describe("the maker's Stop", () => {
  it("ends the server's part of the run AT ONCE: no driver asks for another card, the kept token is erased, and no row goes in their bell", async () => {
    db.rows.push(row({ driver: OTHER_DRIVER, driven_until: new Date(NOW + 10_000).toISOString() }));
    keep();
    db.jobs.set(JOB, pendingJob(4));
    expect(await requestBackgroundStop(ME, JOB)).toBe(true);
    expect(theRow()).toMatchObject({ state: "stopped", reason: "stopped", driver: null, driven_until: null });
    expect(theRow().finished_at).toBeTruthy();
    expect(db.tokens).toEqual([]);
    expect(db.notices).toEqual([]);
    expect(await drive()).toEqual({ runs: 0, asked: 0, ended: 0 });
    expect(asks()).toEqual([]);
  });

  it("is the caller's own run's alone", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(2));
    expect(await requestBackgroundStop("44444444-4444-4444-8444-444444444444", JOB)).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(theRow().state).toBe("running");
    expect(db.tokens).toHaveLength(1);
    m.adminConfigured.mockReturnValue(false);
    expect(await requestBackgroundStop(ME, JOB)).toBe(false);
  });

  it("a Stop that arrives BEFORE the run's hand-over is left where the hand-over will find it: the server never starts carrying a run its maker already stopped", async () => {
    db.jobs.set(JOB, pendingJob(8));
    expect(await requestBackgroundStop(ME, JOB)).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(theRow()).toMatchObject({ job_id: JOB, owner_id: ME, deck_id: DECK, state: "stopped", reason: "stopped" });
    expect(theRow().finished_at).toBeTruthy();
    // The hand-over lands a moment later — the page may be gone by now.
    expect(await settle(startBackground({ userId: ME, jobId: JOB, deckId: DECK, accessToken: HOUR, steps: [], requestUrl: null, first: true }))).toEqual({ ok: false, reason: "stopped" });
    expect(db.tokens).toEqual([]);
    expect(await drive()).toEqual({ runs: 0, asked: 0, ended: 0 });
    expect(asks()).toEqual([]);
  });

  it("…and nothing is left for a run that is over, another kind of job, or somebody else's", async () => {
    db.jobs.set(JOB, { steps: stepsOf("done"), status: "done" });
    expect(await requestBackgroundStop(ME, JOB)).toBe(true);
    db.jobs.set(JOB, { ...pendingJob(2), kind: "deck" });
    expect(await requestBackgroundStop(ME, JOB)).toBe(true);
    db.jobs.set(JOB, { ...pendingJob(2), owner: "44444444-4444-4444-8444-444444444444" });
    expect(await requestBackgroundStop(ME, JOB)).toBe(true);
    expect(await requestBackgroundStop(ME, JOB2)).toBe(true);
    expect(db.rows).toEqual([]);
  });

  it("a Stop and a hand-over that cross: whichever writes second, the run ends stopped", async () => {
    db.jobs.set(JOB, pendingJob(8));
    // The hand-over's row appears between the Stop's two writes.
    db.fail.push({ table: "deck_reart_background", op: "insert", error: { message: "duplicate key", code: "23505" } });
    db.rows.push(row());
    keep();
    // (The Stop's first look found nothing running: simulated by a row it can't see yet.)
    theRow().state = "paused";
    const stopping = requestBackgroundStop(ME, JOB);
    theRow().state = "running";
    expect(await stopping).toBe(true);
    expect(theRow()).toMatchObject({ state: "stopped", reason: "stopped" });
    expect(db.tokens).toEqual([]);
  });

  it("a Stop that could not be recorded says so (the page then says the server may still be painting)", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.jobs.set(JOB, pendingJob(2));
    db.fail.push({ table: "deck_reart_background", op: "insert", error: { message: "boom" } });
    expect(await requestBackgroundStop(ME, JOB)).toBe(false);
    db.fail.push({ table: "ai_generation_jobs", op: "select", error: { message: "timeout" } });
    expect(await requestBackgroundStop(ME, JOB)).toBe(false);
    db.rows.push(row());
    db.fail.push({ table: "deck_reart_background", op: "update", error: { message: "boom" } });
    expect(await requestBackgroundStop(ME, JOB)).toBe(false);
    logged.mockRestore();
  });

  it("a driver at work notices at its next look and asks for nothing more", async () => {
    db.rows.push(row());
    keep();
    db.jobs.set(JOB, pendingJob(8));
    const working = driveBackgroundRuns({ forMs: 240_000, requestUrl: null });
    await vi.advanceTimersByTimeAsync(10_000);
    await requestBackgroundStop(ME, JOB);
    const asked = asks().length;
    await settle(working);
    expect(asks().length).toBe(asked);
    expect(theRow()).toMatchObject({ state: "stopped", reason: "stopped" });
    expect(db.notices).toEqual([]);
  });
});

describe("what a run came to", () => {
  it("counts the cards painted, the ones that didn't, and the ones still to paint", () => {
    expect(countsOf(stepsOf("done", "done", "failed", "pending", "running"))).toEqual({ painted: 2, failed: 1, waiting: 2 });
    expect(countsOf([])).toEqual({ painted: 0, failed: 0, waiting: 0 });
  });
});
