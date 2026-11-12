// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The referral settings form's CONFIRM step (components/admin/
// referral-settings-form.tsx): before anything is saved an admin is shown
// what the program will be — and the line about what QUALIFIES a referral
// states the rule of 2026-11-11 as the database counts it (0208's
// referral_qualifying_cards): N cards, EACH WITH ITS OWN ARTWORK, within W
// days. Nothing about a plan or a card on file. The same summary is the
// success toast's description. The save action, the router and the toasts
// are stubs; what is under test is the words and that nothing is sent on a
// "Cancel".
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  save: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: s.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: s.success, error: vi.fn() } }));
vi.mock("@/lib/admin/admin-toast", () => ({ adminErrorToast: s.errorToast }));
vi.mock("@/lib/admin/referral-settings-actions", () => ({ adminSaveReferralSettingsAction: s.save }));

import { ReferralSettingsForm } from "@/components/admin/referral-settings-form";
import { DEFAULT_REFERRAL_SETTINGS, friendRewardPhrase, rewardStepPhrase, type ReferralSettings } from "@/lib/referrals/settings";

/** `window.confirm` (the test DOM has none of its own): what it was asked,
 *  and what the admin answers. */
const confirmSpy = vi.fn<(message?: string) => boolean>(() => true);
/** What the admin was asked, line by line. */
const asked = () => String(confirmSpy.mock.calls.at(-1)?.[0] ?? "").split("\n");

const setNumber = (label: string, value: number) => fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

beforeEach(() => {
  s.save.mockReset().mockImplementation(async (settings: ReferralSettings) => ({ ok: true, settings }));
  s.refresh.mockReset();
  s.success.mockReset();
  s.errorToast.mockReset();
  confirmSpy.mockReset().mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReferralSettingsForm — the confirm step says the rule", () => {
  it("'Qualifies: N cards, each with its own artwork, within W days' — the form's own numbers, and no plan", async () => {
    render(<ReferralSettingsForm initial={DEFAULT_REFERRAL_SETTINGS} />);
    setNumber("Cards to save", 3);
    setNumber("Within (days)", 14);
    submit();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const lines = asked();
    expect(lines[0]).toBe("Save these referral settings?");
    expect(lines.filter((line) => line.startsWith("Qualifies:"))).toEqual(["Qualifies: 3 cards, each with its own artwork, within 14 days"]);
    // The whole question, in order: the switch, the bar, each side, the cap.
    const draft: ReferralSettings = { ...DEFAULT_REFERRAL_SETTINGS, activation: { cardsRequired: 3, windowDays: 14 } };
    expect(lines).toEqual([
      "Save these referral settings?",
      "",
      "Program: ON",
      "Qualifies: 3 cards, each with its own artwork, within 14 days",
      `Friend gets: ${friendRewardPhrase(draft)}`,
      `Ladder: ${draft.ladder.map((step, i) => `${i + 1}: ${rewardStepPhrase(step)}`).join(", ")}; then ${rewardStepPhrase(draft.tail)} each`,
      `Cap: ${draft.caps.friendsPerMonth} rewarded friends a month`,
      "",
      "Rewards already given are not changed.",
    ]);
    // Never the rule of before (a plan with a card on file), nor the first
    // version's "any picture will do" wording.
    const question = lines.join("\n");
    expect(question).not.toMatch(/card on file|start(?:s|ed)? a plan/i);
    expect(question).not.toContain("cards with artwork within");
    // Confirmed: the draft is saved whole, once, and the toast repeats the summary.
    await waitFor(() => expect(s.success).toHaveBeenCalledTimes(1));
    expect(s.save.mock.calls).toEqual([[draft]]);
    expect(s.success.mock.calls[0]).toEqual([
      "Referral settings saved.",
      { description: lines.slice(2, 7).join(" · ") },
    ]);
    expect(String((s.success.mock.calls[0][1] as { description: string }).description)).toContain(
      "Qualifies: 3 cards, each with its own artwork, within 14 days",
    );
    expect(s.refresh).toHaveBeenCalledTimes(1);
  });

  it("the default program reads 5 cards within 30 days", () => {
    render(<ReferralSettingsForm initial={DEFAULT_REFERRAL_SETTINGS} />);
    // Any change makes the form saveable; the bar is left as it is.
    setNumber("Rewarded friends a month", DEFAULT_REFERRAL_SETTINGS.caps.friendsPerMonth + 1);
    submit();
    expect(asked()).toContain(
      `Qualifies: ${DEFAULT_REFERRAL_SETTINGS.activation.cardsRequired} cards, each with its own artwork, within ${DEFAULT_REFERRAL_SETTINGS.activation.windowDays} days`,
    );
    expect(asked()).toContain("Qualifies: 5 cards, each with its own artwork, within 30 days");
  });

  it("a 'Cancel' on the question sends nothing", async () => {
    confirmSpy.mockReturnValue(false);
    render(<ReferralSettingsForm initial={DEFAULT_REFERRAL_SETTINGS} />);
    setNumber("Cards to save", 4);
    submit();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(asked()).toContain("Qualifies: 4 cards, each with its own artwork, within 30 days");
    await Promise.resolve();
    expect(s.save).not.toHaveBeenCalled();
    expect(s.success).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it("nothing changed: Save is off and no question is asked", () => {
    render(<ReferralSettingsForm initial={DEFAULT_REFERRAL_SETTINGS} />);
    expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(true);
    submit();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(s.save).not.toHaveBeenCalled();
  });
});
