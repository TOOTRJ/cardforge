import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// POST /api/steps — the browser's funnel steps. Allow-listed names, sanitized
// props, same-site only, anonymous rows without an identifier, always 204.
// (The path was /api/events until 2026-11: the last block holds the rename.)
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  sessionCookie: false,
  user: null as null | { id: string },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => (s.sessionCookie ? [{ name: "sb-x-auth-token" }] : []) }),
}));
vi.mock("@/lib/supabase/session-cookie", () => ({
  isSupabaseAuthCookieName: (name: string) => name.startsWith("sb-"),
}));
const getCurrentUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ getCurrentUser: async () => getCurrentUser() ?? s.user }));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        s.inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "fe_1" }, error: null }) }) };
      },
    }),
  }),
}));

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { POST } from "@/app/api/steps/route";
import { POST as POST_OLD_PATH } from "@/app/api/events/route";
import { FUNNEL_STEPS_ENDPOINT } from "@/lib/analytics/funnel-events";

const requestTo = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "text/plain", "sec-fetch-site": "same-origin", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const post = (body: unknown, headers: Record<string, string> = {}) => POST(requestTo(FUNNEL_STEPS_ENDPOINT, body, headers));

/** Every .ts / .tsx file under the given folders. */
function sourceFiles(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) out.push(path);
    }
  };
  roots.forEach(walk);
  return out;
}

beforeEach(() => {
  s.inserts = [];
  s.sessionCookie = false;
  s.user = null;
  getCurrentUser.mockClear();
});

