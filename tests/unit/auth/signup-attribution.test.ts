import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The signup funnel row carries the tab's first touch AND the create button
// pressed last (owner 2026-11-04: `surface`, posted as `attr_surface`). The
// Supabase clients are stubs; what's under test is what reaches the row.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ record: vi.fn(), identities: [{}] as unknown[] }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => true, createAdminClient: () => ({}) }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordFunnelEvent: s.record }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    auth: {
      signUp: async () => ({ data: { user: { id: "u-new", identities: s.identities } }, error: null }),
      getSession: async () => ({ data: { session: null } }),
    },
  }),
}));

import { signupAction } from "@/app/(auth)/actions";

function form(extra: Record<string, string>): FormData {
  const data = new FormData();
  data.set("email", "new@dev.pipglyph.test");
  data.set("username", "new_maker");
  // Generated per run: the clients are stubs, and the repo holds no passwords.
  data.set("password", `${crypto.randomUUID()}Aa1!`);
  for (const [k, v] of Object.entries(extra)) data.set(k, v);
  return data;
}

beforeEach(() => {
  s.record.mockReset();
  s.identities = [{}];
});

describe("signupAction's funnel row", () => {
  it("records the referrer and the create button the visitor pressed last", async () => {
    const result = await signupAction({ status: "idle" } as never, form({ attr_referrer: "reddit.com", attr_surface: "home_hero" }));
    expect(result.status).toBe("sent");
    expect(s.record).toHaveBeenCalledWith(expect.anything(), {
      event: "signup",
      userId: "u-new",
      props: { referrer: "reddit.com", surface: "home_hero" },
    });
  });

  it("drops an unsafe button value, and records nothing for an address already registered", async () => {
    await signupAction({ status: "idle" } as never, form({ attr_surface: "<img onerror>" }));
    expect(s.record.mock.calls[0][1].props).toEqual({});
    s.record.mockReset();
    s.identities = [];
    await signupAction({ status: "idle" } as never, form({ attr_surface: "home_hero" }));
    expect(s.record).not.toHaveBeenCalled();
  });
});
