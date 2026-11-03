"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
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
import { cloneDeckAction } from "@/lib/decks/clone-actions";
import { cloneTitleOf } from "@/lib/decks/clone";

// ---------------------------------------------------------------------------
// "Copy deck" (TODO DK5.16) — on the deck page's hero strip, for anyone who
// can open the deck. A signed-out visitor goes to sign in and comes back;
// a signed-in one confirms (the site's Radix Dialog: focus trapped, back on
// the trigger when it closes, nothing closes it while the copy is made) and
// lands on their PRIVATE copy, credited "Remixed from …".
// ---------------------------------------------------------------------------

export function CloneDeckButton({
  deckId,
  deckSlug,
  deckTitle,
  signedIn,
  isOwner,
  className,
}: {
  deckId: string;
  deckSlug: string;
  deckTitle: string;
  signedIn: boolean;
  /** The owner's own deck: "Duplicate", the same copy. */
  isOwner: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const label = isOwner ? "Duplicate" : "Copy deck";

  if (!signedIn) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        onClick={() => router.push(`/login?redirectTo=${encodeURIComponent(`/deck/${deckSlug}`)}`)}
      >
        <Copy className="h-4 w-4" aria-hidden />
        {label}
      </Button>
    );
  }

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await cloneDeckAction(deckId);
      if (!result.ok) {
        if (result.code === "AUTH_REQUIRED") {
          router.push(`/login?redirectTo=${encodeURIComponent(`/deck/${deckSlug}`)}`);
          return;
        }
        toast.error(result.formError);
        return;
      }
      toast.success(result.notice);
      setOpen(false);
      router.push(`/deck/${result.slug}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (isPending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={className}>
          <Copy className="h-4 w-4" aria-hidden />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent size="sm" closeDisabled={isPending}>
        <DialogHeader>
          <DialogTitle>{isOwner ? "Duplicate this deck?" : "Copy this deck to your decks?"}</DialogTitle>
          <DialogDescription className="text-sm leading-6">
            You&apos;ll get <span className="font-medium text-foreground">{cloneTitleOf(deckTitle)}</span>, a private
            deck with the same cards
            {isOwner ? "" : ", credited “remixed from” this one"}. Cards you can&apos;t add to a deck — someone
            else&apos;s private or unlisted card, or one that&apos;s no longer available — are left out. No card is made, so your
            saved-card count doesn&apos;t change.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="px-5 pb-5 pt-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleConfirm} disabled={isPending}>
            {isPending ? "Copying…" : isOwner ? "Duplicate deck" : "Copy deck"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
