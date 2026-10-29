// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The plan limits as copy (TODO DK3.5): every surface that names a plan's
// saved cards or decks says them FROM the constants (CARD_CAPACITY,
// DECK_CAPACITY in lib/billing/plans.ts) — the plan cards on /pricing and
// /dashboard/billing, the billing page's free-plan line, the upgrade modal
// (deck-capacity-ui.test.tsx renders it) and the FAQ. So a cap that changes
// in plans.ts (and in its migration, held together by card-capacity.test.ts
// and deck-capacity.test.ts) can't leave a page quoting the old number.
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
  DECK_CAPACITY,
  PLANS,
  decksLine,
  planForTier,
  privateDecksByPlanSentence,
  privateDecksPhrase,
  savedCardsLine,
  type PlanTier,
} from "@/lib/billing/plans";
import { PlanStatusLine } from "@/components/billing/plan-status";
import { FAQ_TOPICS } from "@/lib/content/faq";

afterEach(cleanup);

const TIERS: PlanTier[] = ["free", "plus", "pro"];

describe("the plan cards", () => {
  it("say each tier's saved cards and decks from the constants", () => {
    expect(savedCardsLine("free")).toBe(`Up to ${CARD_CAPACITY.free} saved cards`);
    expect(savedCardsLine("plus")).toBe(`Up to ${CARD_CAPACITY.plus} saved cards`);
    expect(savedCardsLine("pro")).toBe("Unlimited saved cards");
    expect(decksLine("free")).toBe(`Unlimited public decks, plus ${DECK_CAPACITY.free} private or unlisted deck`);
    expect(decksLine("plus")).toBe(`Unlimited public decks, plus ${DECK_CAPACITY.plus} private or unlisted decks`);
    expect(decksLine("pro")).toBe("Unlimited decks — public, unlisted or private");
    for (const tier of TIERS) {
      const features = planForTier(tier).features;
      expect(features, tier).toContain(savedCardsLine(tier));
      expect(features, tier).toContain(decksLine(tier));
    }
    expect(CARD_CAPACITY.pro).toBe(CARD_CAPACITY_UNLIMITED);
    expect(DECK_CAPACITY.pro).toBe(CARD_CAPACITY_UNLIMITED);
  });

  it("never sell decks as capped in total — public decks are unlimited on every plan (D1)", () => {
    const all = PLANS.flatMap((p) => p.features).join("\n");
    expect(all).not.toMatch(/up to \d+ decks/i);
    for (const tier of ["free", "plus"] as const) expect(decksLine(tier)).toMatch(/^Unlimited public decks/);
  });

  it("the one-sentence version names every plan", () => {
    expect(privateDecksByPlanSentence()).toBe(
      `Free includes ${DECK_CAPACITY.free} private or unlisted deck, Plus ${DECK_CAPACITY.plus}, and Pro as many as you like.`,
    );
  });
});

describe("the billing page's free-plan line", () => {
  const line = (kind: "free" | "ended") => {
    const { container } = render(
      <PlanStatusLine status={{ kind } as never} planName="Free" priceLine="" hasPaymentMethod={false} />,
    );
    return container.textContent ?? "";
  };

  it("says the free card and deck limits from the constants", () => {
    for (const kind of ["free", "ended"] as const) {
      cleanup();
      const text = line(kind);
      expect(text, kind).toContain(`up to ${CARD_CAPACITY.free} saved cards`);
      expect(text, kind).toContain(`unlimited public decks and ${privateDecksPhrase("free")}`);
    }
    // A downgrade keeps everything (the caps check new rows only).
    cleanup();
    expect(line("ended")).toContain("Every card and deck you made stays yours.");
  });

  it("holds no hard-coded limit any more", () => {
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

  it("answers the deck limit from the constants, with the grandfathering", () => {
    const a = answer("How many decks can I make?");
    expect(a).toContain("As many public decks as you like, on every plan.");
    expect(a).toContain(privateDecksByPlanSentence());
    expect(a).toContain("never locks a deck");
  });

  it("answers that an import uses no slots until a card is customized (D2), from CARD_CAPACITY", () => {
    const a = answer("Does importing a decklist use my saved-card slots?");
    expect(a).toMatch(/^No\./);
    expect(a).toContain(`Free holds ${CARD_CAPACITY.free}, Plus ${CARD_CAPACITY.plus}, Pro unlimited`);
  });
});
