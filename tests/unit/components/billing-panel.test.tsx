// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Settings → Subscription & billing panel: the right verbs per account state,
// and never a portal button for an account with no Stripe customer.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/stripe/actions", () => ({
  createPortalSessionAction: vi.fn(),
  resumeSubscriptionAction: vi.fn(),
  getResumePreviewAction: vi.fn(),
}));
vi.mock("@/lib/routing/navigate", () => ({ navigateTo: vi.fn() }));

import { BillingPanel } from "@/components/settings/billing-panel";

afterEach(cleanup);

const base = {
  tier: "free" as const,
  isPaid: false,
  status: null,
  credits: 5,
  renewLabel: null,
  cancelAtPeriodEnd: false,
  hasBillingAccount: false,
};

describe("BillingPanel", () => {
  it("free account, no billing account: upgrade + buy credits, no portal button", () => {
    render(<BillingPanel {...base} />);
    expect(screen.getByText("Free plan")).toBeTruthy();
    expect(screen.getByRole("link", { name: /upgrade your plan/i })).toHaveProperty("href", expect.stringContaining("/pricing"));
    expect(screen.getByRole("link", { name: /billing & subscription/i })).toHaveProperty("href", expect.stringContaining("/dashboard/billing"));
    expect(screen.getByRole("link", { name: /buy credits/i })).toHaveProperty("href", expect.stringContaining("/dashboard/billing"));
    expect(screen.queryByRole("button", { name: /billing history|manage subscription|fix payment/i })).toBeNull();
  });

  it("active Pro: renewal date and the portal as 'Manage subscription'", () => {
    render(
      <BillingPanel {...base} tier="pro" isPaid status="active" credits={100} renewLabel="Oct 22, 2026" hasBillingAccount />,
    );
    expect(screen.getByText("Pro")).toBeTruthy();
    expect(screen.getByText(/renews on oct 22, 2026/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /manage subscription/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /upgrade your plan/i })).toBeNull();
  });

  it("cancel scheduled: says when the plan ends", () => {
    render(<BillingPanel {...base} tier="plus" isPaid status="active" renewLabel="Oct 22, 2026" cancelAtPeriodEnd hasBillingAccount />);
    expect(screen.getByText(/ends on oct 22, 2026 and won't renew/i)).toBeTruthy();
    expect(screen.queryByText(/renews on/i)).toBeNull();
    // Not "Active" (which read as "nothing happened"), and the portal button says what it is for.
    expect(screen.getByText("Ending")).toBeTruthy();
    // Resume is in-app now (a confirm step, then one click); the portal
    // button beside it no longer pretends to be the resume.
    expect(screen.getByRole("button", { name: "Resume Plus" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Billing portal" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /manage subscription|resume subscription/i })).toBeNull();
  });

  it("the stored end date (0135) is what Settings says — same sentence as the dashboard notice", () => {
    render(
      <BillingPanel
        {...base}
        tier="pro"
        isPaid
        status="active"
        renewLabel="October 23, 2026"
        hasBillingAccount
        planEnding={{ kind: "plan", endsAt: "2026-10-23T02:31:04.000Z", billedBeforeAt: null, canceledAt: null }}
      />,
    );
    expect(screen.getByTestId("settings-plan-ending").textContent).toBe(
      "Your Pro plan was cancelled and ends on October 23, 2026. You keep Pro until then. Nothing more is charged. Changed your mind? Resume Pro below.",
    );
    expect(screen.getByText("Ending")).toBeTruthy();
    expect(screen.queryByText(/renews on/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Resume Pro" })).toBeTruthy();
  });

  it("a cancellation dated AFTER the next renewal (flag false) no longer reads 'Renews on': it ends, and is billed first", () => {
    render(
      <BillingPanel
        {...base}
        tier="pro"
        isPaid
        status="active"
        renewLabel="October 23, 2026"
        hasBillingAccount
        planEnding={{
          kind: "plan",
          endsAt: "2026-12-07T02:31:04.000Z",
          billedBeforeAt: "2026-10-23T02:31:04.000Z",
          canceledAt: null,
        }}
      />,
    );
    const text = screen.getByTestId("settings-plan-ending").textContent ?? "";
    expect(text).toContain("set to end on December 7, 2026");
    expect(text).toContain("next on October 23, 2026");
    expect(text).not.toContain("Nothing more is charged");
    expect(screen.queryByText(/^renews on/i)).toBeNull();
  });

  it("a cancelled trial (stored date): the trial ends, nothing is charged, 'Trial ending'", () => {
    render(
      <BillingPanel
        {...base}
        tier="plus"
        isPaid
        status="trialing"
        renewLabel="October 23, 2026"
        hasBillingAccount
        planEnding={{ kind: "trial", endsAt: "2026-10-23T02:31:04.000Z", billedBeforeAt: null, canceledAt: null }}
      />,
    );
    expect(screen.getByTestId("settings-plan-ending").textContent).toContain(
      "You cancelled your Plus free trial. It ends on October 23, 2026 and you won't be charged.",
    );
    expect(screen.getByText("Trial ending")).toBeTruthy();
  });

  it("a renewing plan has no Resume button", () => {
    render(<BillingPanel {...base} tier="pro" isPaid status="active" renewLabel="Oct 22, 2026" hasBillingAccount />);
    expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();
  });

  it("cancelled trial: it ends and nothing is charged", () => {
    render(<BillingPanel {...base} tier="plus" isPaid status="trialing" renewLabel="Oct 22, 2026" cancelAtPeriodEnd hasBillingAccount />);
    expect(screen.getByText(/cancelled your trial: it ends on oct 22, 2026 and you won't be charged/i)).toBeTruthy();
  });

  it("past due: the status is honest, the portal button says 'Fix payment', plans stay reachable", () => {
    render(<BillingPanel {...base} tier="plus" status="past_due" hasBillingAccount />);
    expect(screen.getByText("Past due")).toBeTruthy();
    expect(screen.getByText(/paid perks are paused/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /fix payment/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /see plans/i })).toBeTruthy();
  });

  it("canceled subscriber (the sync writes tier free + status canceled): free plan, billing history, upgrade", () => {
    render(<BillingPanel {...base} tier="free" status="canceled" hasBillingAccount />);
    expect(screen.getByText("Free plan")).toBeTruthy();
    expect(screen.queryByText(/paid perks are paused/i)).toBeNull();
    expect(screen.getByRole("button", { name: /billing history/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /upgrade your plan/i })).toBeTruthy();
  });
});
