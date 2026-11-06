import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// GET /api/referrals/share — the program switch, the friend's reward words,
// and the viewer's code (null for a visitor). Never cached.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  sessionCookie: false,
  user: null as null | { id: string },
  settings: { enabled: true, friend: { kind: "free_days", tier: "plus", units: 1 } } as Record<string, unknown>,
  code: "ab12cd34" as unknown,
  billing: true,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => (s.sessionCookie ? [{ name: "sb-x-auth-token" }] : []) }),
}));
vi.mock("@/lib/supabase/session-cookie", () => ({ isSupabaseAuthCookieName: (name: string) => name.startsWith("sb-") }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => s.billing }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => ({ from: () => ({}) }) }));
vi.mock("@/lib/referrals/settings-server", () => ({
  readReferralSettings: async () => ({
    enabled: s.settings.enabled,
    friend: s.settings.friend,
    referrer: { kind: "free_days", tier: "own", units: 1 },
    caps: { perMonth: 3, lifetime: 12, friendsPerMonth: 5 },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => s.user,
  createClient: async () => ({ rpc: async () => ({ data: s.code, error: null }) }),
}));

import { GET } from "@/app/api/referrals/share/route";

beforeEach(() => {
  s.sessionCookie = false;
  s.user = null;
  s.settings = { enabled: true, friend: { kind: "free_days", tier: "plus", units: 1 } };
  s.code = "ab12cd34";
  s.billing = true;
});

describe("GET /api/referrals/share", () => {
  it("a visitor: the program and the friend's words, no code", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ enabled: true, friendGets: "30 free days of Plus", code: null });
  });
  it("a signed-in viewer: their code, normalised", async () => {
    s.sessionCookie = true;
    s.user = { id: "u1" };
    s.code = "AB12CD34";
    expect(await (await GET()).json()).toEqual({ enabled: true, friendGets: "30 free days of Plus", code: "ab12cd34" });
  });
  it("a malformed code is no code", async () => {
    s.sessionCookie = true;
    s.user = { id: "u1" };
    s.code = "not-a-code!";
    expect((await (await GET()).json()).code).toBeNull();
  });
  it("the program OFF (or billing off) answers off, with no words and no code — even signed in", async () => {
    s.sessionCookie = true;
    s.user = { id: "u1" };
    s.settings = { ...s.settings, enabled: false };
    expect(await (await GET()).json()).toEqual({ enabled: false, friendGets: null, code: null });
    s.settings = { ...s.settings, enabled: true };
    s.billing = false;
    expect(await (await GET()).json()).toEqual({ enabled: false, friendGets: null, code: null });
  });
  it("a credits reward reads in its own words", async () => {
    s.settings = { enabled: true, friend: { kind: "credits", amount: 20 } };
    expect((await (await GET()).json()).friendGets).toBe("20 AI credits");
  });
});
