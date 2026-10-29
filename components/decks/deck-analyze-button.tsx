"use client";

import { Button } from "@/components/ui/button";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";

// The deck guide's upgrade CTA (a non-Pro viewer on a deck that has a guide).
// The owner's "Analyze this deck · 1 credit" / "Refresh analysis" that lived
// here was removed when deck AI was paused (owner 2026-10-28, TODO DK1 — D4):
// the guide section shows them greyed ("Coming soon") and POST
// /api/decks/[id]/guide answers DECK_AI_PAUSED (lib/ai/deck-ai-pause.ts).

export function DeckGuideUpgradeButton() {
  const upgrade = useUpgradeModal();
  return (
    <Button type="button" onClick={() => upgrade.open("deck_guide")} className="shrink-0">
      Upgrade to Pro
    </Button>
  );
}
