"use client";

import { useRouter } from "next/navigation";
import { GitFork } from "lucide-react";
import { Button } from "@/components/ui/button";

type RemixButtonProps = {
  cardId: string;
  /** When true (no session) the click sends them to /login first, landing
   *  back on the remix editor afterwards. */
  requiresSignIn?: boolean;
  /** "Remix" unless said: another creator's card that isn't public reads
   *  "Remix into a deck" — the way such a card reaches a deck (TODO DK9.4). */
  label?: string;
  className?: string;
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
}: RemixButtonProps) {
  const router = useRouter();
  const remixPath = `/create?remix=${cardId}`;

  const handleClick = () => {
    if (requiresSignIn) {
      router.push(`/login?redirectTo=${encodeURIComponent(remixPath)}`);
      return;
    }
    router.push(remixPath);
  };

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