describe("POST /api/steps", () => {
  it("records an allow-listed client event for an anonymous visitor with no identifier", async () => {
    const res = await post({ event: "pricing_view", props: { surface: "pricing", email: "x@y.z" } });
    expect(res.status).toBe(204);
    expect(s.inserts).toEqual([
      { event: "pricing_view", user_id: null, props: { surface: "pricing", signedIn: false }, source: "client" },
    ]);
  });

  it("attributes the row to the signed-in user when a session cookie is present", async () => {
    s.sessionCookie = true;
    s.user = { id: "user-1" };
    await post({ event: "cta_click", props: { surface: "billing", kind: "pack", pack: "mini" } });
    expect(s.inserts[0]).toMatchObject({ event: "cta_click", user_id: "user-1", props: { pack: "mini", signedIn: true } });
  });

  it("ignores known crawlers (isbot) — still 204, nothing recorded", async () => {
    const res = await post({ event: "pricing_view", props: { surface: "pricing" } }, {
      "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    });
    expect(res.status).toBe(204);
    expect(s.inserts).toEqual([]);
    await post({ event: "pricing_view" }, { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36" });
    expect(s.inserts).toHaveLength(1);
  });

  it("ignores unknown or server-only event names, cross-site callers, bad JSON and oversized bodies — still 204", async () => {
    expect((await post({ event: "checkout_completed" })).status).toBe(204);
    expect((await post({ event: "nope" })).status).toBe(204);
    expect((await post({ event: "pricing_view" }, { "sec-fetch-site": "cross-site" })).status).toBe(204);
    expect((await post("{not json")).status).toBe(204);
    expect((await post({ event: "pricing_view", props: { reason: "x".repeat(3000) } })).status).toBe(204);
    expect(s.inserts).toEqual([]);
  });
});

describe("POST /api/steps — screen_width (TODO WD9)", () => {
  it("records the bucket alone, with no identifier and no signedIn", async () => {
    const res = await post({ event: "screen_width", props: { bucket: "1366-1535" } });
    expect(res.status).toBe(204);
    expect(s.inserts).toEqual([{ event: "screen_width", user_id: null, props: { bucket: "1366-1535" }, source: "client" }]);
  });

  it("stays anonymous for a signed-in visitor — the session is never read", async () => {
    s.sessionCookie = true;
    s.user = { id: "user-1" };
    await post({ event: "screen_width", props: { bucket: "1920-2559" } });
    expect(s.inserts).toEqual([{ event: "screen_width", user_id: null, props: { bucket: "1920-2559" }, source: "client" }]);
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("drops every other prop a body might carry — the exact width, the screen, the UA, any id", async () => {
    await post({
      event: "screen_width",
      props: {
        bucket: "0-639",
        width: 390,
        screen: "1170x2532",
        userAgent: "Mozilla/5.0",
        userId: "user-1",
        sessionId: "s-1",
        referrer: "google.com",
        signedIn: true,
      },
    });
    expect(s.inserts).toEqual([{ event: "screen_width", user_id: null, props: { bucket: "0-639" }, source: "client" }]);
  });

  it("records nothing without a known bucket", async () => {
    for (const props of [{}, { bucket: "1440" }, { bucket: 1440 }, { width: 1440 }, null]) {
      expect((await post({ event: "screen_width", props })).status).toBe(204);
    }
    expect(s.inserts).toEqual([]);
  });

  it("drops crawlers like every browser event", async () => {
    await post({ event: "screen_width", props: { bucket: "1024-1365" } }, {
      "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    });
    expect(s.inserts).toEqual([]);
  });
});

// The 2026-11 rename (owner decision 2026-11-11). EasyPrivacy's generic rule
// `/api/events|$ping,~third-party` cancels a site's OWN sendBeacon to any
// address ending in /api/events, so a visitor with a blocker was in none of
// the browser steps while the server's steps counted them.
describe("the steps route's address", () => {
  it("is /api/steps, and a route file answers there", () => {
    expect(FUNNEL_STEPS_ENDPOINT).toBe("/api/steps");
    expect(existsSync(`app${FUNNEL_STEPS_ENDPOINT}/route.ts`)).toBe(true);
  });

  // Endings the public lists catch for a first-party ping or fetch (read
  // 2026-11-11: EasyPrivacy, EasyList, uBlock's privacy list). Not the lists
  // themselves — a rename is still checked against them — but the words a
  // tracking endpoint is usually given, so the next rename can't walk back
  // into one.
  it("does not end in a word the blocker lists catch for a site's own beacons", () => {
    const caught = ["events", "event", "collect", "track", "tracking", "analytics", "telemetry", "beacon", "metrics", "pixel", "log", "logs", "stats", "ping"];
    const last = FUNNEL_STEPS_ENDPOINT.split("/").at(-1)!;
    expect(caught).not.toContain(last);
    expect(caught).toContain("events"); // the ending that was caught
  });

  it("the browser posts there and nowhere else — nothing in the app still names the old path as an address", () => {
    const client = readFileSync("lib/analytics/funnel-client.ts", "utf8");
    expect(client).toContain("navigator.sendBeacon(FUNNEL_STEPS_ENDPOINT");
    expect(client).toContain("fetch(FUNNEL_STEPS_ENDPOINT");
    // The path as a string someone could post to: quoted, then the end of the string or a query.
    const asAddress = /["'`]\/api\/events["'`/?]/;
    const stillNamed = sourceFiles(["app", "components", "lib"]).filter((file) => asAddress.test(readFileSync(file, "utf8")));
    expect(stillNamed).toEqual([]);
  });

  it("the old path still answers with the same handler, for a tab that loaded its script before the rename", async () => {
    const res = await POST_OLD_PATH(requestTo("/api/events", { event: "pricing_view", props: { surface: "pricing", email: "x@y.z" } }));
    expect(res.status).toBe(204);
    expect(s.inserts).toEqual([
      { event: "pricing_view", user_id: null, props: { surface: "pricing", signedIn: false }, source: "client" },
    ]);
    // …and by the same rules: a crawler, a cross-site caller and a server-only name record nothing.
    await POST_OLD_PATH(requestTo("/api/events", { event: "pricing_view" }, { "sec-fetch-site": "cross-site" }));
    await POST_OLD_PATH(requestTo("/api/events", { event: "checkout_completed" }));
    expect(s.inserts).toHaveLength(1);
  });

  it("both route files are the one handler and nothing more", () => {
    for (const file of ["app/api/steps/route.ts", "app/api/events/route.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain('import { handleFunnelStep } from "@/lib/analytics/funnel-step-route";');
      expect(source, file).toContain("return handleFunnelStep(request);");
      expect(source, file).toContain('export const dynamic = "force-dynamic";');
    }
  });
});
