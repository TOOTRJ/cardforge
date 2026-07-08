"use client";

// Homepage hero card slots — paste a card page URL per slot; the hero swaps
// its placeholder pair for the real cards (and falls back to placeholders
// when both slots are empty).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setFeaturedCardAction } from "@/lib/featured/actions";

type SlotInfo = {
  slot: number;
  title: string;
  ownerUsername: string;
  slug: string;
} | null;

export function FeaturedCardsManager({
  slots,
}: {
  /** Current slot contents, index 0 = slot 1, index 1 = slot 2. */
  slots: [SlotInfo, SlotInfo];
}) {
  const router = useRouter();
  const [urls, setUrls] = useState<[string, string]>(["", ""]);
  const [pending, startTransition] = useTransition();

  const run = (slot: 1 | 2, url: string | null) =>
    startTransition(async () => {
      const result = await setFeaturedCardAction(slot, url);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
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
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {current.title}{" "}
                  <span className="text-subtle">
                    — /card/{current.ownerUsername}/{current.slug}
                  </span>
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
                  onChange={(e) =>
                    setUrls((prev) => {
                      const next: [string, string] = [...prev];
                      next[slot - 1] = e.target.value;
                      return next;
                    })
                  }
                  placeholder="https://www.pipglyph.com/card/username/card-slug"
                  aria-label={`Card URL for slot ${slot}`}
                  className="w-full max-w-md rounded-md border border-border bg-elevated/40 px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-primary/60 focus:outline-none"
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
              </form>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-subtle">
        Cards must be public with a baked render. With both slots empty, the
        homepage shows its standard placeholder pair.
      </p>
    </div>
  );
}
