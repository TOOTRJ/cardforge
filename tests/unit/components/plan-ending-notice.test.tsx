// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { textContent } from "../helpers/text-content";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// The dashboard for a subscriber who has cancelled (owner, 2026-10-07): it
// still says "Pro" — correct, they keep it until the date — and now ALSO says
// the plan was cancelled, when it ends, and offers Resume. Plus the in-app
// Resume itself: a confirm step that states the renewal date and price, one
// click, and the portal only as the fallback.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  profile: null as null | Record<string, unknown>,
  billing: true,
  resume: vi.fn(),
  preview: vi.fn(),
  portal: vi.fn(),
  navigateTo: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: s.toastError, success: vi.fn() } }));
vi.mock("@/lib/stripe/actions", () => ({
  resumeSubscriptionAction: s.resume,
  getResumePreviewAction: s.preview,
  createPortalSessionAction: s.portal,
}));
vi.mock("@/lib/routing/navigate", () => ({ navigateTo: s.navigateTo }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => s.profile }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => s.billing }));

import {
  PlanEndingNotice,
  PlanEndingNoticeCard,
  planBadgeLabel,
} from "@/components/dashboard/plan-ending-notice";
import { ResumePlanButton, resumeConfirmCopy } from "@/components/billing/resume-plan-button";
import { planEndingOf } from "@/lib/billing/plan-ending";

const PERIOD_END = "2026-10-23T02:31:04.000Z";
const LATER = "2026-12-07T02:31:04.000Z";
const proEnding = {
  id: "u1",
  subscription_tier: "pro",
  subscription_status: "active",
  stripe_customer_id: "cus_1",
  stripe_subscription_id: "sub_1",
  current_period_end: PERIOD_END,
  cancel_at_period_end: true,
  subscription_ends_at: PERIOD_END,
  subscription_canceled_at: "2026-10-07T18:00:00.000Z",
};

beforeEach(() => {
  s.profile = null;
  s.billing = true;
  s.resume.mockReset().mockResolvedValue({ ok: true, url: "https://test.local/dashboard/billing?billing=resumed" });
  s.preview.mockReset().mockResolvedValue({
    ok: true,
    planName: "Pro",
    trial: false,
    nextBillAt: PERIOD_END,
    priceLine: "$15 / month",
  });
  s.portal.mockReset().mockResolvedValue({ ok: true, url: "https://portal.test/s" });
  s.navigateTo.mockReset();
  s.toastError.mockReset();
});
afterEach(cleanup);

/** Render the dashboard's server wrapper for a profile row. */
async function renderDashboardNotice(profile: Record<string, unknown> | null) {
  s.profile = profile;
  const node = await PlanEndingNoticeCard();
  return render(<div data-testid="slot">{node}</div>);
}

