"use client";

import { useState } from "react";
import { Layers, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import { cn } from "@/lib/utils";
import type { Card } from "@/types/card";

type BackFacePickerProps = {
  /** The user's own cards, eligible to be a back face (self excluded upstream). */
  myCards: Card[];
  /** Current back_card_id ("" = none). */
  value: string;
  /** Set (a card id) or clear (""). */
  onChange: (backCardId: string) => void;
  /** Save the current card + open a fresh creator whose result links back. */
  onCreateNew: () => void;
};

// Publish-step control for the v2 back face: the back is a full, separate card
// the user owns, so it's fully customisable. Pick one of your cards, or create
// a new one to be the back.
export function BackFacePicker({
  myCards,
  value,
  onChange,
  onCreateNew,
}: BackFacePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? myCards.find((c) => c.id === value) ?? null : null;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        Back face
      </span>

      {selected ? (
        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-elevated/40 p-3">
          <div className="w-14 shrink-0">
            <BakedCardThumbnail
              renderedImageUrl={selected.rendered_image_url}
              title={selected.title}
              previewData={cardToPreviewData(selected)}
              sizes="56px"
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {selected.title}
            </span>
            <span className="truncate text-[11px] capitalize text-muted">
              {[selected.rarity, selected.card_type]
                .filter(Boolean)
                .join(" · ") || "Back face"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(true)}
            >
              Change
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange("")}
            >
              <X className="h-4 w-4" aria-hidden />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(true)}
            className="w-fit"
          >
            <Layers className="h-4 w-4" aria-hidden />
            Add a back face
          </Button>
          <span className="text-[11px] text-muted">
            Make this a double-faced card. The back is a full, separate card —
            its own colour, frame, and art.
          </span>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg" className="min-h-0">
          <DialogHeader>
            <DialogTitle>Choose a back face</DialogTitle>
            <DialogDescription>
              Pick one of your cards to become the back, or create a new one.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-col gap-4 px-5 pb-5">
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setOpen(false);
                onCreateNew();
              }}
              className="w-fit"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Create a new card
            </Button>

            {myCards.length === 0 ? (
              <p className="rounded-md border border-border/50 bg-elevated/30 px-4 py-6 text-center text-sm text-muted">
                You don&apos;t have any other cards yet. Create one to use as the
                back face.
              </p>
            ) : (
              <div className="grid max-h-[55vh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
                {myCards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => {
                      onChange(card.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "group flex flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                      card.id === value
                        ? "border-primary bg-primary/10"
                        : "border-border/50 hover:border-border-strong hover:bg-elevated/60",
                    )}
                  >
                    <BakedCardThumbnail
                      renderedImageUrl={card.rendered_image_url}
                      title={card.title}
                      previewData={cardToPreviewData(card)}
                      sizes="180px"
                    />
                    <span className="truncate px-0.5 text-xs text-foreground">
                      {card.title}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
