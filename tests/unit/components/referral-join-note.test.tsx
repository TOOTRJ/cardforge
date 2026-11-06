// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ATTRIBUTION_STORAGE_KEY } from "@/lib/analytics/attribution";
import { resetReferralShareInfo } from "@/lib/sharing/referral-share-client";
import { ReferralJoinNote } from "@/components/referrals/referral-join-note";

// The sign-up / onboarding line for a person who came through a friend's
// link: shown only with a first-touch code in the tab AND the program on;
// it says the account starts with the signup days and the referral adds
// the friend's days (the conditions are explained after sign-up).

const fetchMock = vi.fn();

beforeEach(() => {
  resetReferralShareInfo();
  sessionStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const answer = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });

describe("ReferralJoinNote", () => {
  it("with a first-touch code and the program on: says what the friend gets and what it takes", async () => {
    sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify({ ref: "ab12cd34" }));
    fetchMock.mockReturnValue(answer({ enabled: true, friendGets: "7 free days", cardsRequired: 5, windowDays: 30, signupDays: 7, code: null, ladder: null }));
    await act(async () => {
      render(<ReferralJoinNote where="signup" />);
    });
    const note = await screen.findByTestId("referral-join-note");
    expect(note.textContent).toBe(
      "You're joining through a friend's link: your account starts with 7 free days, and the referral adds 7 more. Your friend gets a reward too.",
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/referrals/share", expect.objectContaining({ credentials: "same-origin" }));
  });
  it("onboarding wording", async () => {
    sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify({ ref: "ab12cd34" }));
    // An older answer without the signup days falls back to 7.
    fetchMock.mockReturnValue(answer({ enabled: true, friendGets: "14 free days", code: null, ladder: null }));
    await act(async () => {
      render(<ReferralJoinNote where="onboarding" />);
    });
    expect((await screen.findByTestId("referral-join-note")).textContent).toBe(
      "You joined through a friend's link: your account starts with 7 free days, and the referral adds 14 more. Your friend gets a reward too.",
    );
  });
  it("no code in the tab: nothing, and no request", async () => {
    await act(async () => {
      render(<ReferralJoinNote where="signup" />);
    });
    expect(screen.queryByTestId("referral-join-note")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("the program off: nothing", async () => {
    sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify({ ref: "ab12cd34" }));
    fetchMock.mockReturnValue(answer({ enabled: false, friendGets: null, cardsRequired: null, windowDays: null, signupDays: null, code: null, ladder: null }));
    await act(async () => {
      render(<ReferralJoinNote where="signup" />);
    });
    expect(screen.queryByTestId("referral-join-note")).toBeNull();
  });
});
