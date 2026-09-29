import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_CHUNK,
  AppEndpointError,
  PRODUCTION_APP_URL,
  PURGE_CHUNK,
  appUrlProblem,
  createAppEndpoint,
  sameSupabaseProject,
} from "@/scripts/lib/app-endpoint.mjs";

// ---------------------------------------------------------------------------
// scripts/lib/app-endpoint.mjs — how the owner-run storage script reaches
// POST /api/admin/storage-sweep (owner answers 2026-09-29: act on the rows
// that use a flagged file through the app's own code paths; purge the CDN
// copies of a private card's render — only the app on Vercel can). The
// secret goes only where it should, a redirect is refused, and nothing is
// done through an app that talks to another database than the script's
// --target.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(ROOT, "scripts/sweep-storage-orphans.mjs");
const DEV = "znipzaxgpaiandwiqabn.supabase.co";

type Sent = { url: string; init: RequestInit & { body: string } };

function fakeFetch(answer: (body: Record<string, unknown>) => { status?: number; json?: unknown } | Error) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: RequestInit & { body: string }) => {
    sent.push({ url, init });
    const a = answer(JSON.parse(init.body));
    if (a instanceof Error) throw a;
    return new Response(a.json === undefined ? "not json" : JSON.stringify(a.json), { status: a.status ?? 200 });
  };
  return { fetch, sent };
}
const ok = (extra: Record<string, unknown> = {}) => ({ json: { ok: true, supabaseHost: DEV, vercel: true, ...extra } });

