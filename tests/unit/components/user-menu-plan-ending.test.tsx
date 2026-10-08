// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// The header for a subscriber who has cancelled: the avatar menu's billing
// row says the plan and when it ends ("Pro ends Oct 23, 2026").

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/app/(auth)/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => true }));

import { UserMenu } from "@/components/layout/user-menu";
import { planEndingShort } from "@/lib/billing/plan-ending";

afterEach(cleanup);

describe("UserMenu — a cancelled plan", () => {
  it("the billing row names the plan and its end date, and still links to billing", () => {
    const note = `Pro ${planEndingShort({ kind: "plan", endsAt: "2026-10-23T02:31:04.000Z" })}`;
    render(<UserMenu username="dev_pro" displayName="Priya" isPaid planEndingNote={note} />);
    const row = screen.getByRole("link", { name: "Billing · Pro ends Oct 23, 2026" });
    expect(row.getAttribute("href")).toBe("/dashboard/billing");
  });
  it("a plan that renews keeps the plain row", () => {
    render(<UserMenu username="dev_pro" displayName="Priya" isPaid />);
    expect(screen.getByRole("link", { name: "Billing & subscription" })).toBeTruthy();
  });
});
