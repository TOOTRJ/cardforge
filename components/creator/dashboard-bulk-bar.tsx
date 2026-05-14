"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  FolderPlus,
  Globe2,
  Link2,
  Loader2,
  Lock,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QuickAddToSetDialog } from "@/components/sets/quick-add-to-set-dialog";
import {
  deleteCardsAction,
  updateCardsVisibilityAction,
} from "@/lib/cards/actions";
import type { Visibility } from "@/types/card";

// ---------------------------------------------------------------------------
// DashboardBulkBar — sticky bottom bar shown when ≥1 card is selected.
// Renders three bulk actions: change visibility, add to set, delete.
// All three call into server actions that pre-flight ownership and
// abort the whole batch on any cross-user attempt.
// ---------------------------------------------------------------------------

type DashboardBulkBarProps = {
  selectedIds: string[];
  onClear: () => void;
  /** Sets the user owns — passed in so the picker dialog avoids a
   *  client-side fetch on every render. */
  userSets: Array<{ id: string; title: string; slug: string }>;
  /** Called when an action completes successfully — the parent uses this
   *  to clear selection + refresh the route. */
  onSuccess: () => void;
};

export function DashboardBulkBar({
  selectedIds,
  onClear,
  userSets,
  onSuccess,
}: DashboardBulkBarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [setPickerOpen, setSetPickerOpen] = useState(false);

  const count = selectedIds.length;

  const handleVisibility = (visibility: Visibility) => {
    startTransition(async () => {
      const result = await updateCardsVisibilityAction(selectedIds, visibility);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${result.count} card${result.count === 1 ? "" : "s"} → ${visibility}.`,
      );
      onSuccess();
      router.refresh();
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteCardsAction(selectedIds);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Deleted ${result.count} card${result.count === 1 ? "" : "s"}.`,
      );
      setDeleteOpen(false);
      onSuccess();
      router.refresh();
    });
  };

  return (
    <>
      {/* Sticky at the bottom of the viewport. z-40 keeps it above the
          card grid + the foil shimmer overlay but below modals (z-50). */}
      <div
        role="region"
        aria-label={`${count} cards selected`}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-surface/95 px-4 py-3 backdrop-blur-md sm:px-6"
      >
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="font-display text-sm font-semibold text-foreground">
              {count} selected
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              disabled={isPending}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear
            </Button>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleVisibility("private")}
              disabled={isPending}
            >
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Make private
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleVisibility("unlisted")}
              disabled={isPending}
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              Make unlisted
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleVisibility("public")}
              disabled={isPending}
            >
              <Globe2 className="h-3.5 w-3.5" aria-hidden />
              Make public
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSetPickerOpen(true)}
              disabled={isPending}
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden />
              Add to set
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              disabled={isPending}
              className="border-danger/50 text-danger hover:bg-danger/10"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Delete
            </Button>
            {isPending ? (
              <Loader2
                className="ml-1 h-4 w-4 animate-spin text-muted"
                aria-hidden
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog. */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              Delete {count} card{count === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              This can&apos;t be undone. The cards will be removed from your
              dashboard, the gallery, and any sets they belong to.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-5 pb-5 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleDelete}
              disabled={isPending}
              className="bg-danger text-foreground shadow-[0_4px_24px_-8px_var(--color-danger)] hover:brightness-110"
            >
              {isPending ? "Deleting…" : `Delete ${count}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add-to-set picker dialog. */}
      <QuickAddToSetDialog
        open={setPickerOpen}
        onOpenChange={setSetPickerOpen}
        cardIds={selectedIds}
        userSets={userSets}
        onSuccess={() => {
          setSetPickerOpen(false);
          onSuccess();
          router.refresh();
        }}
      />
    </>
  );
}
