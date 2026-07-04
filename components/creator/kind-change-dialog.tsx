"use client";

import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type KindChangeDialogProps = {
  /** The confirm plan's user-facing message; null closes the dialog. */
  message: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

// Confirmation for a kind change the current era can't follow (Classic has no
// planeswalker frame, showcase frames aren't type-derived). Accept switches
// to the M15 equivalent; cancel changes NOTHING — the old silent fallback
// that rewrote the user's frame is gone.
export function KindChangeDialog({
  message,
  onConfirm,
  onCancel,
}: KindChangeDialogProps) {
  return (
    <Dialog open={message !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Switch frame era?</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="px-5 pb-5 pt-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Keep things as they are
          </Button>
          <Button type="button" variant="primary" onClick={onConfirm}>
            <ArrowRightLeft className="h-4 w-4" aria-hidden />
            Switch to M15
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
