"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RelativeTime } from "@/components/ui/local-date";
import {
  REART_EARLIER_STYLE_COPY,
  REART_PICTURE_GONE,
  REART_ROLLS_KEPT_COPY,
  REART_ROW_PICTURE,
  type ReartEarlierPicture,
  type ReartStudioEntry,
} from "@/lib/tools/re-art/model";
import { chooseReartPictureAction } from "@/lib/tools/re-art/actions";

/**
 * A card's EARLIER PICTURES (migration 0215): the picture it shows now, and
 * the ones Re-art keeps for it on this deck — a re-roll and "Old art back"
 * keep the picture they take off. "Use this one" puts a kept picture back on
 * the card: nothing is painted or charged, and the picture it replaces is
 * kept in its place.
 */
export function ReartEarlierPicturesDialog({
  open,
  onOpenChange,
  deckId,
  entry,
  onChosen,
  onGone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId: string;
  entry: ReartStudioEntry;
  /** A picture was put on the card (the page re-reads). */
  onChosen: () => void;
  /** The server took a picture off the list (its file is gone): the page
   *  re-reads, and the dialog stays open on what is left. */
  onGone?: () => void;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Pictures that didn't load here (their file may be gone: the server
   *  decides when one is picked). */
  const [unloaded, setUnloaded] = useState<ReadonlySet<string>>(new Set());
  // A refusal belongs to the visit it was said in: opened again, the dialog
  // starts clean (a reset during render).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setUnloaded(new Set());
    }
  }
  const [, startTransition] = useTransition();
  /** A picture was just picked: the card's "Earlier pictures" button may be
   *  gone when the page re-reads (none left), so the focus goes to the
   *  card's paint button instead. */
  const picked = useRef(false);
  const card = entry.card;
  const earlier = entry.earlier ?? [];

  const choose = (picture: ReartEarlierPicture) => {
    if (working || !card) return;
    setError(null);
    setWorking(picture.id);
    startTransition(async () => {
      try {
        const result = await chooseReartPictureAction(deckId, card.id, picture.id);
        if (!result.ok) {
          setError(result.error);
          if (result.error === REART_PICTURE_GONE) onGone?.();
          return;
        }
        picked.current = true;
        onChosen();
      } catch {
        setError("We couldn't reach PipGlyph — try again.");
      } finally {
        setWorking(null);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!working ? onOpenChange(next) : undefined)}>
      <DialogContent
        size="lg"
        className="max-h-[92vh] overflow-y-auto"
        // Closed either way, the focus goes back to the card: the button
        // that opened it — or, after a pick, the card's paint button (the
        // opener can be gone by then). Never to <body>.
        onCloseAutoFocus={(event) => {
          const at = (name: string) => document.querySelector<HTMLElement>(`[data-${name}="${entry.id}"]`);
          const target = (picked.current ? null : at("earlier-pictures")) ?? at("reart-paint");
          picked.current = false;
          if (!target) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Earlier pictures of {entry.name}</DialogTitle>
          <DialogDescription>
            Go back to a picture Re-art painted for this card before. Nothing is painted or charged, and the picture on
            the card now is kept in its place.
          </DialogDescription>
        </DialogHeader>

        {/* The dialog pads its header and footer only: the pictures get the
            same gutter, so none touches the dialog's edge. */}
        <div className="flex flex-col gap-4 px-5 py-4">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <li className="flex flex-col gap-2">
            <Picture url={card?.art_url ?? null} alt={`${entry.name} — the picture on the card now`} />
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <Badge variant="primary">On the card now</Badge>
            </p>
          </li>
          {earlier.map((picture, index) => {
            const label = `earlier picture ${index + 1} of ${earlier.length}`;
            return (
              <li key={picture.id} className="flex flex-col gap-2">
                <Picture
                  url={picture.artUrl}
                  alt={`${entry.name} — ${label}`}
                  onError={() => setUnloaded((before) => new Set(before).add(picture.id))}
                />
                {unloaded.has(picture.id) ? (
                  <p className="text-xs text-warning">This picture didn&apos;t load. It may no longer be in storage.</p>
                ) : null}
                {picture.backArtUrl ? <Picture url={picture.backArtUrl} alt={`${entry.name} — ${label}, its back face`} small /> : null}
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {picture.id === REART_ROW_PICTURE ? <Badge variant="outline">This deck&apos;s last picture</Badge> : null}
                  {picture.earlierStyle ? <Badge variant="gold">Earlier style</Badge> : null}
                  <span>
                    Painted <RelativeTime iso={picture.paintedAt} />
                  </span>
                  {picture.paintedBy ? (
                    <span>
                      · {picture.restyled ? "restyled" : "painted"} by {picture.paintedBy}
                    </span>
                  ) : null}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className={working ? "w-fit cursor-not-allowed opacity-60" : "w-fit"}
                  aria-disabled={working ? true : undefined}
                  onClick={() => choose(picture)}
                >
                  {working === picture.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Use this one
                  <span className="sr-only"> — {label}</span>
                </Button>
              </li>
            );
          })}
        </ul>

        <p className="text-xs leading-5 text-subtle">
          {REART_ROLLS_KEPT_COPY}
          {earlier.some((picture) => picture.earlierStyle) ? ` ${REART_EARLIER_STYLE_COPY}` : ""}
        </p>
        </div>

        <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col">
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={Boolean(working)}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One picture in a fixed box: art is wider than tall on most frames and
 *  taller on a few, so it is shown whole, never cropped. */
function Picture({ url, alt, small = false, onError }: { url: string | null; alt: string; small?: boolean; onError?: () => void }) {
  return (
    <div
      className={
        small
          ? "flex aspect-[4/3] w-1/2 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-elevated/40"
          : "flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md border border-border/60 bg-elevated/40"
      }
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- the maker's own stored art, shown whole
        <img src={url} alt={alt} loading="lazy" onError={onError} className="h-full w-full object-contain" />
      ) : (
        <span className="text-xs text-subtle">No art</span>
      )}
    </div>
  );
}
