"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteAccountAction } from "@/lib/account/actions";

export function DeleteAccountDialog() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  const armed = confirm.trim().toUpperCase() === "DELETE";

  function submit() {
    if (!armed) return;
    startTransition(async () => {
      const result = await deleteAccountAction({ confirm });
      if (result.ok) {
        toast.success("Your account has been deleted.");
        // Full reload → middleware re-evaluates with the cleared session.
        window.location.href = "/";
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirm("");
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="border-danger/50 text-danger hover:bg-danger/10"
        >
          <Trash2 className="h-4 w-4" aria-hidden /> Delete account
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete your account</DialogTitle>
          <DialogDescription>
            This permanently deletes your account, profile, and every card, set,
            and comment you&apos;ve made. It can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 py-5">
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Want a copy first? Close this and use “Export your data” before
              deleting.
            </span>
          </div>
          <label
            htmlFor="delete-confirm"
            className="text-xs font-semibold uppercase tracking-wider text-subtle"
          >
            Type <span className="text-danger">DELETE</span> to confirm
          </label>
          <input
            id="delete-confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={pending}
            autoComplete="off"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50 disabled:opacity-50"
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={submit}
            disabled={!armed || pending}
            className="bg-danger text-white hover:brightness-110"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="h-4 w-4" aria-hidden />
            )}
            Delete forever
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
