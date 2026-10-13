"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SecondPartLoss } from "@/lib/creator/second-part-loss";

type SecondPartLossDialogProps = {
  /** What the change of card type would remove; null closes the dialog. */
  loss: SecondPartLoss | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** Where the focus goes when the dialog closes: the chip that opened it.
   *  (The dialog has no trigger of its own — it is opened by the form — and
   *  without this the focus would be dropped on the page's body.) */
  returnFocusTo?: () => HTMLElement | null;
};

// Asked before a change of card type throws a card's second part away (TODO
// 5.14, quick fix 1): Transform → Creature used to empty the back face —
// its name, rules, stats and artwork — without a word. Only shown when the
// part holds something the maker wrote (describeSecondPartLoss). Cancel is
// the default: it takes the focus when the dialog opens, Esc and a click
// outside mean Cancel, and Cancel changes NOTHING (the kind chip snaps back,
// since the kind derives from the untouched form). The dialog traps the
// focus (Radix) and hands it back to the chip that opened it — after a
// confirm, to the bar of the section that folded shut around that chip.
export function SecondPartLossDialog({ loss, onConfirm, onCancel, returnFocusTo }: SecondPartLossDialogProps) {
  return (
    <Dialog open={loss !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        size="sm"
        data-testid="second-part-loss-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLButtonElement>("[data-default-action]")
            ?.focus();
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusTo?.();
          if (!target) return;
          event.preventDefault();
          target.focus();
          // After a CONFIRM the Card type section folds shut around the
          // chips (as after any pick), and a chip inside a closed fold
          // cannot take the focus — it fell on the page's body. The fold's
          // own bar is the nearest thing that can.
          if (document.activeElement !== target) {
            target.closest("details:not([open])")?.querySelector<HTMLElement>("summary")?.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{loss?.title}</DialogTitle>
          <DialogDescription>{loss?.message}</DialogDescription>
        </DialogHeader>
        <p className="px-5 py-3 text-xs leading-5 text-muted">{loss?.restoreNote}</p>
        <DialogFooter className="px-5 pb-5 pt-2">
          <Button type="button" variant="ghost" data-default-action onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={onConfirm}>
            <Trash2 className="h-4 w-4" aria-hidden />
            {loss?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
