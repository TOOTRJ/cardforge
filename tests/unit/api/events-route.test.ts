import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// POST /api/events — the browser's funnel steps. Allow-listed names, sanitized
// props, same-site only, anonymous rows without an identifier, always 204.
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

import { POST } from "@/app/api/events/route";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "text/plain", "sec-fetch-site": "same-origin", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  s.inserts = [];
  s.sessionCookie = false;
  s.user = null;
  getCurrentUser.mockClear();
});

describe("POST /api/events", () => {
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

describe("POST /api/events — screen_width (TODO WD9)", () => {
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
