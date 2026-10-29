"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { deleteDeckAction } from "@/lib/decks/actions";

// ---------------------------------------------------------------------------
// DeleteDeckDialog — the deck owner's destructive confirm, on the site's
// Radix Dialog like DeleteCardDialog (deck audit 2026-10-28, M11): a real
// focus trap, the focus back on the trigger when it closes, the page behind
// it inert and unscrollable. While the delete is in flight nothing closes
// it — not Escape, not a backdrop click, not the corner X.
// ---------------------------------------------------------------------------

type DeleteDeckDialogProps = {
  deckId: string;
  deckTitle: string;
  redirectTo?: string;
  triggerLabel?: string;
  triggerVariant?: "ghost" | "outline" | "secondary";
};

export function DeleteDeckDialog({
  deckId,
  deckTitle,
  redirectTo = "/dashboard/decks",
  triggerLabel = "Delete deck",
  triggerVariant = "outline",
}: DeleteDeckDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await deleteDeckAction(deckId);
      if (result.ok) {
        toast.success(`Deleted ${deckTitle}.`);
        setOpen(false);
        router.replace(redirectTo);
        router.refresh();
      } else {
        toast.error(result.formError ?? "Could not delete deck.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (isPending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant}>
          <Trash2 className="h-4 w-4" aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent size="sm" closeDisabled={isPending}>
        <DialogHeader>
          <DialogTitle>Delete this deck?</DialogTitle>
          <DialogDescription className="text-sm leading-6">
            <span className="font-mono text-foreground">{deckTitle}</span> will
            be permanently removed, along with its card list. Any custom cards
            you created for it remain in your library — only the deck and its
            entries are deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="px-5 pb-5 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={isPending}
            className="bg-danger text-foreground shadow-[0_4px_24px_-8px_var(--color-danger)] hover:brightness-110"
          >
            {isPending ? "Deleting…" : "Delete deck"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
