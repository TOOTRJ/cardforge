"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteCardAction } from "@/lib/cards/actions";
import { cn } from "@/lib/utils";

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
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape; trap focus minimally inside the dialog while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

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
    <>
      <Button
        type="button"
        variant={triggerVariant}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        {triggerLabel}
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            aria-hidden
          />
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-card-title"
            aria-describedby="delete-card-desc"
            className={cn(
              "relative z-10 w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl",
              "focus-visible:outline-none",
            )}
          >
            <button
              type="button"
              aria-label="Close"
              className="absolute right-3 top-3 rounded-md p-1 text-muted transition-colors hover:bg-elevated hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>

            <h2
              id="delete-card-title"
              className="font-display text-xl font-semibold tracking-tight text-foreground"
            >
              Delete this card?
            </h2>
            <p
              id="delete-card-desc"
              className="mt-2 text-sm leading-6 text-muted"
            >
              <span className="font-mono text-foreground">{cardTitle}</span>{" "}
              will be permanently removed. This can&apos;t be undone.
            </p>

            <div className="mt-6 flex items-center justify-end gap-2">
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
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
