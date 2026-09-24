// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/stripe/actions", () => ({ createCheckoutSessionAction: vi.fn() }));
vi.mock("@/lib/routing/navigate", () => ({ navigateTo: vi.fn() }));

import { CreditPackGrid } from "@/components/billing/credit-pack-grid";

afterEach(cleanup);

describe("CreditPackGrid", () => {
  it("lists the three packs impulse → value at full price", () => {
    render(<CreditPackGrid />);
    const buttons = screen.getAllByRole("button").map((b) => b.textContent?.trim());
    expect(buttons).toEqual(["Buy 10 credits", "Buy 30 credits", "Buy 100 credits"]);
    expect(screen.getByText(/\$4 one-time/)).toBeTruthy();
    expect(screen.getByText(/\$24 one-time/)).toBeTruthy();
    expect(screen.queryByText(/for subscribers/)).toBeNull();
  });

  it("shows the subscriber price with the full price struck through when discounted", () => {
    render(<CreditPackGrid discounted compact />);
    expect(screen.getAllByText(/for subscribers/)).toHaveLength(3);
    expect(screen.getByText(/\$6\.40/)).toBeTruthy();
    expect(screen.getByText(/\$19\.20/)).toBeTruthy();
    expect(screen.getByText("$8").tagName).toBe("S");
  });
});
