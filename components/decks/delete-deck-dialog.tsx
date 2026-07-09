"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteDeckAction } from "@/lib/decks/actions";
import { cn } from "@/lib/utils";

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
  const dialogRef = useRef<HTMLDivElement | null>(null);

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
            aria-labelledby="delete-deck-title"
            aria-describedby="delete-deck-desc"
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
              id="delete-deck-title"
              className="font-display text-xl font-semibold tracking-tight text-foreground"
            >
              Delete this deck?
            </h2>
            <p
              id="delete-deck-desc"
              className="mt-2 text-sm leading-6 text-muted"
            >
              <span className="font-mono text-foreground">{deckTitle}</span>{" "}
              will be permanently removed, along with its card list. Any custom
              cards you created for it remain in your library — only the deck
              and its entries are deleted.
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
                {isPending ? "Deleting…" : "Delete deck"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
