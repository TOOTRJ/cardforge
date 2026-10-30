// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

// ---------------------------------------------------------------------------
// Deck guides behind "Coming soon" (owner 2026-10-30, `DECK_GUIDES_ENABLED`
// in lib/ai/deck-ai-pause.ts). Every viewer — owner, visitor, Pro or not —
// sees ONE hidden look: the "Game plan & combos" heading with the deck AI's
// "Coming soon" badge (components/decks/deck-ai-coming-soon.tsx), the one
// line that says why as readable text, the guide's panels greyed and empty,
// and nothing that takes the focus. A guide handed to the section is never
// drawn (the page hands it none: lib/decks/guides.ts `readShownDeckGuide`,
// tests/unit/decks/deck-guide-read.test.ts).
// ---------------------------------------------------------------------------

vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));

import { DeckGuideComingSoon, DeckGuideSection } from "@/components/decks/deck-guide-section";
import { DECK_GUIDES_ENABLED, DECK_GUIDES_HIDDEN_MESSAGE } from "@/lib/ai/deck-ai-pause";
import type { DeckGuide } from "@/lib/decks/guides";

const GUIDE: DeckGuide = {
  deck_id: "deck-1",
  overview: "Swarm the board, then sacrifice for value.",
  game_plan: ["Play two-drops on curve.", "Swing with everything."],
  mulligan: "Keep two lands and a goblin.",
  combos: [{ cards: ["Goblin Bombardment", "Krenko"], description: "Infinite pings off the swarm." }],
  weaknesses: "Board sweepers.",
  key_cards: ["Goblin Bombardment"],
  source: "generation",
  generated_at: "2026-10-01T00:00:00.000Z",
};

const GUIDE_TEXTS = [
  GUIDE.overview,
  ...GUIDE.game_plan,
  GUIDE.mulligan,
  GUIDE.weaknesses,
  GUIDE.combos[0]!.description,
  "Goblin Bombardment",
  "Krenko",
];

const VIEWERS = [
  { name: "the owner (Pro)", isOwner: true, viewerIsPro: true },
  { name: "the owner (free)", isOwner: true, viewerIsPro: false },
  { name: "a Pro visitor", isOwner: false, viewerIsPro: true },
  { name: "a signed-out visitor", isOwner: false, viewerIsPro: false },
] as const;

const hiddenSection = (viewer: (typeof VIEWERS)[number], guide: DeckGuide | null = GUIDE) => (
  <DeckGuideSection
    deckId="deck-1"
    hidden
    guide={guide}
    guideWithheld={!guide}
    isOwner={viewer.isOwner}
    viewerIsPro={viewer.viewerIsPro}
    aiConfigured
    hasCards
  />
);

afterEach(cleanup);

describe("the deck guide while deck guides are hidden", () => {
  it("is off today (the one switch)", () => {
    expect(DECK_GUIDES_ENABLED).toBe(false);
  });

  for (const viewer of VIEWERS) {
    it(`${viewer.name} sees the one Coming soon look and never the guide`, () => {
      render(hiddenSection(viewer));
      expect(screen.getByRole("heading", { name: "Game plan & combos — coming soon" })).toBeTruthy();
      expect(screen.getByText("Coming soon")).toBeTruthy();
      const line = screen.getByText(DECK_GUIDES_HIDDEN_MESSAGE);
      expect(line.tagName).toBe("P");
      expect(line.closest("[aria-hidden]")).toBeNull();
      expect(line.className).not.toMatch(/sr-only/);
      for (const text of GUIDE_TEXTS) expect(screen.queryByText(text, { exact: false })).toBeNull();
      // Nothing to press or tab to: no upgrade prompt, no greyed analyze.
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
      expect(document.querySelector("[tabindex]")).toBeNull();
    });
  }

  it("the server HTML holds no guide text, whatever the section is handed", () => {
    for (const viewer of VIEWERS) {
      const html = renderToStaticMarkup(hiddenSection(viewer));
      expect(html).toContain("Game plan &amp; combos");
      expect(html).toContain("Guides already written are saved.");
      for (const text of GUIDE_TEXTS) expect(html).not.toContain(text);
      expect(html).not.toMatch(/Pro feature|Upgrade to Pro|Analyze|Refresh/);
    }
    expect(renderToStaticMarkup(<DeckGuideComingSoon />)).toBe(renderToStaticMarkup(hiddenSection(VIEWERS[0])));
  });

  it("the same section with the flag flipped back draws the guide for a Pro viewer as before", () => {
    render(
      <DeckGuideSection deckId="deck-1" guide={GUIDE} isOwner={false} viewerIsPro aiConfigured hasCards />,
    );
    expect(screen.getByText(GUIDE.overview)).toBeTruthy();
    expect(screen.queryByText(DECK_GUIDES_HIDDEN_MESSAGE)).toBeNull();
  });
});
