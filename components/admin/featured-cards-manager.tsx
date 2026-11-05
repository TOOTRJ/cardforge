"use client";

// Homepage hero FALLBACK slots — paste a card page URL per slot. Since 0169
// the hero rotates through the pool (hero-pool-manager.tsx) and reads these
// only while it has fewer than two cards on the hero; the same original-card
// guard applies, and a slot card it holds back says why.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setFeaturedCardAction } from "@/lib/featured/actions";
import { heroRefusalLabel } from "@/lib/featured/hero-rotation";

type SlotInfo = {
  slot: number;
  title: string;
  ownerUsername: string;
  slug: string;
} | null;

export function FeaturedCardsManager({
  slots,
  refusals = [null, null],
}: {
  /** Current slot contents, index 0 = slot 1, index 1 = slot 2. */
  slots: [SlotInfo, SlotInfo];
  /** The hero's original-card guard on each slot's card (0169); null = shown. */
  refusals?: [string | null, string | null];
}) {
  const router = useRouter();
  const [urls, setUrls] = useState<[string, string]>(["", ""]);
  // Per-slot server rejection (bad URL, unpublished card…) rendered inline
  // under that slot's input.
  const [errors, setErrors] = useState<[string | null, string | null]>([
    null,
    null,
  ]);
  const [pending, startTransition] = useTransition();

  const setSlotError = (slot: 1 | 2, message: string | null) =>
    setErrors((prev) => {
      const next: [string | null, string | null] = [...prev];
      next[slot - 1] = message;
      return next;
    });

  const run = (slot: 1 | 2, url: string | null) =>
    startTransition(async () => {
      const result = await setFeaturedCardAction(slot, url);
      if (!result.ok) {
        setSlotError(slot, result.error);
        return;
      }
      setSlotError(slot, null);
      toast.success(url ? "Featured card set." : "Slot cleared.");
      setUrls((prev) => {
        const next: [string, string] = [...prev];
        next[slot - 1] = "";
        return next;
      });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      {[1, 2].map((n) => {
        const slot = n as 1 | 2;
        const current = slots[slot - 1];
        return (
          <div key={slot} className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
              Slot {slot}
            </span>
            {current ? (
              <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-elevated/30 px-4 py-3">
                <Star className="h-4 w-4 shrink-0 text-gold" aria-hidden />
                <span className="min-w-0 flex-1 text-sm text-foreground">
                  <span className="block truncate">
                    {current.title}{" "}
                    <span className="text-subtle">
                      — /card/{current.ownerUsername}/{current.slug}
                    </span>
                  </span>
                  {refusals[slot - 1] ? (
                    <span className="block text-xs text-gold-strong">
                      Not on the hero: {heroRefusalLabel(refusals[slot - 1] as string)}
                    </span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(slot, null)}
                >
                  <X className="h-4 w-4" aria-hidden />
                  Remove
                </Button>
              </div>
            ) : (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (urls[slot - 1].trim()) run(slot, urls[slot - 1]);
                }}
              >
                <input
                  value={urls[slot - 1]}
                  onChange={(e) => {
                    setUrls((prev) => {
                      const next: [string, string] = [...prev];
                      next[slot - 1] = e.target.value;
                      return next;
                    });
                    if (errors[slot - 1]) setSlotError(slot, null);
                  }}
                  placeholder="https://www.pipglyph.com/card/username/card-slug"
                  aria-label={`Card URL for slot ${slot}`}
                  aria-invalid={Boolean(errors[slot - 1])}
                  className={`w-full max-w-md rounded-md border bg-elevated/40 px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-primary/60 focus:outline-none ${errors[slot - 1] ? "border-danger/60" : "border-border"}`}
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={pending || !urls[slot - 1].trim()}
                >
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Star className="h-4 w-4" aria-hidden />
                  )}
                  Feature
                </Button>
                {errors[slot - 1] ? (
                  <p role="alert" className="w-full text-xs text-danger">
                    {errors[slot - 1]}
                  </p>
                ) : null}
              </form>
            )}
            {current && errors[slot - 1] ? (
              <p role="alert" className="text-xs text-danger">
                {errors[slot - 1]}
              </p>
            ) : null}
          </div>
        );
      })}
      <p className="text-[11px] text-subtle">
        Cards must be public with a baked render. With the pool short and both
        slots empty, the homepage shows its standard placeholder pair.
      </p>
    </div>
  );
}
