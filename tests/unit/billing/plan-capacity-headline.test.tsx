// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Saved-card capacity is THE paid benefit (owner finding 2026-11-06: users
// convert to save more cards, not for the AI —
// docs/research/card-capacity-conversion-2026-11.md). This test holds every
// surface that names a paid plan to leading with the cap, in words built
// from CARD_CAPACITY — the plan cards, the pricing hero, the home page's
// tiles, the upgrade modal, the capacity notice — and to the soft-cap
// promise (nothing is deleted; the way out is the plan that lifts the cap,
// named with its number).
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

import {
  CARD_CAPACITY,
  CARD_CAPACITY_UNLIMITED,
  CARDS_ARE_SAFE,
  PLANS,
  capacityHoldsLine,
  capacityPitch,
  capacityWord,
  nextCapacityTier,
  planForTier,
  savedCardsLine,
  type PlanTier,
} from "@/lib/billing/plans";
import { PlanCard } from "@/components/billing/plan-card";
import { CapacityNotice } from "@/components/billing/capacity-notice";

afterEach(cleanup);

const TIERS: PlanTier[] = ["free", "plus", "pro"];
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the plan catalog leads with the cap", () => {
  it("lists the saved-card line FIRST on every plan, paid plans included, from CARD_CAPACITY", () => {
    for (const tier of TIERS) {
      const plan = planForTier(tier);
      expect(plan.features[0], tier).toBe(savedCardsLine(tier));
      if (CARD_CAPACITY[tier] === CARD_CAPACITY_UNLIMITED) {
        expect(plan.features[0]).toMatch(/^Unlimited saved cards/);
      } else {
        expect(plan.features[0]).toMatch(new RegExp(`^Up to ${CARD_CAPACITY[tier]} saved cards`));
      }
      // Credits come AFTER the cap now.
      const credits = plan.features.findIndex((line) => /AI credits/.test(line));
      expect(credits, tier).toBeGreaterThan(0);
    }
  });

  it("says the Plus multiple over Free, and never a number not in the table", () => {
    const ratio = CARD_CAPACITY.plus / CARD_CAPACITY.free;
    expect(Number.isInteger(ratio)).toBe(true);
    expect(savedCardsLine("plus")).toContain(`${ratio}× the room on Free`);
    expect(savedCardsLine("free")).not.toContain("×");
  });

  it("paid taglines name the cap", () => {
    expect(planForTier("plus").tagline).toContain(`${capacityWord("plus")} cards`);
    expect(planForTier("pro").tagline).toMatch(/Unlimited cards/);
    expect(capacityWord("pro")).toBe("unlimited");
  });

  it("builds the hero lines from the table, and knows which plan lifts each cap", () => {
    expect(capacityHoldsLine()).toBe(
      `Free holds ${CARD_CAPACITY.free} cards. Plus holds ${CARD_CAPACITY.plus}. Pro holds them all.`,
    );
    expect(capacityPitch()).toBe(`Save up to ${CARD_CAPACITY.plus} cards on Plus, unlimited on Pro.`);
    expect(nextCapacityTier("free")).toBe("plus");
    expect(nextCapacityTier("plus")).toBe("pro");
    expect(nextCapacityTier("pro")).toBeNull();
    expect(CARDS_ARE_SAFE).toMatch(/never deleted/);
    expect(CARDS_ARE_SAFE).toMatch(/view, edit and download/);
  });
});

describe("the plan card", () => {
  it("draws the cap as the headline line, first in the list, on every plan", () => {
    for (const plan of PLANS) {
      cleanup();
      const { container } = render(<PlanCard plan={plan} />);
      const items = Array.from(container.querySelectorAll("ul li"));
      expect(items[0]?.textContent, plan.tier).toBe(savedCardsLine(plan.tier));
      expect(items[0]?.hasAttribute("data-plan-headline"), plan.tier).toBe(true);
      expect(container.querySelectorAll("[data-plan-headline]")).toHaveLength(1);
    }
  });
});

describe("the capacity notice", () => {
  it("links the My Cards meter to the plan that lifts the cap, with its number — even at rest", () => {
    render(<CapacityNotice capacity={{ used: 10, cap: CARD_CAPACITY.free, tier: "free" }} variant="usage" />);
    expect(screen.getByRole("status").textContent).toContain(`10 of ${CARD_CAPACITY.free} cards saved on Free.`);
    const link = screen.getByRole("link", { name: new RegExp(`Plus holds ${CARD_CAPACITY.plus} cards`) });
    expect(link.getAttribute("href")).toBe("/pricing");
    // At rest there is nothing to "manage" yet.
    expect(screen.queryByRole("link", { name: /manage cards/i })).toBeNull();
  });

  it("sends a Plus account to its billing page's plan grid, and a Pro account sees no meter", () => {
    render(<CapacityNotice capacity={{ used: 450, cap: CARD_CAPACITY.plus, tier: "plus" }} variant="usage" />);
    expect(screen.getByRole("link", { name: /Pro holds them all/ }).getAttribute("href")).toBe("/dashboard/billing#plans");
    expect(screen.getByRole("link", { name: /manage cards/i })).toBeTruthy();
    cleanup();
    const { container } = render(
      <CapacityNotice capacity={{ used: 9_000, cap: CARD_CAPACITY_UNLIMITED, tier: "pro" }} variant="usage" />,
    );
    expect(container.textContent).toBe("");
  });

  it("at the cap: an alert that keeps the cards safe and names the way out", () => {
    render(<CapacityNotice capacity={{ used: CARD_CAPACITY.free, cap: CARD_CAPACITY.free, tier: "free" }} adding={1} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Your cards are safe");
    expect(alert.textContent).toContain(`move to Plus (${CARD_CAPACITY.plus} cards)`);
    expect(alert.textContent).not.toMatch(/will fail/);
  });
});

describe("no surface hard-codes a cap", () => {
  const SURFACES = [
    "app/(marketing)/pricing/pricing-content.tsx",
    "app/(marketing)/pricing/page.tsx",
    "app/(marketing)/pricing-member/page.tsx",
    "app/(marketing)/page.tsx",
    "app/(app)/dashboard/billing/page.tsx",
    "components/billing/plan-card.tsx",
    "components/billing/capacity-notice.tsx",
    "components/billing/upgrade-modal.tsx",
    "components/dashboard/cards-summary.tsx",
    "components/settings/billing-panel.tsx",
    "lib/billing/capacity-copy.ts",
    "lib/content/faq.ts",
  ];
  it("writes every saved-card number through lib/billing/plans", () => {
    const caps = [CARD_CAPACITY.free, CARD_CAPACITY.plus].map(String).join("|");
    const literal = new RegExp(`\\b(?:${caps})\\b\\s*(?:saved\\s+)?cards?\\b|holds\\s+(?:${caps})\\b`, "i");
    for (const path of SURFACES) {
      // Comments may quote the numbers as examples; the code may not.
      const code = read(path)
        .split("\n")
        .filter((line) => !/^\s*(?:\/\/|\*|\/\*|{\/\*)/.test(line))
        .join("\n");
      expect(code, path).not.toMatch(literal);
    }
  });
});
