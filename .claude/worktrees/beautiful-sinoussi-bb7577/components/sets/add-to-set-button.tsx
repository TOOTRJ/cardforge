"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Layers, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  addCurrentCardToSetAction,
  removeCardFromSetAction,
} from "@/lib/sets/actions";
import { cn } from "@/lib/utils";

type SetOption = {
  id: string;
  slug: string;
  title: string;
  cards_count: number;
  contains_card: boolean;
};

type AddToSetButtonProps = {
  cardId: string;
  cardSlug: string;
  sets: SetOption[];
};

export function AddToSetButton({ cardId, cardSlug, sets }: AddToSetButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [pendingSetId, setPendingSetId] = useState<string | null>(null);
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

  const totalContaining = sets.filter((s) => s.contains_card).length;

  const handleToggle = (set: SetOption) => {
    setPendingSetId(set.id);
    startTransition(async () => {
      const result = set.contains_card
        ? await removeCardFromSetAction(set.id, cardId)
        : await addCurrentCardToSetAction(cardSlug, set.id, cardId);
      if (!result.ok) {
        toast.error(result.formError ?? "Could not update the set.");
      } else {
        toast.success(
          set.contains_card
            ? `Removed from “${set.title}”`
            : `Added to “${set.title}”`,
        );
        router.refresh();
      }
      setPendingSetId(null);
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <Layers className="h-4 w-4" aria-hidden />
        {totalContaining > 0
          ? `In ${totalContaining} set${totalContaining === 1 ? "" : "s"}`
          : "Add to set"}
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
            aria-labelledby="add-to-set-title"
            className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl focus-visible:outline-none"
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
              id="add-to-set-title"
              className="font-display text-xl font-semibold tracking-tight text-foreground"
            >
              Add to a set
            </h2>
            <p className="mt-1 text-sm text-muted">
              Pick one of your sets to include this card. Toggle to remove.
            </p>

            <div className="mt-5 flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
              {sets.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/60 bg-background/40 p-4 text-center text-sm text-muted">
                  You don&apos;t have any sets yet.{" "}
                  <Link
                    href="/sets/new"
                    className="font-medium text-primary hover:underline"
                  >
                    Create one
                  </Link>{" "}
                  and come back.
                </div>
              ) : (
                sets.map((set) => {
                  const isBusy = isPending && pendingSetId === set.id;
                  return (
                    <button
                      key={set.id}
                      type="button"
                      onClick={() => handleToggle(set)}
                      disabled={isBusy}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                        set.contains_card
                          ? "border-primary/60 bg-primary/10"
                          : "border-border bg-background/40 hover:border-border-strong",
                        isBusy && "opacity-70",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">
                          {set.title}
                        </span>
                        <span className="truncate text-xs text-muted">
                          /{set.slug} · {set.cards_count} card
                          {set.cards_count === 1 ? "" : "s"}
                        </span>
                      </div>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-elevated">
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : set.contains_card ? (
                          <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                        ) : (
                          <Plus className="h-3.5 w-3.5 text-muted" aria-hidden />
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="mt-5 flex items-center justify-between gap-2 border-t border-border/50 pt-4">
              <Link
                href="/sets/new"
                className="text-xs text-muted transition-colors hover:text-foreground"
              >
                + Create a new set
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
