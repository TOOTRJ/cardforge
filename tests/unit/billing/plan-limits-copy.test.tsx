// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The plan limits as copy (TODO DK3.5): every surface that names a plan's
// saved cards says them FROM the constant (CARD_CAPACITY in
// lib/billing/plans.ts) — the plan cards on /pricing and /dashboard/billing,
// the billing page's free-plan line and the FAQ — so a cap that changes in
// plans.ts (and in 0104, held together by card-capacity.test.ts) can't leave
// a page quoting the old number. Decks are unlimited on every plan (owner
// 2026-10-29; 0147 dropped 0145's private-deck cap): no plan names a deck
// number, and the free plan says "unlimited decks".
// ---------------------------------------------------------------------------

vi.mock("@/lib/stripe/actions", () => ({
  createPortalSessionAction: vi.fn(),
  cancelScheduledPlanChangeAction: vi.fn(),
  resumeSubscriptionAction: vi.fn(),
  getResumePreviewAction: vi.fn(),
}));
vi.mock("@/lib/routing/navigate", () => ({ navigateTo: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import {
  CARD_CAPACITY,
  CARD_CAPACITY_UNLIMITED,
  PLANS,
  UNLIMITED_DECKS_LINE,
  planForTier,
  savedCardsLine,
  type PlanTier,
} from "@/lib/billing/plans";
import { PlanStatusLine } from "@/components/billing/plan-status";
import { FAQ_TOPICS } from "@/lib/content/faq";

afterEach(cleanup);

const TIERS: PlanTier[] = ["free", "plus", "pro"];
/** Any deck count a plan could be sold on ("1 private deck", "3 decks"…). */
const DECK_NUMBER = /\b\d+ (?:(?:private|unlisted|public)(?: or unlisted)? )?decks?\b/i;

describe("the plan cards", () => {
  it("say each tier's saved cards from CARD_CAPACITY", () => {
    expect(savedCardsLine("free")).toBe(`Up to ${CARD_CAPACITY.free} saved cards`);
    expect(savedCardsLine("plus")).toBe(`Up to ${CARD_CAPACITY.plus} saved cards`);
    expect(savedCardsLine("pro")).toBe("Unlimited saved cards");
    for (const tier of TIERS) expect(planForTier(tier).features, tier).toContain(savedCardsLine(tier));
    expect(CARD_CAPACITY.pro).toBe(CARD_CAPACITY_UNLIMITED);
  });

  it("sell no deck limit: Free says decks are unlimited, and no plan names a deck number", () => {
    expect(UNLIMITED_DECKS_LINE).toBe("Unlimited decks — public, unlisted or private");
    expect(planForTier("free").features).toContain(UNLIMITED_DECKS_LINE);
    const all = PLANS.flatMap((p) => [p.tagline, ...p.features, ...(p.comingSoon ?? [])]).join("\n");
    expect(all).not.toMatch(DECK_NUMBER);
    expect(all).not.toMatch(/private deck/i);
  });
});

describe("the billing page's free-plan line", () => {
  const line = (kind: "free" | "ended") => {
    const { container } = render(
      <PlanStatusLine status={{ kind } as never} planName="Free" priceLine="" hasPaymentMethod={false} />,
    );
    return container.textContent ?? "";
  };

  it("says the free card limit from the constant, and unlimited decks", () => {
    for (const kind of ["free", "ended"] as const) {
      cleanup();
      const text = line(kind);
      expect(text, kind).toContain(`up to ${CARD_CAPACITY.free} saved cards`);
      expect(text, kind).toContain("unlimited decks");
      expect(text, kind).not.toMatch(DECK_NUMBER);
    }
    // A downgrade keeps everything (the card cap checks new rows only).
    cleanup();
    expect(line("ended")).toContain("Every card and deck you made stays yours.");
  });

  it("holds no hard-coded limit", () => {
    const source = readFileSync(join(process.cwd(), "components/billing/plan-status.tsx"), "utf8");
    expect(source).not.toMatch(/up to \d+ saved cards/);
    expect(source).not.toMatch(/\b\d+ private/);
  });
});

describe("the FAQ", () => {
  const entries = FAQ_TOPICS.flatMap((t) => t.entries);
  const answer = (q: string) => {
    const entry = entries.find((e) => e.q === q);
    if (!entry) throw new Error(`no FAQ entry "${q}"`);
    return entry.a;
  };

  it("answers that decks are unlimited on every plan, and that saved cards are what plans differ in", () => {
    const a = answer("How many decks can I make?");
    expect(a).toMatch(/^As many as you like, on every plan — public, unlisted or private\./);
    expect(a).toContain(`Free holds ${CARD_CAPACITY.free}, Plus ${CARD_CAPACITY.plus}, Pro unlimited`);
    expect(a).not.toMatch(DECK_NUMBER);
  });

  it("answers that an import uses no slots until a card is customized (D2), from CARD_CAPACITY", () => {
    const a = answer("Does importing a decklist use my saved-card slots?");
    expect(a).toMatch(/^No\./);
    expect(a).toContain(`Free holds ${CARD_CAPACITY.free}, Plus ${CARD_CAPACITY.plus}, Pro unlimited`);
  });
});
