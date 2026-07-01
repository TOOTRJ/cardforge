"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type StartOverDialogProps = {
  /** Reset the form. Called after the user confirms. */
  onConfirm: () => void;
  /**
   * "create" wipes the form to a blank card (and drops the on-device draft).
   * "revert" discards unsaved edits and restores the last saved draft.
   */
  variant?: "create" | "revert";
};

// A small confirmation around "start over" so a stray click can't wipe a
// half-built card. Used in create mode (clears the blank draft) and while
// editing a private draft (reverts unsaved edits to the last save).
export function StartOverDialog({
  onConfirm,
  variant = "create",
}: StartOverDialogProps) {
  const [open, setOpen] = useState(false);
  const isRevert = variant === "revert";
  const label = isRevert ? "Reset" : "Start over";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <RotateCcw className="h-4 w-4" aria-hidden />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{isRevert ? "Reset changes?" : "Start over?"}</DialogTitle>
          <DialogDescription>
            {isRevert
              ? "This discards your unsaved edits and restores the card to its last saved state. This can’t be undone."
              : "This clears every field and resets the card to a blank slate. The draft saved on this device is discarded too. This can’t be undone."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="px-5 pb-5 pt-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
