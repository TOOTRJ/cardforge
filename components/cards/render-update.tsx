"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Sparkles } from "lucide-react";
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
  listStaleOwnCardsAction,
  rebakeOwnCardAction,
  type StaleOwnCard,
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
//   RenderUpdateDialog  — one card: compare + Update / Not now
//   RenderUpdateBadge   — the corner icon on a dashboard tile → dialog
//   RenderUpdateNotice  — the banner on the edit page → dialog
//   RenderUpdateWizard  — every affected card, one at a time: Skip / Update /
//                         Update all remaining
//   RenderUpdateAll     — the dashboard banner → wizard; also opened by the
//                         `?update-cards=1` link the render_update
//                         notification carries
//   ConfirmPermanent    — "this replaces the stored image and can't be
//                         undone" — asked before any update
// ---------------------------------------------------------------------------

type CardForUpdate = {
  id: string;
  title: string;
  renderedImageUrl: string | null;
  previewData: CardPreviewData;
};

// ---------------------------------------------------------------------------
// Confirmation — the update replaces the stored image; there is no undo.
// ---------------------------------------------------------------------------

function ConfirmPermanent({
  open,
  onOpenChange,
  count,
  onConfirm,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many cards the confirmed action updates. */
  count: number;
  onConfirm: () => void;
  pending?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-gold" aria-hidden />
            Update {count === 1 ? "this card" : `${count} cards`}?
          </DialogTitle>
          <DialogDescription>
            This re-renders the card with the current frame and replaces its
            stored image. The change is permanent — the previous image can&apos;t
            be restored. Your card&apos;s text and art are not affected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={pending}>
            <RefreshCw className={cn("h-4 w-4", pending ? "animate-spin" : "")} aria-hidden />
            {pending ? "Updating…" : count === 1 ? "Update card" : `Update ${count} cards`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Compare view (shared by the single-card dialog and the wizard)
// ---------------------------------------------------------------------------

function CompareView({ card }: { card: CardForUpdate }) {
  return (
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
  );
}

// ---------------------------------------------------------------------------
// Single card
// ---------------------------------------------------------------------------

function RenderUpdateDialog({
  card,
  open,
  onOpenChange,
}: {
  card: CardForUpdate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const update = () => {
    startTransition(async () => {
      const result = await rebakeOwnCardAction(card.id);
      if (!result.ok) {
        toast.error(result.error);
        setConfirming(false);
        return;
      }
      toast.success(`${card.title} now uses the current frame.`);
      setConfirming(false);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <>
      <Dialog open={open && !confirming} onOpenChange={onOpenChange}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>A newer look is available</DialogTitle>
            <DialogDescription>
              The frame or renderer changed since this card&apos;s image was made.
              Update to re-render it, or keep the current image for now — your
              card&apos;s text and art never change either way.
            </DialogDescription>
          </DialogHeader>
          <CompareView card={card} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Not now
            </Button>
            <Button type="button" onClick={() => setConfirming(true)}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              Update card
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmPermanent
        open={confirming}
        onOpenChange={setConfirming}
        count={1}
        onConfirm={update}
        pending={pending}
      />
    </>
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

// ---------------------------------------------------------------------------
// Wizard — every affected card, one at a time
// ---------------------------------------------------------------------------

type WizardStatus = "pending" | "updated" | "skipped" | "failed";

function RenderUpdateWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Every open gets a fresh body (fresh list, fresh statuses): bump a key
  // when `open` flips to true — adjusted during render, not in an effect.
  const [session, setSession] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSession((n) => n + 1);
  }
  if (!open) return null;
  return <WizardBody key={session} onOpenChange={onOpenChange} />;
}

function WizardBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const open = true;
  const router = useRouter();
  const [cards, setCards] = useState<StaleOwnCard[] | null>(null);
  const [status, setStatus] = useState<Record<string, WizardStatus>>({});
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"one" | "all" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const changed = useRef(false);

  // Load the stale list once per open (the list changes as cards update).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listStaleOwnCardsAction();
      if (cancelled) return;
      if (!result.ok) {
        toast.error(result.error);
        onOpenChange(false);
        return;
      }
      setCards(result.cards);
    })();
    return () => {
      cancelled = true;
    };
  }, [onOpenChange]);

  const close = useCallback(
    (next: boolean) => {
      if (busy) return;
      onOpenChange(next);
      if (!next && changed.current) router.refresh();
    },
    [busy, onOpenChange, router],
  );

  const total = cards?.length ?? 0;
  const current = cards?.[index] ?? null;
  const remaining = cards ? cards.filter((c) => (status[c.id] ?? "pending") === "pending") : [];
  const updatedCount = Object.values(status).filter((s) => s === "updated").length;

  const advance = (from: number) => {
    // Next card still pending after `from`, else the first pending, else stay.
    if (!cards) return;
    const after = cards.findIndex((c, i) => i > from && (status[c.id] ?? "pending") === "pending");
    if (after >= 0) return setIndex(after);
    const any = cards.findIndex((c) => (status[c.id] ?? "pending") === "pending");
    setIndex(any >= 0 ? any : Math.min(from, cards.length - 1));
  };

  const skip = () => {
    if (!current) return;
    setStatus((s) => ({ ...s, [current.id]: "skipped" }));
    advance(index);
  };

  const updateOne = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const result = await rebakeOwnCardAction(current.id);
      if (!result.ok) {
        toast.error(result.error);
        setStatus((s) => ({ ...s, [current.id]: "failed" }));
      } else {
        changed.current = true;
        setStatus((s) => ({ ...s, [current.id]: "updated" }));
        setCards((list) =>
          list
            ? list.map((c) =>
                c.id === current.id ? { ...c, renderedImageUrl: result.renderedImageUrl } : c,
              )
            : list,
        );
      }
    } finally {
      setBusy(false);
      setConfirm(null);
      advance(index);
    }
  };

  const updateAllRemaining = async () => {
    if (!cards) return;
    const targets = remaining;
    setBusy(true);
    setProgress({ done: 0, total: targets.length });
    let done = 0;
    try {
      for (const card of targets) {
        setIndex(cards.findIndex((c) => c.id === card.id));
        const result = await rebakeOwnCardAction(card.id);
        if (!result.ok) {
          toast.error(`${card.title}: ${result.error}`);
          setStatus((s) => ({ ...s, [card.id]: "failed" }));
        } else {
          changed.current = true;
          setStatus((s) => ({ ...s, [card.id]: "updated" }));
        }
        done += 1;
        setProgress({ done, total: targets.length });
      }
      toast.success(`Updated ${done} card${done === 1 ? "" : "s"} to the current frame.`);
    } finally {
      setBusy(false);
      setConfirm(null);
      setProgress(null);
    }
  };

  const allSettled = cards !== null && remaining.length === 0;

  return (
    <>
      <Dialog open={open && confirm === null} onOpenChange={close}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {cards === null
                ? "Checking your cards…"
                : total === 0
                  ? "All your cards use the current frame"
                  : allSettled
                    ? `Done — ${updatedCount} of ${total} updated`
                    : `Card ${index + 1} of ${total}${current ? ` — ${current.title}` : ""}`}
            </DialogTitle>
            <DialogDescription>
              {cards === null
                ? "Finding cards whose stored image predates the current frame."
                : total === 0
                  ? "Nothing to update."
                  : allSettled
                    ? "Skipped cards keep their current image; the badge stays on them until you update."
                    : "Compare each card's stored image with the current frame. Update it, skip it, or update everything that's left."}
            </DialogDescription>
          </DialogHeader>

          {current && !allSettled ? <CompareView card={current} /> : null}

          {progress ? (
            <p className="px-6 text-sm text-muted" aria-live="polite">
              Updating… {progress.done} of {progress.total} done.
            </p>
          ) : null}

          <DialogFooter className="flex-wrap">
            {cards !== null && !allSettled && total > 1 ? (
              <div className="mr-auto flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={busy || index === 0}
                  aria-label="Previous card"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
                  disabled={busy || index >= total - 1}
                  aria-label="Next card"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ) : null}
            {allSettled || total === 0 ? (
              <Button type="button" onClick={() => close(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={skip} disabled={busy || !current}>
                  Skip
                </Button>
                {remaining.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirm("all")}
                    disabled={busy}
                  >
                    Update all remaining ({remaining.length})
                  </Button>
                ) : null}
                <Button type="button" onClick={() => setConfirm("one")} disabled={busy || !current}>
                  <RefreshCw className={cn("h-4 w-4", busy ? "animate-spin" : "")} aria-hidden />
                  Update card
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmPermanent
        open={confirm !== null}
        onOpenChange={(next) => {
          if (!next && !busy) setConfirm(null);
        }}
        count={confirm === "all" ? remaining.length : 1}
        onConfirm={confirm === "all" ? updateAllRemaining : updateOne}
        pending={busy}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Dashboard banner → wizard. `?update-cards=1` (the notification's link)
// opens it on arrival.
// ---------------------------------------------------------------------------

const OPEN_PARAM = "update-cards";

export function RenderUpdateAll({ staleCount }: { staleCount: number }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // `?update-cards=1` (the notification's link) opens the wizard on arrival.
  // Open it during render (React's adjust-state-on-prop-change pattern);
  // the effect only drops the param so a refresh / back doesn't reopen it.
  const wantsOpen = searchParams.get(OPEN_PARAM) === "1";
  const [handledParam, setHandledParam] = useState(false);
  if (wantsOpen && !handledParam) {
    setHandledParam(true);
    setOpen(true);
  }
  useEffect(() => {
    if (!wantsOpen) return;
    // history.replaceState (not router.replace): Next syncs useSearchParams
    // from it WITHOUT a server round-trip — a router navigation re-renders
    // the dashboard's server components and unmounts the open wizard.
    const next = new URLSearchParams(searchParams.toString());
    next.delete(OPEN_PARAM);
    window.history.replaceState(null, "", next.size ? `${pathname}?${next}` : pathname);
  }, [wantsOpen, searchParams, pathname]);

  // The wizard must stay mountable even when the count is 0 (a notification
  // link can arrive after the cards were updated) — it then says so.
  const banner =
    !dismissed && staleCount > 0 ? (
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/40 bg-gold/5 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 text-left text-sm text-foreground hover:underline"
        >
          <Sparkles className="h-4 w-4 shrink-0 text-gold" aria-hidden />
          <span>
            <span className="font-semibold">{staleCount}</span>
            {` of your cards ${staleCount === 1 ? "has" : "have"} a newer look available. Review them one by one and choose which to update.`}
          </span>
        </button>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            Not now
          </Button>
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Review cards
          </Button>
        </div>
      </div>
    ) : null;

  return (
    <>
      {banner}
      <RenderUpdateWizard open={open} onOpenChange={setOpen} />
    </>
  );
}
