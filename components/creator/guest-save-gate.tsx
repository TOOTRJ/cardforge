"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, RotateCcw, Sparkles } from "lucide-react";
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
import type {
  GuestCardKept,
  GuestPictureUploads,
} from "@/components/creator/use-guest-draft";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The guest creator's two pieces of chrome (TODO HM3): the dialog a
// signed-out visitor's Save (or an AI button) opens — an account saves the
// card, and the card waits in this browser meanwhile — and the note a
// restored card shows above the steps.
// ---------------------------------------------------------------------------

export type GuestSaveGateReason =
  "save" | "ai" | "import" | "real-card-art" | "set-icon" | "pips";

/** What the dialog says for each way in: why it needs an account, before
 *  the line on whether the card waits (`keptLine`). */
const GATE_COPY: Record<
  GuestSaveGateReason,
  { title: string; lead: string | null }
> = {
  save: { title: "Save your card to a free account", lead: null },
  ai: {
    title: "AI needs a free account",
    lead: `AI writing and painting run on credits, and a new account starts with ${SIGNUP_CREDITS}.`,
  },
  import: {
    title: "Importing real cards needs a free account",
    lead: "Search Scryfall and start from any real card once you're signed in.",
  },
  "real-card-art": {
    title: "Real-card art needs a free account",
    lead: "Use the artwork of any real card once you're signed in.",
  },
  "set-icon": {
    title: "Set icon uploads need a free account",
    lead: "Your icon is stored with your account; the preset symbols work without one.",
  },
  pips: {
    title: "Custom pips need a free account",
    lead: "Custom pips are kept with your account and used on all your cards.",
  },
};

/** Whether the card waits in this browser — honest when it doesn't. */
function keptLine(reason: GuestSaveGateReason, kept: GuestCardKept): string {
  switch (kept) {
    case "not-here":
      return "Another tab has taken over this card, so what's here won't be kept. Sign up and save it from that tab, or copy what you need first.";
    case "not-kept":
      return "This browser won't keep the card (private browsing or blocked site data), so copy what you need before you sign up.";
    case "values-only":
      return "Your card waits in this browser while you sign up, but its pictures couldn't be kept — add them again once you're signed in.";
    default:
      return reason === "save"
        ? "Your card waits in this browser while you sign up — it comes back in the creator, ready to save. Then publish and share it from any device."
        : "Your card waits in this browser while you sign up.";
  }
}

/** Why Save waits for a restored card's picture (the save bar's line). */
export const GUEST_PICTURE_UPLOADING_REASON =
  "Your picture is uploading to your account…";
export const GUEST_PICTURE_FAILED_REASON =
  "A picture didn't upload — retry it at the top of the creator, or choose another.";

export function GuestSaveGate({
  reason,
  kept,
  onOpenChange,
}: {
  reason: GuestSaveGateReason | null;
  /** What writing the card just now did (use-guest-draft's flush). */
  kept: GuestCardKept;
  onOpenChange: (open: boolean) => void;
}) {
  const copy = GATE_COPY[reason ?? "save"];
  const waits = kept === "kept" || kept === "values-only";
  return (
    <Dialog open={reason !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="guest-save-gate">
        <DialogHeader>
          <DialogTitle className="pr-8">{copy.title}</DialogTitle>
          <DialogDescription>
            {[copy.lead, keptLine(reason ?? "save", kept)]
              .filter(Boolean)
              .join(" ")}
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 py-4">
          <p className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">
            <Sparkles
              className="mt-0.5 h-4 w-4 shrink-0 text-primary-bright"
              aria-hidden
            />
            <span>
              Free forever, with {SIGNUP_CREDITS} AI credits to start.
              {waits
                ? " Open the confirmation email in this browser to pick up where you left off."
                : null}
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
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
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
  // Drawn inside the creator's status region, which is mounted empty before
  // the card comes back (a region born with its text is read by no screen
  // reader). The card is what the maker came back for: where the note is
  // out of sight (a phone, under the start options), bring it into view once.
  const note = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = note.current;
    if (!el || typeof el.scrollIntoView !== "function") return;
    const { top, bottom } = el.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight)
      el.scrollIntoView({ block: "center" });
  }, []);
  return (
    <div
      ref={note}
      data-testid="guest-draft-restored"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-frame border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-foreground",
        className,
      )}
    >
      <p className="min-w-0 flex-1">
        {signedIn ? (
          <>
            <span className="font-semibold text-accent">
              Your card is back.
            </span>{" "}
            It&apos;s the one you started before signing in — check it over and
            press Save to keep it.
          </>
        ) : (
          <>
            <span className="font-semibold text-accent">Welcome back.</span>{" "}
            Your card was kept in this browser — carry on, and sign up when you
            save.
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

/** The guest creator's line when another tab has taken over its card: what
 *  is typed here is no longer kept. */
export function GuestCardStaleNote({ className }: { className?: string }) {
  return (
    <p
      data-testid="guest-card-stale"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-gold/50 bg-gold/10 px-4 py-3 text-sm text-foreground",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        Another tab has taken over this card, so changes made here won&apos;t be
        kept in this browser.
      </span>
    </p>
  );
}
