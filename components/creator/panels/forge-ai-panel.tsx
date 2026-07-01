"use client";

// Forge AI panel — the AI assistant, temporarily gated behind a "Coming soon"
// overlay. Split out of the Text panel so it can render at the very bottom of
// the Text & stats step (below the power/toughness stats). The assistant still
// mounts underneath the overlay so the layout is preview-accurate for launch.

import {
  AIAssistantPanel,
  type CardFieldPatch,
} from "@/components/creator/ai-assistant-panel";
import type { CardContext } from "@/lib/ai/schemas";

type ForgeAIPanelProps = {
  cardContext: CardContext;
  aiConfigured: boolean;
  onAIPatch: (patch: CardFieldPatch) => void;
};

export function ForgeAIPanel({
  cardContext,
  aiConfigured,
  onAIPatch,
}: ForgeAIPanelProps) {
  return (
    <div id="ai-assistant-anchor" className="relative scroll-mt-20">
      <div className="pointer-events-none select-none opacity-40 blur-[1px]">
        <AIAssistantPanel
          cardContext={cardContext}
          onApply={onAIPatch}
          configured={aiConfigured}
        />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="rounded-full border border-border/70 bg-background/90 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted shadow-lg backdrop-blur-sm">
          Forge AI · Coming soon
        </span>
      </div>
    </div>
  );
}
