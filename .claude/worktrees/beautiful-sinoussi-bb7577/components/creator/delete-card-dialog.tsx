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
import { deleteCardAction } from "@/lib/cards/actions";

type DeleteCardDialogProps = {
  cardId: string;
  cardTitle: string;
  redirectTo?: string;
  triggerLabel?: string;
  triggerVariant?: "ghost" | "outline" | "secondary";
};

export function DeleteCardDialog({
  cardId,
  cardTitle,
  redirectTo = "/dashboard",
  triggerLabel = "Delete card",
  triggerVariant = "outline",
}: DeleteCardDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await deleteCardAction(cardId);
      if (result.ok) {
        toast.success(`Deleted ${cardTitle}.`);
        setOpen(false);
        router.replace(redirectTo);
        router.refresh();
      } else {
        toast.error(result.formError ?? "Could not delete card.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant}>
          <Trash2 className="h-4 w-4" aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete this card?</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-foreground">{cardTitle}</span> will
            be permanently removed. This can&apos;t be undone.
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
            {isPending ? "Deleting…" : "Delete card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
