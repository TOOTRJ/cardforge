"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitFork, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { remixCardAction } from "@/lib/cards/actions";

type RemixButtonProps = {
  cardId: string;
  cardSlug: string;
  /** Owner of the card; when set, sign-in redirectTo lands on the canonical
   *  `/card/[username]/[slug]` instead of bouncing through the legacy redirector. */
  ownerUsername?: string | null;
  /** When true (no session) the click sends them to /login first. */
  requiresSignIn?: boolean;
  className?: string;
};

export function RemixButton({
  cardId,
  cardSlug,
  ownerUsername,
  requiresSignIn = false,
  className,
}: RemixButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    if (requiresSignIn) {
      const next = ownerUsername
        ? `/card/${ownerUsername}/${cardSlug}`
        : `/card/${cardSlug}`;
      router.push(`/login?redirectTo=${encodeURIComponent(next)}`);
      return;
    }

    startTransition(async () => {
      const result = await remixCardAction({ parentCardId: cardId });
      if (!result.ok) {
        if (result.formError) {
          toast.error(result.formError);
        } else if (result.fieldErrors) {
          toast.error(
            Object.values(result.fieldErrors)[0] ?? "Could not remix this card.",
          );
        }
        return;
      }
      toast.success("Remix created — opening in the editor.");
      router.push(`/card/${result.slug}/edit`);
    });
  };

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={handleClick}
      disabled={isPending}
      className={className}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <GitFork className="h-4 w-4" aria-hidden />
      )}
      {isPending ? "Remixing…" : "Remix"}
    </Button>
  );
}
