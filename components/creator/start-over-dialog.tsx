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
  /** Wipe the form back to a blank card. Called after the user confirms. */
  onConfirm: () => void;
};

// A small confirmation around "start over" so a stray click can't wipe a
// half-built card. Create-mode only (the draft is what gets cleared); edit
// mode keeps the server copy and uses Delete instead.
export function StartOverDialog({ onConfirm }: StartOverDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <RotateCcw className="h-4 w-4" aria-hidden />
          Start over
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Start over?</DialogTitle>
          <DialogDescription>
            This clears every field and resets the card to a blank slate. The
            draft saved on this device is discarded too. This can&apos;t be
            undone.
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
            Start over
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
