import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// TODO HM6: /login and /signup offer the providers of ONE list — Google
// always, Discord only where NEXT_PUBLIC_AUTH_DISCORD=1 — and the login page
// words each refusal /auth/callback sends back without naming an account.
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/app/(auth)/actions", () => ({ loginAction: vi.fn(), signupAction: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import LoginPage from "@/app/(auth)/login/page";
import SignupPage from "@/app/(auth)/signup/page";
import { enabledOAuthProviders } from "@/lib/auth/oauth-providers";
import { OAUTH_CALLBACK_ERRORS } from "@/lib/auth/oauth-callback-error";

afterEach(() => vi.unstubAllEnvs());

async function login(params: Record<string, string> = {}) {
  return renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(params) }));
}
async function signup() {
  return renderToStaticMarkup(await SignupPage({ searchParams: Promise.resolve({}) }));
}

describe("enabledOAuthProviders", () => {
  it("Google always; Discord only with the flag at exactly '1'", () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_DISCORD", "");
    expect(enabledOAuthProviders()).toEqual(["google"]);
    vi.stubEnv("NEXT_PUBLIC_AUTH_DISCORD", "true");
    expect(enabledOAuthProviders()).toEqual(["google"]);
    vi.stubEnv("NEXT_PUBLIC_AUTH_DISCORD", "1");
    expect(enabledOAuthProviders()).toEqual(["google", "discord"]);
  });
});

describe.each([
  ["/login", () => login()],
  ["/signup", signup],
])("%s", (_path, page) => {
  it("shows both buttons with the flag on", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_DISCORD", "1");
    const html = await page();
    expect(html).toContain("Continue with Google");
    expect(html).toContain("Continue with Discord");
    expect(html.indexOf("Continue with Google")).toBeLessThan(html.indexOf("Continue with Discord"));
  });

  it("hides Discord without it", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_DISCORD", "");
    const html = await page();
    expect(html).toContain("Continue with Google");
    expect(html).not.toContain("Discord");
  });
});

describe("the login page's words for a provider's refusal", () => {
  it("has one for each code the callback sends", async () => {
    const plain = await login();
    for (const error of OAUTH_CALLBACK_ERRORS) {
      const html = await login({ error });
      expect(html.length, error).toBeGreaterThan(plain.length);
    }
  });

  it("a cancel is a calm status, not an alert", async () => {
    const html = await login({ error: "oauth-cancelled" });
    expect(html).toMatch(/role="status"[^>]*>\s*Sign-in was cancelled, so nothing changed/);
    expect(html).not.toContain('role="alert"');
  });

  it("no message names an account or an email address", async () => {
    for (const error of OAUTH_CALLBACK_ERRORS) {
      const html = await login({ error });
      expect(html, error).not.toMatch(/already (exists|registered)|no account|not found/i);
    }
  });
});
