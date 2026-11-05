"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SIGNUP_CREDITS } from "@/lib/billing/plans";
import { guestAuthHref } from "@/lib/creator/guest-draft";
import type { GuestPictureUploads } from "@/components/creator/use-guest-draft";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The guest creator's two pieces of chrome (TODO HM3): the dialog a
// signed-out visitor's Save (or an AI button) opens — an account saves the
// card, and the card waits in this browser meanwhile — and the note a
// restored card shows above the steps.
// ---------------------------------------------------------------------------

export type GuestSaveGateReason = "save" | "ai";

/** Why Save waits for a restored card's picture (the save bar's line). */
export const GUEST_PICTURE_UPLOADING_REASON = "Your picture is uploading to your account…";
export const GUEST_PICTURE_FAILED_REASON =
  "A picture didn't upload — retry it at the top of the creator, or choose another.";

export function GuestSaveGate({
  reason,
  onOpenChange,
}: {
  reason: GuestSaveGateReason | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={reason !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="guest-save-gate">
        <DialogHeader>
          <DialogTitle>
            {reason === "ai" ? "AI needs a free account" : "Save your card to a free account"}
          </DialogTitle>
          <DialogDescription>
            {reason === "ai"
              ? `AI writing and painting run on credits, and a new account starts with ${SIGNUP_CREDITS}. Your card waits in this browser while you sign up.`
              : "Your card waits in this browser while you sign up — it comes back in the creator, ready to save, publish and share from any device."}
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 py-4">
          <p className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary-bright" aria-hidden />
            <span>
              Free forever, with {SIGNUP_CREDITS} AI credits to start. Open the confirmation email in this
              browser to pick up where you left off.
            </span>
          </p>
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button asChild>
            <Link href={guestAuthHref("signup")} data-no-guard>
              Create a free account
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={guestAuthHref("login")} data-no-guard>
              Sign in
            </Link>
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Keep editing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GuestDraftRestoredNotice({
  signedIn,
  uploads,
  onRetry,
  className,
}: {
  signedIn: boolean;
  uploads: GuestPictureUploads;
  onRetry: () => void;
  className?: string;
}) {
  // The card is what the maker came back for: where the note is out of
  // sight (a phone, under the start options), bring it into view once.
  const note = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = note.current;
    if (!el || typeof el.scrollIntoView !== "function") return;
    const { top, bottom } = el.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) el.scrollIntoView({ block: "center" });
  }, []);
  return (
    <div
      ref={note}
      role="status"
      data-testid="guest-draft-restored"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-frame border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-foreground",
        className,
      )}
    >
      <p className="min-w-0 flex-1">
        {signedIn ? (
          <>
            <span className="font-semibold text-accent">Your card is back.</span>{" "}
            It&apos;s the one you
            started before signing in — check it over and press Save to keep it.
          </>
        ) : (
          <>
            <span className="font-semibold text-accent">Welcome back.</span>{" "}
            Your card was kept in this
            browser — carry on, and sign up when you save.
          </>
        )}
      </p>
      {uploads === "uploading" ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Uploading your picture…
        </span>
      ) : uploads === "failed" ? (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          Retry the upload
        </Button>
      ) : null}
    </div>
  );
}
