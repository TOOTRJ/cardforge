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

// ---------------------------------------------------------------------------
// AiRemixButton — "Remix with AI" on the card detail page. Sits beside the
// manual Remix (plain fork) button. Collects a style (+ optional theme) and
// calls /api/ai/remix-card, which forks the card with IDENTICAL mechanics
// but a new AI name, flavor, and art restyled from the original. On success
// the user lands in the editor on their new private remix.
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
    setPending(true);
    try {
      const response = await fetch("/api/ai/remix-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card_id: cardId,
          style: style.trim(),
          theme: theme.trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        toast.error(payload?.error ?? "AI remix failed. Try again.");
        return;
      }
      if (payload.artError) {
        toast.message("Remix created — art kept from the original.", {
          description: payload.artError,
        });
      } else {
        toast.success("AI remix forged — opening in the editor.");
      }
      setOpen(false);
      router.push(`/card/${payload.slug}/edit`);
    } catch {
      toast.error("Network error while remixing.");
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
        className={className}
      >
        <Sparkles className="h-4 w-4" aria-hidden />
        AI remix
      </Button>

      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
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
                        disabled={pending}
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
                  disabled={pending}
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
                disabled={pending}
              />
            </FieldGroup>
          </div>

          <DialogFooter className="items-center gap-3 sm:justify-between">
            <span className="text-[11px] text-muted">
              Uses 1 AI credit · 10 remixes per day
            </span>
            <Button type="button" onClick={handleRemix} disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Remixing…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Remix card
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
