import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// TODO HM6: /auth/callback is the ONE OAuth return for every provider. A
// provider's refusal (the visitor pressed Cancel on Discord's screen, an
// unverified provider email, anything else GoTrue sends back) never reaches
// the code exchange and lands on /login with a calm, account-blind message
// — and the redirect, so a retry goes where the visitor was going.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ exchange: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: s.exchange } }),
}));

import { GET } from "@/app/(auth)/auth/callback/route";
import { isOAuthCallbackError, oauthCallbackErrorOf } from "@/lib/auth/oauth-callback-error";

const ORIGIN = "https://www.pipglyph.test";

async function land(query: string): Promise<URL> {
  const res = await GET(new NextRequest(`${ORIGIN}/auth/callback?${query}`));
  expect(res.status).toBe(307);
  return new URL(res.headers.get("location")!);
}

afterEach(() => {
  s.exchange.mockReset();
  vi.restoreAllMocks();
});

describe("/auth/callback", () => {
  it("a cancel on the provider's screen is 'oauth-cancelled', with the redirect kept", async () => {
    const url = await land(
      "redirectTo=%2Fdecks%2Fnew&error=access_denied&error_description=The+resource+owner+denied+the+request",
    );
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe("oauth-cancelled");
    expect(url.searchParams.get("redirectTo")).toBe("/decks/new");
    expect(s.exchange).not.toHaveBeenCalled();
  });

  it("an unverified provider email is 'oauth-verify-email'", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = await land(
      "error=access_denied&error_code=provider_email_needs_verification&error_description=Unverified+email",
    );
    expect(url.searchParams.get("error")).toBe("oauth-verify-email");
    expect(url.searchParams.has("redirectTo")).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("any other refusal is 'oauth-failed', even beside a code", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = await land("code=abc&error=server_error&error_description=Error+getting+user+email");
    expect(url.searchParams.get("error")).toBe("oauth-failed");
    expect(s.exchange).not.toHaveBeenCalled();
  });

  it("an unsafe redirect is never carried to the login page", async () => {
    const url = await land("redirectTo=%2F%2Fevil.com&error=access_denied");
    expect(url.origin).toBe(ORIGIN);
    expect(url.searchParams.has("redirectTo")).toBe(false);
  });

  it("a code is exchanged and the visitor goes on", async () => {
    s.exchange.mockResolvedValue({ error: null });
    const url = await land("code=abc&redirectTo=%2Fcreate");
    expect(s.exchange).toHaveBeenCalledWith("abc");
    expect(url.href).toBe(`${ORIGIN}/create`);
  });

  it("a failed exchange is the old 'auth-callback-failed'", async () => {
    s.exchange.mockResolvedValue({ error: new Error("bad code") });
    const url = await land("code=abc");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe("auth-callback-failed");
  });

  it("no code and no error is 'auth-callback-failed'", async () => {
    const url = await land("");
    expect(url.searchParams.get("error")).toBe("auth-callback-failed");
  });
});

describe("oauthCallbackErrorOf", () => {
  const of = (q: string) => oauthCallbackErrorOf(new URLSearchParams(q));
  it("reads GoTrue's answers", () => {
    expect(of("code=abc")).toBeNull();
    expect(of("error=access_denied")).toBe("oauth-cancelled");
    // GoTrue's OWN access_denied (e.g. signups disabled) carries a code.
    expect(of("error=access_denied&error_code=signup_disabled")).toBe("oauth-failed");
    expect(of("error_code=provider_email_needs_verification")).toBe("oauth-verify-email");
    expect(of("error=invalid_request")).toBe("oauth-failed");
  });
  it("names only its own codes", () => {
    expect(isOAuthCallbackError("oauth-cancelled")).toBe(true);
    expect(isOAuthCallbackError("auth-callback-failed")).toBe(false);
  });
});
