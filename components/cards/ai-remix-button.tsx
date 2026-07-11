"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup, inputClass } from "@/components/creator/field-group";
import { useGenerationJob } from "@/components/ai/use-generation-job";

// ---------------------------------------------------------------------------
// AiRemixButton — "Remix with AI" on the card detail page. Sits beside the
// manual Remix (plain fork) button. Collects a style (+ optional theme) and
// runs a "card_remix" generation job, which forks the card with IDENTICAL
// mechanics but a new AI name, flavor, and art restyled from the original.
// The job runs in the background via the root GenerationJobProvider
// (floating progress widget; a closed tab pauses and auto-resumes) — this
// replaced the old single 60–90s /api/ai/remix-card request, which
// infrastructure timeouts cut and re-ran (double charge + phantom failure).
// ---------------------------------------------------------------------------

const STYLE_PRESETS = [
  "Anime",
  "Pixel art",
  "Oil painting",
  "Watercolor",
  "Comic book",
  "Dark fantasy",
];

export function AiRemixButton({
  cardId,
  cardSlug,
  ownerUsername,
  requiresSignIn = false,
  className,
}: {
  cardId: string;
  cardSlug: string;
  ownerUsername?: string | null;
  requiresSignIn?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const generationJob = useGenerationJob();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState("");
  const [theme, setTheme] = useState("");
  const [pending, setPending] = useState(false);

  const handleOpen = () => {
    if (requiresSignIn) {
      const next = ownerUsername
        ? `/card/${ownerUsername}/${cardSlug}`
        : `/card/${cardSlug}`;
      router.push(`/login?redirectTo=${encodeURIComponent(next)}`);
      return;
    }
    setOpen(true);
  };

  const handleRemix = async () => {
    if (!style.trim()) {
      toast.error("Pick or type a style first — that's what the remix is.");
      return;
    }
    // Close the dialog immediately — the remix runs as a background job with
    // its own floating progress widget; it's safe to keep browsing.
    setOpen(false);
    setPending(true);
    try {
      const outcome = await generationJob.run({
        kind: "card_remix",
        card_id: cardId,
        style: style.trim(),
        theme: theme.trim() || undefined,
      });
      if (!outcome.ok) {
        // Plan errors are toasted by the provider; step failures stay in the
        // widget with a Retry. Nothing else to do here.
        return;
      }
      toast.success("AI remix forged — it's saved to your library.", {
        ...(outcome.cardId
          ? {
              action: {
                label: "View card",
                onClick: () => router.push(`/go/card/${outcome.cardId}`),
              },
            }
          : {}),
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={handleOpen}
        disabled={pending}
        className={className}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-4 w-4" aria-hidden />
        )}
        AI remix
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" aria-hidden />
              Remix with AI
            </DialogTitle>
            <DialogDescription>
              Same card, new look: the rules stay identical while AI renames
              it and repaints the art in your chosen style.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <FieldGroup label="Style" helper="Required — how the remix should look.">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {STYLE_PRESETS.map((preset) => {
                    const active = style.toLowerCase() === preset.toLowerCase();
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setStyle(active ? "" : preset)}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                          active
                            ? "border-accent/70 bg-accent/15 text-foreground"
                            : "border-border bg-elevated/50 text-muted hover:border-border-strong hover:text-foreground"
                        }`}
                      >
                        {preset}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  value={style}
                  onChange={(event) => setStyle(event.target.value)}
                  maxLength={200}
                  placeholder="e.g. gritty charcoal sketch"
                  className={inputClass(false)}
                />
              </div>
            </FieldGroup>

            <FieldGroup
              label="Theme twist"
              helper="Optional extra direction for the new name and flavor."
            >
              <input
                type="text"
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
                maxLength={300}
                placeholder="e.g. set it in a frozen wasteland"
                className={inputClass(false)}
              />
            </FieldGroup>
          </div>

          <DialogFooter className="items-center gap-3 sm:justify-between">
            <span className="text-[11px] text-muted">
              Uses 1 AI credit · 10 remixes per day
            </span>
            <Button type="button" onClick={handleRemix} disabled={pending}>
              <Sparkles className="h-4 w-4" aria-hidden />
              Remix card
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
