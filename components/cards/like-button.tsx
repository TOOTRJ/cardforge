"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toggleLikeAction } from "@/lib/cards/likes";
import { cn } from "@/lib/utils";

type LikeButtonProps = {
  cardId: string;
  cardSlug?: string;
  initialLiked: boolean;
  initialCount: number;
  /** When true the user can't actually like (no session) → click sends to login. */
  requiresSignIn?: boolean;
  className?: string;
};

type LikeState = {
  liked: boolean;
  count: number;
};

export function LikeButton({
  cardId,
  cardSlug,
  initialLiked,
  initialCount,
  requiresSignIn = false,
  className,
}: LikeButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setOptimistic] = useOptimistic<LikeState, LikeState>(
    { liked: initialLiked, count: initialCount },
    (_prev, next) => next,
  );

  const handleClick = () => {
    if (requiresSignIn) {
      const next = cardSlug
        ? `/card/${cardSlug}`
        : typeof window !== "undefined"
          ? window.location.pathname
          : "/";
      router.push(`/login?redirectTo=${encodeURIComponent(next)}`);
      return;
    }

    const nextLiked = !state.liked;
    const nextCount = Math.max(0, state.count + (nextLiked ? 1 : -1));

    startTransition(async () => {
      setOptimistic({ liked: nextLiked, count: nextCount });
      const result = await toggleLikeAction(cardId, cardSlug);
      if (!result.ok) {
        toast.error(result.error);
        // Revert: re-set optimistic to the pre-click values.
        setOptimistic({ liked: !nextLiked, count: state.count });
        return;
      }
      // Reconcile with the server's authoritative count.
      setOptimistic({ liked: result.liked, count: result.likes_count });
    });
  };

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      variant={state.liked ? "primary" : "outline"}
      className={cn(
        "transition-colors",
        state.liked &&
          "bg-rose-500/20 text-rose-200 border-rose-500/40 hover:bg-rose-500/25",
        className,
      )}
      aria-pressed={state.liked}
      aria-label={state.liked ? "Unlike card" : "Like card"}
    >
      <Heart
        className={cn(
          "h-4 w-4 transition-colors",
          state.liked ? "fill-rose-300 text-rose-200" : "text-current",
        )}
        aria-hidden
      />
      <span>{state.count}</span>
    </Button>
  );
}
