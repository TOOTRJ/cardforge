import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The referral code a sign-up arrives with (`attr_ref`, the tab's first
// touch) is kept on the ACCOUNT — `app_metadata.referral_code`, which only
// the server writes — and claimed later, at onboarding. FIRST TOUCH WINS
// there too (owner 2026-11-11): GoTrue hands an address that is still
// waiting for its confirmation back as the SAME user, so a second sign-up
// with another link must not take the referral over. The code is written
// only when the returned user does not already carry a valid one.
// The Supabase clients are stubs; what's under test is the one admin write.
// ---------------------------------------------------------------------------

type SignedUpUser = { id: string; identities: unknown[]; app_metadata?: Record<string, unknown> | null };

const s = vi.hoisted(() => ({
  record: vi.fn(),
  /** admin.auth.admin.updateUserById */
  update: vi.fn<(id: string, attributes: Record<string, unknown>) => Promise<{ error: { message: string } | null }>>(async () => ({ error: null })),
  user: { id: "u-new", identities: [{}], app_metadata: {} } as SignedUpUser,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({ auth: { admin: { updateUserById: s.update } } }),
}));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordFunnelEvent: s.record }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    auth: {
      signUp: async () => ({ data: { user: s.user }, error: null }),
      getSession: async () => ({ data: { session: null } }),
    },
  }),
}));

import { signupAction } from "@/app/(auth)/actions";

/** The link the visitor arrived through, and another one. */
const CODE = "abcd2345";
const OTHER_CODE = "0f0f0f0f";

function form(extra: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set("email", "new@dev.pipglyph.test");
  data.set("username", "new_maker");
  // Generated per run: the clients are stubs, and the repo holds no passwords.
  data.set("password", `${crypto.randomUUID()}Aa1!`);
  for (const [k, v] of Object.entries(extra)) data.set(k, v);
  return data;
}

const signUp = (extra: Record<string, string> = {}) => signupAction({ status: "idle" } as never, form(extra));

beforeEach(() => {
  s.record.mockReset();
  s.update.mockReset().mockResolvedValue({ error: null });
  s.user = { id: "u-new", identities: [{}], app_metadata: {} };
});

describe("signupAction — the referral code on the account", () => {
  it("a new account through a link: the code goes on app_metadata.referral_code, once, by the service role", async () => {
    expect((await signUp({ attr_ref: CODE })).status).toBe("sent");
    expect(s.update.mock.calls).toEqual([["u-new", { app_metadata: { referral_code: CODE } }]]);
  });

  it("the code is normalised before it is written (the link's case and spaces are not kept)", async () => {
    await signUp({ attr_ref: "  ABCD2345 " });
    expect(s.update.mock.calls).toEqual([["u-new", { app_metadata: { referral_code: CODE } }]]);
  });

  it("FIRST TOUCH WINS: a returned user that already carries a valid code is not overwritten by another link", async () => {
    // An address still waiting for its confirmation, signed up again through
    // someone else's link: GoTrue answers with the same user.
    s.user = { id: "u-new", identities: [{}], app_metadata: { provider: "email", referral_code: OTHER_CODE } };
    expect((await signUp({ attr_ref: CODE })).status).toBe("sent");
    expect(s.update).not.toHaveBeenCalled();
    // …nor rewritten with the same one, nor by a code that only differs in case.
    await signUp({ attr_ref: OTHER_CODE });
    s.user = { id: "u-new", identities: [{}], app_metadata: { referral_code: "ABCD2345" } };
    await signUp({ attr_ref: OTHER_CODE });
    expect(s.update).not.toHaveBeenCalled();
  });

  it.each([
    ["no app_metadata at all", undefined],
    ["a null app_metadata", null],
    ["an app_metadata with no code", { provider: "email" }],
    ["a null code", { referral_code: null }],
    ["an empty code", { referral_code: "" }],
    ["a code that is not 8 hex characters", { referral_code: "not-a-code" }],
    ["a code one character short", { referral_code: "abcd234" }],
    ["a code one character long", { referral_code: "abcd23456" }],
    ["a code that is not a string", { referral_code: 12345678 }],
  ])("a returned user with %s has no code yet: the link's is written", async (_label, appMetadata) => {
    s.user = { id: "u-new", identities: [{}], app_metadata: appMetadata as SignedUpUser["app_metadata"] };
    await signUp({ attr_ref: CODE });
    expect(s.update.mock.calls).toEqual([["u-new", { app_metadata: { referral_code: CODE } }]]);
  });

  it("no link, or a value that is no code: nothing is written", async () => {
    await signUp();
    await signUp({ attr_ref: "<script>" });
    await signUp({ attr_ref: "abcd234" });
    await signUp({ attr_referrer: "reddit.com", attr_surface: "home_hero" });
    expect(s.update).not.toHaveBeenCalled();
  });

  it("an address already registered (an obfuscated user, no identities) gets nothing written, link or not", async () => {
    s.user = { id: "u-existing", identities: [], app_metadata: {} };
    expect((await signUp({ attr_ref: CODE })).status).toBe("sent");
    expect(s.update).not.toHaveBeenCalled();
    expect(s.record).not.toHaveBeenCalled();
  });

  it("the funnel row says the account was referred — never the code — whether the code was written or already there", async () => {
    await signUp({ attr_ref: CODE });
    s.user = { id: "u-new", identities: [{}], app_metadata: { referral_code: OTHER_CODE } };
    await signUp({ attr_ref: CODE });
    expect(s.record).toHaveBeenCalledTimes(2);
    for (const call of s.record.mock.calls) {
      expect(call[1]).toEqual({ event: "signup", userId: "u-new", props: { referred: true, method: "email" } });
    }
    expect(JSON.stringify(s.record.mock.calls)).not.toContain(CODE);
    expect(JSON.stringify(s.record.mock.calls)).not.toContain(OTHER_CODE);
  });

  it("a write that fails never fails the sign-up: the answer is the same and the funnel row is still recorded", async () => {
    s.update.mockResolvedValue({ error: { message: "auth is away" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await signUp({ attr_ref: CODE })).toEqual({ status: "sent", values: { email: "new@dev.pipglyph.test" } });
    expect(s.update).toHaveBeenCalledTimes(1);
    expect(s.record).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
