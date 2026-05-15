"use client";

import { useEffect, useState, useTransition } from "react";
import { FolderPlus, Loader2, Plus } from "lucide-react";
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
import { addCardsToSetAction, createSetAction } from "@/lib/sets/actions";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// QuickAddToSetDialog — pick an existing set (or create a new one inline)
// to add the bulk-selected cards to. Used by the dashboard's bulk-action
// bar.
//
// The "+ New set" inline creation flow keeps the dialog open and minimal:
//   - type a title
//   - click Create + add
//   - the new set is created with default visibility "private"
//   - the cards are added in a follow-up call
//
// We intentionally don't expose cover_url / description / visibility for
// inline creation — those need the full set editor. The user can always
// promote the set later from /set/[slug]/edit.
// ---------------------------------------------------------------------------

type QuickAddToSetDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  cardIds: string[];
  userSets: Array<{ id: string; title: string; slug: string }>;
  onSuccess: () => void;
};

type Mode = "existing" | "new";

export function QuickAddToSetDialog({
  open,
  onOpenChange,
  cardIds,
  userSets,
  onSuccess,
}: QuickAddToSetDialogProps) {
  const [mode, setMode] = useState<Mode>(
    userSets.length > 0 ? "existing" : "new",
  );
  const [selectedSetId, setSelectedSetId] = useState<string | null>(
    userSets[0]?.id ?? null,
  );
  const [newTitle, setNewTitle] = useState("");
  const [isPending, startTransition] = useTransition();

  // Reset internal state every open so a previous session's selection
  // doesn't leak into a new bulk action. Deferred via setTimeout to
  // satisfy the react-hooks/set-state-in-effect rule — the resets fire
  // in the next microtask rather than synchronously inside the effect.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setMode(userSets.length > 0 ? "existing" : "new");
      setSelectedSetId(userSets[0]?.id ?? null);
      setNewTitle("");
    }, 0);
    return () => clearTimeout(timer);
  }, [open, userSets]);

  const count = cardIds.length;
  const trimmedTitle = newTitle.trim();
  const submitDisabled =
    isPending ||
    count === 0 ||
    (mode === "existing" && !selectedSetId) ||
    (mode === "new" && trimmedTitle.length === 0);

  const handleSubmit = () => {
    startTransition(async () => {
      let targetSetId = selectedSetId;
      let targetSetTitle =
        userSets.find((s) => s.id === selectedSetId)?.title ?? "set";

      if (mode === "new") {
        const created = await createSetAction({
          title: trimmedTitle,
          visibility: "private",
        });
        if (!created.ok) {
          toast.error(created.formError ?? "Could not create set.");
          return;
        }
        targetSetId = created.setId;
        targetSetTitle = trimmedTitle;
      }

      if (!targetSetId) {
        toast.error("No set selected.");
        return;
      }

      const result = await addCardsToSetAction(targetSetId, cardIds);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const addedMsg =
        result.added > 0
          ? `Added ${result.added} card${result.added === 1 ? "" : "s"} to ${targetSetTitle}.`
          : `All ${count} card${count === 1 ? " was" : "s were"} already in ${targetSetTitle}.`;
      const skippedSuffix =
        result.skipped > 0 && result.added > 0
          ? ` (${result.skipped} already there)`
          : "";
      toast.success(addedMsg + skippedSuffix);
      onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            Add {count} card{count === 1 ? "" : "s"} to a set
          </DialogTitle>
          <DialogDescription>
            Pick one of your sets — or create a new private set right here.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-5 py-4">
          {/* Mode toggle */}
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-elevated/40 p-1">
            <button
              type="button"
              onClick={() => setMode("existing")}
              disabled={userSets.length === 0}
              className={cn(
                "flex-1 rounded-sm px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                mode === "existing"
                  ? "bg-surface text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                  : "text-subtle hover:text-foreground",
              )}
            >
              Existing set
            </button>
            <button
              type="button"
              onClick={() => setMode("new")}
              className={cn(
                "flex-1 rounded-sm px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
                mode === "new"
                  ? "bg-surface text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                  : "text-subtle hover:text-foreground",
              )}
            >
              + New set
            </button>
          </div>

          {mode === "existing" ? (
            userSets.length === 0 ? (
              <p className="text-xs text-subtle">
                You don&apos;t have any sets yet. Switch to{" "}
                <span className="font-medium text-foreground">+ New set</span>{" "}
                to create one.
              </p>
            ) : (
              <div className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto">
                {userSets.map((set) => {
                  const active = selectedSetId === set.id;
                  return (
                    <button
                      key={set.id}
                      type="button"
                      onClick={() => setSelectedSetId(set.id)}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border/60 bg-background/40 text-muted hover:border-border-strong hover:text-foreground",
                      )}
                      aria-pressed={active}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <FolderPlus
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            active ? "text-primary" : "text-subtle",
                          )}
                          aria-hidden
                        />
                        <span className="truncate text-sm">{set.title}</span>
                      </span>
                      <span className="shrink-0 text-[11px] uppercase tracking-wider text-subtle">
                        /set/{set.slug}
                      </span>
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
                New set title
              </span>
              <input
                type="text"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Embercoast Saga"
                autoFocus
                className="h-10 w-full rounded-md border border-border bg-background/60 px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                disabled={isPending}
              />
              <span className="text-[11px] text-subtle">
                Defaults to private. Edit visibility + cover later from the
                set editor.
              </span>
            </label>
          )}
        </div>

        <DialogFooter className="px-5 pb-5 pt-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleSubmit}
            disabled={submitDisabled}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Working…
              </>
            ) : mode === "new" ? (
              <>
                <Plus className="h-4 w-4" aria-hidden />
                Create + add {count}
              </>
            ) : (
              <>
                <FolderPlus className="h-4 w-4" aria-hidden />
                Add {count}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
