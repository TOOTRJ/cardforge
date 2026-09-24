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
vi.mock("@/lib/supabase/server", () => ({ getCurrentUser: async () => s.user }));
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

  it("ignores unknown or server-only event names, cross-site callers, bad JSON and oversized bodies — still 204", async () => {
    expect((await post({ event: "checkout_completed" })).status).toBe(204);
    expect((await post({ event: "nope" })).status).toBe(204);
    expect((await post({ event: "pricing_view" }, { "sec-fetch-site": "cross-site" })).status).toBe(204);
    expect((await post("{not json")).status).toBe(204);
    expect((await post({ event: "pricing_view", props: { reason: "x".repeat(3000) } })).status).toBe(204);
    expect(s.inserts).toEqual([]);
  });
});
