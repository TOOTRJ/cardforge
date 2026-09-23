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
vi.mock("@/lib/stripe/actions", () => ({ createPortalSessionAction: vi.fn() }));
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
    expect(screen.getByRole("link", { name: /buy credits/i })).toBeTruthy();
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
    expect(screen.getByText(/your plan ends on oct 22, 2026/i)).toBeTruthy();
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
