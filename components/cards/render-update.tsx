"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles } from "lucide-react";
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
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import {
  rebakeNextStaleOwnCardAction,
  rebakeOwnCardAction,
} from "@/lib/cards/render-actions";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Render updates, owner-facing.
//
// When the renderer or a frame changes, a card's stored gallery PNG lags
// behind the live preview until it is re-baked. Instead of an admin sweep
// deciding for everyone, the owner sees a badge on each affected card, can
// compare the stored image with what the current renderer would produce
// (the live <CardPreview> IS that), and chooses Update or Not now.
//
//   RenderUpdateDialog  — the compare view + Update/Not now (shared)
//   RenderUpdateBadge   — the corner icon on a dashboard tile → dialog
//   RenderUpdateNotice  — the banner on the edit page → dialog
//   RenderUpdateAll     — the dashboard banner that walks every stale card
//                         through rebakeNextStaleOwnCardAction
// ---------------------------------------------------------------------------

type CardForUpdate = {
  id: string;
  title: string;
  renderedImageUrl: string | null;
  previewData: CardPreviewData;
};

export function RenderUpdateDialog({
  card,
  open,
  onOpenChange,
}: {
  card: CardForUpdate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const update = () => {
    startTransition(async () => {
      const result = await rebakeOwnCardAction(card.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${card.title} now uses the current frame.`);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>A newer look is available</DialogTitle>
          <DialogDescription>
            The frame or renderer changed since this card&apos;s image was made.
            Update to re-render it, or keep the current image for now — your
            card&apos;s text and art never change either way.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 overflow-y-auto px-6 pb-2 sm:grid-cols-2">
          <figure className="mx-auto flex w-full max-w-[300px] flex-col gap-2">
            <figcaption className="text-xs font-semibold uppercase tracking-wider text-muted">
              Current image
            </figcaption>
            {card.renderedImageUrl ? (
              <div className="relative aspect-[5/7] w-full overflow-hidden rounded-frame border border-border/40">
                <Image
                  src={card.renderedImageUrl}
                  alt={`${card.title} — current image`}
                  fill
                  sizes="(min-width: 640px) 320px, 100vw"
                  className="object-contain"
                  unoptimized
                />
              </div>
            ) : (
              <div className="flex aspect-[5/7] w-full items-center justify-center rounded-frame border border-dashed border-border/60 p-6 text-center text-sm text-muted">
                No stored image yet — the gallery shows the live preview.
              </div>
            )}
          </figure>
          <figure className="mx-auto flex w-full max-w-[300px] flex-col gap-2">
            <figcaption className="text-xs font-semibold uppercase tracking-wider text-muted">
              After update
            </figcaption>
            <CardPreview {...card.previewData} />
          </figure>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Not now
          </Button>
          <Button type="button" onClick={update} disabled={pending}>
            <RefreshCw className={cn("h-4 w-4", pending ? "animate-spin" : "")} aria-hidden />
            {pending ? "Updating…" : "Update card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Corner icon on a dashboard tile. Stops propagation so the tile's own
 *  click (view / select) doesn't fire. */
export function RenderUpdateBadge({
  card,
  className,
}: {
  card: CardForUpdate;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          setOpen(true);
        }}
        title="A newer look is available — compare and update"
        aria-label={`A newer look is available for ${card.title} — compare and update`}
        className={cn(
          "absolute left-3 top-3 z-40 flex h-7 w-7 items-center justify-center rounded-md border border-gold/50 bg-background/85 text-gold shadow-md transition-colors",
          "hover:border-gold hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
          className,
        )}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
      </button>
      <RenderUpdateDialog card={card} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Banner on the edit page for a stale card. */
export function RenderUpdateNotice({ card }: { card: CardForUpdate }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/40 bg-gold/5 px-4 py-3">
      <p className="flex items-center gap-2 text-sm text-foreground">
        <Sparkles className="h-4 w-4 text-gold" aria-hidden />
        A newer look is available for this card — its stored image predates the
        current frame.
      </p>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Compare &amp; update
      </Button>
      <RenderUpdateDialog card={card} open={open} onOpenChange={setOpen} />
    </div>
  );
}

/** Dashboard banner: walks every stale card of the signed-in owner. */
export function RenderUpdateAll({ staleCount }: { staleCount: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [remaining, setRemaining] = useState(staleCount);
  const [dismissed, setDismissed] = useState(false);
  // A fresh server count (router.refresh() after a single-card update from a
  // tile badge) wins over the number this banner mounted with — adjust
  // during render, not in an effect.
  const [syncedCount, setSyncedCount] = useState(staleCount);
  if (syncedCount !== staleCount) {
    setSyncedCount(staleCount);
    if (!running) setRemaining(staleCount);
  }

  if (dismissed || (remaining <= 0 && !running)) return null;

  const updateAll = async () => {
    setRunning(true);
    let left = remaining;
    let updated = 0;
    try {
      // One card per request, sequentially — a couple of seconds each and
      // never more than one render in flight for this user.
      for (let guard = 0; guard < 1000 && left > 0; guard += 1) {
        const result = await rebakeNextStaleOwnCardAction();
        if (!result.ok) {
          toast.error(result.error);
          break;
        }
        if (result.updated) updated += 1;
        left = result.remaining;
        setDone(updated);
        setRemaining(left);
      }
      if (left === 0) {
        toast.success(
          updated === 0
            ? "All your cards already use the current frame."
            : `Updated ${updated} card${updated === 1 ? "" : "s"} to the current frame.`,
        );
      }
    } finally {
      setRunning(false);
      router.refresh();
    }
  };

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/40 bg-gold/5 px-4 py-3">
      <p className="flex items-center gap-2 text-sm text-foreground">
        <Sparkles className="h-4 w-4 text-gold" aria-hidden />
        {running ? (
          <>
            Updating your cards… {done} done, {remaining} to go.
          </>
        ) : (
          <>
            <span className="font-semibold">{remaining}</span>
            {` of your cards ${remaining === 1 ? "has" : "have"} a newer look available. Hover a card's star to compare, or update them all.`}
          </>
        )}
      </p>
      <div className="flex items-center gap-2">
        {!running ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            Not now
          </Button>
        ) : null}
        <Button type="button" size="sm" onClick={updateAll} disabled={running}>
          <RefreshCw className={cn("h-4 w-4", running ? "animate-spin" : "")} aria-hidden />
          {running ? "Updating…" : "Update all"}
        </Button>
      </div>
    </div>
  );
}
