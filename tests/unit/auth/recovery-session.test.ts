import { describe, expect, it, vi } from "vitest";
import {
  RECOVERY_WINDOW_MS,
  hasRecentRecovery,
  isRecoverySession,
} from "@/lib/auth/recovery-session";

// ---------------------------------------------------------------------------
// The /reset-password gate: only a session from a RECENT email link may set
// a password without the current one. GoTrue logs token-hash verifications
// as "otp" and PKCE recovery exchanges as "recovery"; a password/OAuth
// session, an old link, garbage claims or a failing verifier are refused.
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-09-22T12:00:00Z");
const secondsAgo = (ms: number) => Math.floor((NOW - ms) / 1000);

describe("hasRecentRecovery", () => {
  it("accepts a link verification used within the window (detailed amr, seconds)", () => {
    expect(
      hasRecentRecovery([{ method: "recovery", timestamp: secondsAgo(5 * 60_000) }], NOW),
    ).toBe(true);
    // What GoTrue actually records for a token-hash recovery link.
    expect(
      hasRecentRecovery([{ method: "otp", timestamp: secondsAgo(5 * 60_000) }], NOW),
    ).toBe(true);
  });

  it("refuses a link verification older than the window", () => {
    for (const method of ["recovery", "otp"]) {
      expect(
        hasRecentRecovery(
          [{ method, timestamp: secondsAgo(RECOVERY_WINDOW_MS + 60_000) }],
          NOW,
        ),
        method,
      ).toBe(false);
    }
  });

  it("refuses password / oauth / mfa sessions", () => {
    expect(hasRecentRecovery([{ method: "password", timestamp: secondsAgo(1000) }], NOW)).toBe(false);
    expect(hasRecentRecovery([{ method: "oauth", timestamp: secondsAgo(1000) }], NOW)).toBe(false);
    expect(hasRecentRecovery(["password", "oauth", "mfa/totp"], NOW)).toBe(false);
  });

  it("accepts the RFC 8176 string form", () => {
    expect(hasRecentRecovery(["recovery"], NOW)).toBe(true);
    expect(hasRecentRecovery(["otp"], NOW)).toBe(true);
  });

  it("refuses malformed claims", () => {
    expect(hasRecentRecovery(undefined, NOW)).toBe(false);
    expect(hasRecentRecovery("recovery", NOW)).toBe(false);
    expect(hasRecentRecovery([{ method: "recovery" }], NOW)).toBe(false);
    expect(hasRecentRecovery([{ method: "recovery", timestamp: "now" }], NOW)).toBe(false);
    expect(hasRecentRecovery([null, 42], NOW)).toBe(false);
  });
});

describe("isRecoverySession", () => {
  const client = (answer: unknown) =>
    ({ auth: { getClaims: vi.fn(async () => answer) } }) as never;

  it("reads the verified claims", async () => {
    const yes = client({
      data: { claims: { amr: [{ method: "recovery", timestamp: secondsAgo(1000) }] } },
      error: null,
    });
    expect(await isRecoverySession(yes, NOW)).toBe(true);
  });

  it("is false without claims, on a verifier error, or when the verifier throws", async () => {
    expect(await isRecoverySession(client({ data: null, error: null }), NOW)).toBe(false);
    expect(
      await isRecoverySession(client({ data: null, error: { message: "bad token" } }), NOW),
    ).toBe(false);
    const boom = { auth: { getClaims: vi.fn(async () => { throw new Error("offline"); }) } } as never;
    expect(await isRecoverySession(boom, NOW)).toBe(false);
  });
});
