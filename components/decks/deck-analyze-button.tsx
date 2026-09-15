"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";

// Owner-only "Analyze this deck · 1 credit" (or "Refresh analysis") — POSTs
// to /api/decks/[id]/guide and refreshes the page so the server-rendered
// guide section picks up the new row.

export function DeckAnalyzeButton({ deckId, refresh }: { deckId: string; refresh: boolean }) {
  const router = useRouter();
  const upgrade = useUpgradeModal();
  const [busy, setBusy] = useState(false);

  const analyze = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/decks/${deckId}/guide`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; code?: string }
        | null;
      if (!response.ok || !body?.ok) {
        if (body?.code === "UPGRADE_REQUIRED") upgrade.open("deck_guide");
        else if (body?.code === "INSUFFICIENT_CREDITS") upgrade.open("credits");
        toast.error(body?.error ?? "Analysis failed — try again.");
        return;
      }
      toast.success(refresh ? "Guide refreshed." : "Guide ready — scroll down to read it.");
      router.refresh();
    } catch {
      toast.error("Analysis failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button type="button" variant={refresh ? "outline" : "primary"} onClick={analyze} disabled={busy}>
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : refresh ? (
        <RefreshCw className="h-4 w-4" aria-hidden />
      ) : (
        <Sparkles className="h-4 w-4" aria-hidden />
      )}
      {refresh ? "Refresh analysis · 1 credit" : "Analyze this deck · 1 credit"}
    </Button>
  );
}

export function DeckGuideUpgradeButton() {
  const upgrade = useUpgradeModal();
  return (
    <Button type="button" onClick={() => upgrade.open("deck_guide")} className="shrink-0">
      Upgrade to Pro
    </Button>
  );
}
