// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// TODO 6.26 — the pricing and upgrade copy for the print features says what
// is BUILT, and /pricing (the plan cards), the upgrade modal and the FAQ say
// the same thing. The plan cards and the modal read ONE source
// (lib/billing/plans.ts: PLUS_PRINT_PERKS, PRO_PRINT_PERKS, PRINT_PERK_COPY);
// the FAQ's "Exports & printing" prose is held to the same facts
// (PRINT_PERK_FACTS). And each fact is held to the code that serves it, so
// a gate that moves fails here before the copy can lie. Copy only: prices,
// limits and entitlements are not read or changed.
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
  createCheckoutSessionAction: vi.fn(),
  createPortalSessionAction: vi.fn(),
}));
vi.mock("@/lib/routing/navigate", () => ({ navigateTo: vi.fn() }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));
vi.mock("@/lib/supabase/session-cookie", () => ({ hasSupabaseSessionCookie: () => true }));

import { UpgradeModal } from "@/components/billing/upgrade-modal";
import {
  PLANS,
  PLUS_PRINT_PERKS,
  PRINT_PERK_COPY,
  PRINT_PERK_FACTS,
  PRO_PRINT_PERKS,
  planForTier,
} from "@/lib/billing/plans";
import { FAQ_TOPICS } from "@/lib/content/faq";
import { MPC_BLEED_IN, PRINT_800_PPI_PAID_ONLY, BLEED_IN, printPixelSize } from "@/lib/cards/print-export";
import { SIZE_OPTIONS, MARK_OPTIONS, GAP_OPTIONS } from "@/components/cards/print-sheet-options";
import { CARD_SIZE_PT, PAPER_PT } from "@/lib/render/sheet-layout";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ user: null }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const exportsFaq = () => {
  const topic = FAQ_TOPICS.find((t) => t.slug === "exports");
  if (!topic) throw new Error("no Exports & printing FAQ topic");
  return topic.entries.map((e) => e.a).join("\n");
};

describe("the print perks — one source, the same facts everywhere (TODO 6.26)", () => {
  it("the plan cards list the source's lines, in Plus's and Pro's cards", () => {
    for (const line of PLUS_PRINT_PERKS) expect(planForTier("plus").features).toContain(line);
    for (const line of PRO_PRINT_PERKS) expect(planForTier("pro").features).toContain(line);
    // Free sells none of them.
    for (const line of [...PLUS_PRINT_PERKS, ...PRO_PRINT_PERKS]) expect(planForTier("free").features).not.toContain(line);
  });

  it("no plan card sells the old set (3×3 sheets only, the 1500×2100 PNG alone)", () => {
    const all = PLANS.flatMap((p) => p.features).join("\n");
    expect(all).not.toMatch(/3×3|3 × 3/);
    expect(all).not.toMatch(/^High-resolution \(1500×2100\) PNG$/m);
  });

  it.each(["plus", "pro"] as const)("%s: the plan card, the upgrade modal and the FAQ each state every fact", (tier) => {
    const card = (tier === "plus" ? PLUS_PRINT_PERKS : PRO_PRINT_PERKS).join("\n");
    const modal = tier === "plus" ? `${PRINT_PERK_COPY.clean}\n${PRINT_PERK_COPY.pdf}` : PRINT_PERK_COPY.sheets;
    const faq = exportsFaq();
    for (const fact of PRINT_PERK_FACTS[tier]) {
      expect(card, `plan card: ${fact}`).toMatch(fact);
      expect(modal, `upgrade modal: ${fact}`).toMatch(fact);
      expect(faq, `FAQ: ${fact}`).toMatch(fact);
    }
  });

  it.each([
    ["hi_res_export", PRINT_PERK_COPY.clean],
    ["pdf_export", PRINT_PERK_COPY.pdf],
    ["batch_export", PRINT_PERK_COPY.sheets],
  ] as const)("the upgrade modal's %s reason says the source's words", (reason, words) => {
    render(<UpgradeModal open reason={reason} onOpenChange={() => {}} />);
    expect(screen.getByText(words)).toBeTruthy();
  });
});

describe("…and every fact is what the code serves", () => {
  it("Plus: 1500 × 2100 is the 600 ppi render, 800 ppi is paid-only, the bleed is 1/8″, MakePlayingCards has its file", () => {
    expect(printPixelSize(600, { bleed: false })).toMatchObject({ width: 1500, height: 2100 });
    expect(printPixelSize(800, { bleed: false })).toMatchObject({ width: 2000, height: 2800 });
    // The copy sells 800 ppi as a paid perk: if it becomes free, say so.
    expect(PRINT_800_PPI_PAID_ONLY).toBe(true);
    expect(BLEED_IN).toBe(0.125);
    expect(MPC_BLEED_IN.x).toBeGreaterThan(0);
  });

  it("Pro: the sheet options the copy names are the ones the sheet UI offers", () => {
    expect(Object.keys(PAPER_PT).sort()).toEqual(["a4", "letter"]);
    expect(SIZE_OPTIONS.map((o) => o.label)).toContain("63 × 88 mm");
    expect(CARD_SIZE_PT.mm.width / CARD_SIZE_PT.mm.height).toBeCloseTo(63 / 88, 6);
    expect(MARK_OPTIONS.length).toBeGreaterThan(0);
    expect(GAP_OPTIONS.map((o) => o.value)).toContain("sixteenth");
  });
});