describe("dashboard notice — the state table", () => {
  it("a cancelled Pro plan: says cancelled, the date, kept until then, and offers Resume Pro", async () => {
    await renderDashboardNotice(proEnding);
    const notice = screen.getByTestId("plan-ending-notice");
    expect(notice.textContent).toContain("Your Pro plan is ending");
    expect(notice.textContent).toContain(
      "Your Pro plan was cancelled and ends on October 23, 2026. You keep Pro until then.",
    );
    expect(notice.textContent).toContain("Afterwards you're on the free plan");
    expect(screen.getByRole("button", { name: "Resume Pro" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Billing" }).getAttribute("href")).toBe("/dashboard/billing");
  });

  it("a row synced before 0135 (flag only): dated by the period end", async () => {
    await renderDashboardNotice({ ...proEnding, subscription_ends_at: null, subscription_canceled_at: null });
    expect(screen.getByTestId("plan-ending-notice").textContent).toContain("ends on October 23, 2026");
  });

  it("a cancelled TRIAL: the trial ends and nothing is charged", async () => {
    await renderDashboardNotice({ ...proEnding, subscription_tier: "plus", subscription_status: "trialing" });
    const text = screen.getByTestId("plan-ending-notice").textContent ?? "";
    expect(text).toContain("Your Plus trial is ending");
    expect(text).toContain("You cancelled your Plus free trial. It ends on October 23, 2026 and you won't be charged.");
    expect(screen.getByRole("button", { name: "Resume Plus" })).toBeTruthy();
  });

  it("an end date after the next renewal: says it is still billed first, never 'nothing is charged'", async () => {
    await renderDashboardNotice({ ...proEnding, cancel_at_period_end: false, subscription_ends_at: LATER });
    const text = screen.getByTestId("plan-ending-notice").textContent ?? "";
    expect(text).toContain("set to end on December 7, 2026");
    expect(text).toContain("still billed as usual until then — next on October 23, 2026");
    expect(text).not.toMatch(/won't be charged/);
  });

  const silent: Array<[string, Record<string, unknown> | null]> = [
    ["a plan that renews", { ...proEnding, cancel_at_period_end: false, subscription_ends_at: null }],
    ["a subscription that has already ENDED", { ...proEnding, subscription_status: "canceled" }],
    ["a past-due subscription", { ...proEnding, subscription_status: "past_due" }],
    ["a free account", { id: "u2", subscription_tier: "free", subscription_status: null }],
    ["no profile", null],
  ];
  for (const [name, profile] of silent) {
    it(`shows nothing for ${name}`, async () => {
      await renderDashboardNotice(profile);
      expect(screen.queryByTestId("plan-ending-notice")).toBeNull();
      expect(screen.getByTestId("slot").textContent).toBe("");
    });
  }

  it("shows nothing with billing off", async () => {
    s.billing = false;
    await renderDashboardNotice(proEnding);
    expect(screen.queryByTestId("plan-ending-notice")).toBeNull();
  });

  it("no Stripe subscription linked: the notice stays, without a button that could only fail", async () => {
    await renderDashboardNotice({ ...proEnding, stripe_subscription_id: null });
    expect(screen.getByTestId("plan-ending-notice")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();
  });
});

describe("dashboard plan badges", () => {
  const ending = planEndingOf(proEnding);
  it("the plan's badge says when it ends", () => {
    expect(planBadgeLabel("Pro", ending, "Pro")).toBe("Pro plan · ends Oct 23, 2026");
  });
  it("a plan that renews keeps the plain label", () => {
    expect(planBadgeLabel("Pro", null, "Pro")).toBe("Pro plan");
  });
  it("a comp that outranks the ending subscription keeps the plain label (Pro is not what is ending)", () => {
    expect(planBadgeLabel("Pro", ending, "Plus")).toBe("Pro plan");
  });
});

describe("Resume — confirm, then one click", () => {
  it("the confirm step states what happens: renews on the date at the price, nothing charged today", async () => {
    render(<PlanEndingNotice ending={planEndingOf(proEnding)!} planName="Pro" canResume />);
    fireEvent.click(screen.getByRole("button", { name: "Resume Pro" }));
    await waitFor(() =>
      expect(
        screen.getByText(textContent("Your Pro plan will renew on October 23, 2026 at $15 / month. Nothing is charged today.")),
      ).toBeTruthy(),
    );
    expect(s.resume).not.toHaveBeenCalled();
    // Confirm → the action, with the surface for the funnel → the billing page.
    const buttons = screen.getAllByRole("button", { name: "Resume Pro" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(s.navigateTo).toHaveBeenCalledWith("https://test.local/dashboard/billing?billing=resumed"));
    expect(s.resume).toHaveBeenCalledWith({ surface: "dashboard" });
    expect(s.portal).not.toHaveBeenCalled();
  });

  it("'Not now' closes without resuming", async () => {
    render(<ResumePlanButton planName="Pro" surface="billing" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume Pro" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Not now" })).toBeNull());
    expect(s.resume).not.toHaveBeenCalled();
  });

  it("when the in-app resume fails, the error is shown and the Customer Portal opens as the fallback", async () => {
    s.resume.mockResolvedValue({ ok: false, error: "Couldn't resume the plan here.", fallback: "portal" });
    render(<ResumePlanButton planName="Pro" surface="settings" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume Pro" }));
    await waitFor(() => expect(screen.getByText(textContent(/will renew on October 23, 2026/))).toBeTruthy());
    const buttons = screen.getAllByRole("button", { name: "Resume Pro" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(s.navigateTo).toHaveBeenCalledWith("https://portal.test/s"));
    expect(s.toastError).toHaveBeenCalledWith("Couldn't resume the plan here.");
    expect(s.portal).toHaveBeenCalledWith();
  });

  it("an error with no fallback (the plan already ended) never opens the portal", async () => {
    s.resume.mockResolvedValue({ ok: false, error: "This plan has already ended. Pick a plan to start a new one." });
    render(<ResumePlanButton planName="Pro" surface="billing" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume Pro" }));
    await waitFor(() => expect(screen.getByText(/will renew on/)).toBeTruthy());
    const buttons = screen.getAllByRole("button", { name: "Resume Pro" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(s.toastError).toHaveBeenCalled());
    expect(s.portal).not.toHaveBeenCalled();
    expect(s.navigateTo).not.toHaveBeenCalled();
  });

  it("resumeConfirmCopy — plan, trial, and the wording when Stripe couldn't be read", () => {
    expect(
      resumeConfirmCopy("Pro", { ok: true, planName: "Pro", trial: false, nextBillAt: PERIOD_END, priceLine: "$150 / year" }),
    ).toBe("Your Pro plan will renew on October 23, 2026 at $150 / year. Nothing is charged today.");
    expect(
      resumeConfirmCopy("Plus", { ok: true, planName: "Plus", trial: true, nextBillAt: PERIOD_END, priceLine: "$6 / month" }),
    ).toBe(
      "Your Plus free trial will carry on until October 23, 2026; then Plus starts at $6 / month on the card you added. Nothing is charged today.",
    );
    // No invented price or date.
    expect(resumeConfirmCopy("Pro", { ok: false, error: "x" })).toBe(
      "Your Pro plan will carry on and renew as usual, at the price you already pay. Nothing is charged today.",
    );
    expect(resumeConfirmCopy("Pro", { ok: true, planName: "Pro", trial: false, nextBillAt: null, priceLine: null })).toBe(
      "Your Pro plan will renew as usual. Nothing is charged today.",
    );
  });
});
