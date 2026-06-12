"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { PremiumBadge } from "@/components/billing/premium-badge";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";

// Pro "generate a whole set with AI". Free/Plus users see the control with a
// Premium badge; clicking opens the upgrade modal. (The constants are inlined
// rather than imported from lib/ai/deck-gen, which is server-only.)
const SIZE_OPTIONS = [4, 6, 8, 10, 12];
const DEFAULT_SIZE = 8;

type AiDeckGeneratorProps = {
  allowDeckGen: boolean;
  aiConfigured: boolean;
};

export function AiDeckGenerator({
  allowDeckGen,
  aiConfigured,
}: AiDeckGeneratorProps) {
  const router = useRouter();
  const upgrade = useUpgradeModal();
  const [pending, startTransition] = useTransition();
  const [theme, setTheme] = useState("");
  const [size, setSize] = useState(DEFAULT_SIZE);

  function handleGenerate() {
    if (!allowDeckGen) {
      upgrade.open("deck_gen");
      return;
    }
    startTransition(async () => {
      try {
        const response = await fetch("/api/ai/generate-deck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ theme, size }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          if (
            response.status === 402 ||
            payload?.code === "INSUFFICIENT_CREDITS"
          ) {
            upgrade.open("credits");
            return;
          }
          if (response.status === 403 || payload?.code === "UPGRADE_REQUIRED") {
            upgrade.open("deck_gen");
            return;
          }
          toast.error(payload?.error ?? "Couldn't generate the set. Try again.");
          return;
        }
        toast.success(
          `Generated ${payload.count} cards — review and add art before publishing.`,
        );
        router.push(`/set/${payload.setSlug}/edit`);
        router.refresh();
      } catch {
        toast.error("Network error while generating the set.");
      }
    });
  }

  const inputClass =
    "h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 disabled:opacity-50";

  return (
    <SurfaceCard className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-elevated text-primary-bright">
          <Wand2 className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col">
          <span className="flex items-center gap-2 font-display text-sm font-semibold text-foreground">
            Generate a set with AI
            {allowDeckGen ? null : <PremiumBadge />}
          </span>
          <span className="text-xs text-muted">
            Draft a cohesive themed set in one click. Costs 1 credit per card.
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={theme}
          onChange={(event) => setTheme(event.target.value)}
          placeholder="Theme — e.g. “undersea goblin pirates”"
          className={`${inputClass} flex-1`}
          maxLength={200}
          disabled={pending}
        />
        <select
          value={size}
          onChange={(event) => setSize(Number(event.target.value))}
          className={inputClass}
          disabled={pending}
          aria-label="Number of cards"
        >
          {SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} cards
            </option>
          ))}
        </select>
        <Button
          type="button"
          onClick={handleGenerate}
          disabled={pending || !aiConfigured}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          Generate
        </Button>
      </div>

      {!aiConfigured ? (
        <p className="text-xs text-subtle">
          AI generation isn&apos;t configured on this deployment.
        </p>
      ) : null}
    </SurfaceCard>
  );
}
