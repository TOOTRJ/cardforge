"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";
import { GitFork } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RemixButtonProps = {
  cardId: string;
  /** When true (no session) the click sends them to /login first, landing
   *  back on the remix editor afterwards. */
  requiresSignIn?: boolean;
  /** "Remix" unless said: another creator's card that isn't public reads
   *  "Remix into a deck" — the way such a card reaches a deck (TODO DK9.4). */
  label?: string;
  className?: string;
  /** Why this card can't be remixed (a card moderation hid, migration
   *  0156 — owner decision 2026-10-30): the button is unavailable
   *  (aria-disabled, inert) and the reason is its description. */
  unavailableReason?: string;
};

/** "Remix" on a card page. Opens the creator in remix mode, prefilled from
 *  this card — NOTHING is saved until the user clicks Save there (owner
 *  decision 2026-09-16), so the remix's slug follows the title they pick and
 *  an abandoned remix leaves no orphan row behind. */
export function RemixButton({
  cardId,
  requiresSignIn = false,
  label = "Remix",
  className,
  unavailableReason,
}: RemixButtonProps) {
  const router = useRouter();
  const reasonId = useId();
  const remixPath = `/create?remix=${cardId}`;

  const handleClick = () => {
    if (requiresSignIn) {
      router.push(`/login?redirectTo=${encodeURIComponent(remixPath)}`);
      return;
    }
    router.push(remixPath);
  };

  if (unavailableReason) {
    return (
      <>
        <Button
          type="button"
          variant="secondary"
          aria-disabled="true"
          aria-describedby={reasonId}
          title={unavailableReason}
          className={cn("cursor-not-allowed opacity-60", className)}
        >
          <GitFork className="h-4 w-4" aria-hidden />
          {label}
        </Button>
        <span id={reasonId} className="sr-only">
          {unavailableReason}
        </span>
      </>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={handleClick}
      className={className}
    >
      <GitFork className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  );
}
