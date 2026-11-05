// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO HM6: ONE button for every OAuth provider. Each provider goes through
// the same /auth/callback with a redirect built by safeRedirectPath; Google
// keeps its account chooser; Discord asks for nothing beyond GoTrue's own
// `identify email` (a `scopes` option would be appended to that list).
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOAuth: s.signInWithOAuth } }),
}));
vi.mock("sonner", () => ({ toast: { error: s.toastError } }));

import { OAuthSignInButton, OAuthSignInButtons } from "@/components/auth/oauth-sign-in-button";

afterEach(() => {
  cleanup();
  s.signInWithOAuth.mockReset();
  s.toastError.mockReset();
});

const callback = (dest: string) =>
  `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(dest)}`;

async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe("OAuthSignInButton", () => {
  it("Google: the account chooser, through the one callback", async () => {
    s.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    render(<OAuthSignInButton provider="google" redirectTo="/decks/new?x=1" />);
    await press("Continue with Google");
    expect(s.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: callback("/decks/new?x=1"),
        queryParams: { prompt: "select_account" },
      },
    });
  });

  it("Discord: no scopes and no query params of its own", async () => {
    s.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    render(<OAuthSignInButton provider="discord" redirectTo="/create" />);
    await press("Continue with Discord");
    expect(s.signInWithOAuth).toHaveBeenCalledTimes(1);
    const arg = s.signInWithOAuth.mock.calls[0][0];
    expect(arg).toEqual({ provider: "discord", options: { redirectTo: callback("/create") } });
    expect(arg.options).not.toHaveProperty("scopes");
    expect(arg.options).not.toHaveProperty("queryParams");
  });

  it.each([["//evil.com"], ["/\\evil.com"], ["https://evil.com"], [undefined]])(
    "an unsafe or missing redirect (%s) falls back to the dashboard",
    async (redirectTo) => {
      s.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
      render(<OAuthSignInButton provider="discord" redirectTo={redirectTo} />);
      await press("Continue with Discord");
      expect(s.signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe(callback("/dashboard"));
    },
  );

  it("stays busy while the browser leaves for the provider", async () => {
    let resolve!: (v: unknown) => void;
    s.signInWithOAuth.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<OAuthSignInButton provider="discord" />);
    const button = screen.getByRole("button", { name: "Continue with Discord" });
    await press("Continue with Discord");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.querySelector(".animate-spin")).not.toBeNull();
    await act(async () => resolve({ data: {}, error: null }));
    // Success navigates away: the button stays disabled, no toast.
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(s.toastError).not.toHaveBeenCalled();
  });

  it("an error before navigating re-enables the button with a generic toast", async () => {
    s.signInWithOAuth.mockResolvedValue({ data: null, error: new Error("boom") });
    render(<OAuthSignInButton provider="discord" />);
    await press("Continue with Discord");
    expect((screen.getByRole("button", { name: "Continue with Discord" }) as HTMLButtonElement).disabled).toBe(false);
    expect(s.toastError).toHaveBeenCalledWith("Couldn't start Discord sign-in. Please try again.");
  });

  it("a throw is caught the same way", async () => {
    s.signInWithOAuth.mockRejectedValue(new Error("storage"));
    render(<OAuthSignInButton provider="google" />);
    await press("Continue with Google");
    expect((screen.getByRole("button", { name: "Continue with Google" }) as HTMLButtonElement).disabled).toBe(false);
    expect(s.toastError).toHaveBeenCalledWith("Couldn't start Google sign-in. Please try again.");
  });

  it("the provider marks are decorative: the name is the words alone", () => {
    render(<OAuthSignInButtons providers={["google", "discord"]} />);
    const names = screen.getAllByRole("button").map((b) => b.textContent?.trim());
    expect(names).toEqual(["Continue with Google", "Continue with Discord"]);
    for (const svg of document.querySelectorAll("svg")) expect(svg.getAttribute("aria-hidden")).toBe("true");
  });
});
