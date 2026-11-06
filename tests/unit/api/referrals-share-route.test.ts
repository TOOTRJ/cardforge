import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// GET /api/referrals/share — the program switch, the friend's reward words,
// the activation bar (0180), and the viewer's code (null for a visitor).
// Never cached.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  sessionCookie: false,
  user: null as null | { id: string },
  settings: { enabled: true, friend: { days: 7 } } as Record<string, unknown>,
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
    activation: { cardsRequired: 5, windowDays: 30 },
    friend: s.settings.friend,
    ladder: [{ kind: "days", days: 7 }],
    tail: { kind: "days", days: 7 },
    caps: { friendsPerMonth: 5 },
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
  s.settings = { enabled: true, friend: { days: 7 } };
  s.code = "ab12cd34";
  s.billing = true;
});

describe("GET /api/referrals/share", () => {
  it("a visitor: the program and the friend's words, no code", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ enabled: true, friendGets: "7 free days", cardsRequired: 5, windowDays: 30, signupDays: 7, code: null });
  });
  it("a signed-in viewer: their code, normalised", async () => {
    s.sessionCookie = true;
    s.user = { id: "u1" };
    s.code = "AB12CD34";
    expect(await (await GET()).json()).toEqual({ enabled: true, friendGets: "7 free days", cardsRequired: 5, windowDays: 30, signupDays: 7, code: "ab12cd34" });
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
    const off = { enabled: false, friendGets: null, cardsRequired: null, windowDays: null, signupDays: null, code: null };
    expect(await (await GET()).json()).toEqual(off);
    s.settings = { ...s.settings, enabled: true };
    s.billing = false;
    expect(await (await GET()).json()).toEqual(off);
  });
  it("a friend reward of 0 days reads 'nothing'", async () => {
    s.settings = { enabled: true, friend: { days: 0 } };
    expect((await (await GET()).json()).friendGets).toBe("nothing");
  });
});