describe("where the secret may go", () => {
  it("https, or http on loopback (a local dev server) — an origin, no path, no credentials", () => {
    expect(appUrlProblem("https://www.pipglyph.com")).toBeNull();
    expect(appUrlProblem("http://localhost:3000")).toBeNull();
    expect(appUrlProblem("http://127.0.0.1:3300")).toBeNull();
    expect(appUrlProblem("http://www.pipglyph.com")).toMatch(/https only/);
    expect(appUrlProblem("http://192.168.1.10:3000")).toMatch(/https only/);
    expect(appUrlProblem("https://www.pipglyph.com/api")).toMatch(/origin only/);
    expect(appUrlProblem("https://www.pipglyph.com/?x=1")).toMatch(/origin only/);
    expect(appUrlProblem("https://user:pw@www.pipglyph.com")).toMatch(/credentials/);
    expect(appUrlProblem("not a url")).toMatch(/not a URL/);
    expect(() => createAppEndpoint({ baseUrl: "http://evil.example", secret: "s", targetHost: DEV })).toThrow(AppEndpointError);
    expect(() => createAppEndpoint({ baseUrl: "http://localhost:3000", secret: "", targetHost: DEV })).toThrow(/no CRON_SECRET/);
  });

  it("the same database: the same host, or production's two hosts", () => {
    expect(sameSupabaseProject(DEV, DEV)).toBe(true);
    expect(sameSupabaseProject("127.0.0.1:54321", "127.0.0.1:54321")).toBe(true);
    expect(sameSupabaseProject("auth.pipglyph.com", "zkwkisxoqdhdchqyjwdc.supabase.co")).toBe(true);
    expect(sameSupabaseProject(DEV, "zkwkisxoqdhdchqyjwdc.supabase.co")).toBe(false);
    expect(sameSupabaseProject("auth.pipglyph.com", DEV)).toBe(false);
    expect(sameSupabaseProject(null, DEV)).toBe(false);
    expect(sameSupabaseProject("", "")).toBe(false);
  });

  it("production's app is fixed, and its CRON_SECRET comes only from the hidden prompt (never a file or the environment)", () => {
    expect(PRODUCTION_APP_URL).toBe("https://www.pipglyph.com");
    const source = readFileSync(SCRIPT, "utf8");
    const body = source.slice(source.indexOf("async function appFor()"), source.indexOf("// --- run ---"));
    expect(body).toMatch(/if \(target === "prod"\) \{\n\s+baseUrl = PRODUCTION_APP_URL;\n\s+secret = await promptHidden\(/);
    expect(body).not.toMatch(/process\.env/);
    expect(source).toMatch(/if \(values\.has\("--app-url"\)\) fail\(`--app-url is for the dev target; production's app is \$\{PRODUCTION_APP_URL\}\.`\);/);
  });
});

describe("calls", () => {
  it("POSTs JSON with the bearer to /api/admin/storage-sweep, refusing redirects", async () => {
    const f = fakeFetch(() => ok());
    const app = createAppEndpoint({ baseUrl: "http://localhost:3000", secret: "s3cret", targetHost: DEV, fetch: f.fetch as never });
    expect(app.url).toBe("http://localhost:3000/api/admin/storage-sweep");
    expect(await app.whoami()).toMatchObject({ supabaseHost: DEV, vercel: true });
    expect(f.sent).toHaveLength(1);
    const { init } = f.sent[0];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer s3cret", "content-type": "application/json" });
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toEqual({ op: "whoami" });
  });

  it("refuses an app on another database — on every call, not just the first", async () => {
    let host = DEV;
    const f = fakeFetch(() => ({ json: { ok: true, supabaseHost: host, vercel: true } }));
    const app = createAppEndpoint({ baseUrl: "http://localhost:3000", secret: "s", targetHost: DEV, fetch: f.fetch as never });
    await app.whoami();
    host = "zkwkisxoqdhdchqyjwdc.supabase.co";
    await expect(app.purgeCards(["a"])).rejects.toThrow(/talks to database zkwkisxoqdhdchqyjwdc\.supabase\.co, not znipzaxgpaiandwiqabn\.supabase\.co/);
    const noHost = fakeFetch(() => ({ json: { ok: true } }));
    await expect(createAppEndpoint({ baseUrl: "http://localhost:3000", secret: "s", targetHost: DEV, fetch: noHost.fetch as never }).whoami()).rejects.toThrow(
      /an unknown database/,
    );
  });

  it("a refused secret, an error answer, not JSON and no answer are AppEndpointErrors — never echoing the secret", async () => {
    const cases: Array<[ReturnType<typeof fakeFetch>, RegExp]> = [
      [fakeFetch(() => ({ status: 401, json: { ok: false, error: "Unauthorized" } })), /refused the CRON_SECRET \(HTTP 401\)/],
      [fakeFetch(() => ({ status: 400, json: { ok: false, error: "not a uuid" } })), /HTTP 400 — not a uuid/],
      [fakeFetch(() => ({ status: 502 })), /HTTP 502$/],
      [fakeFetch(() => ({ status: 200, json: { ok: false } })), /HTTP 200$/],
      [fakeFetch(() => new TypeError("fetch failed")), /no answer, or it redirected/],
      [fakeFetch(() => Object.assign(new Error("t"), { name: "TimeoutError" })), /timed out/],
    ];
    for (const [f, message] of cases) {
      const app = createAppEndpoint({ baseUrl: "http://localhost:3000", secret: "top-secret-value", targetHost: DEV, fetch: f.fetch as never });
      const err = await app.whoami().catch((e) => e);
      expect(err).toBeInstanceOf(AppEndpointError);
      expect(err.message).toMatch(message);
      expect(err.message).not.toContain("top-secret-value");
    }
  });

  it("chunks purges and row actions at the route's caps, deduplicating card ids", async () => {
    const f = fakeFetch((body) =>
      body.op === "flagged-file"
        ? ok({ results: (body.actions as unknown[]).map((action) => ({ action, status: "done", detail: "ok" })) })
        : ok({ purged: (body.cardIds as unknown[] | undefined)?.length }),
    );
    const app = createAppEndpoint({ baseUrl: "http://localhost:3000", secret: "s", targetHost: DEV, fetch: f.fetch as never });
    const ids = Array.from({ length: PURGE_CHUNK + 5 }, (_, i) => `id-${i}`);
    expect(await app.purgeCards([...ids, ids[0]])).toEqual({ purged: PURGE_CHUNK + 5, vercel: true });
    expect(f.sent.map((s) => (JSON.parse(s.init.body).cardIds as string[]).length)).toEqual([PURGE_CHUNK, 5]);

    f.sent.length = 0;
    const actions = Array.from({ length: ACTION_CHUNK + 1 }, (_, i) => ({ kind: "hide-card", cardId: `c${i}` }));
    const results = await app.flaggedFile({ bucket: "card-art", path: "u/f.png" }, actions);
    expect(results).toHaveLength(ACTION_CHUNK + 1);
    expect(f.sent.map((s) => JSON.parse(s.init.body).actions.length)).toEqual([ACTION_CHUNK, 1]);
    expect(JSON.parse(f.sent[0].init.body).file).toEqual({ bucket: "card-art", path: "u/f.png" });
  });
});
