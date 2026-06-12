"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { toggleLikeAction } from "@/lib/cards/likes";
import { toggleSetLikeAction } from "@/lib/sets/likes";
import { hasSupabaseSessionCookie } from "@/lib/supabase/session-cookie";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// QuickLikeButton — compact heart+count toggle for use inside card/set tiles.
// Optimistic via useOptimistic; reverts on server error and reconciles to
// the authoritative count on success. Anonymous viewers are bounced to
// /login with a redirectTo back to the page they came from.
//
// Works with either a card or a set — pass the matching `kind` so the
// right server action is dispatched. The visual treatment is identical;
// only the underlying mutation differs.
// ---------------------------------------------------------------------------

type CommonProps = {
  initialLiked: boolean;
  initialCount: number;
  /** Server-render hint that the viewer looked anonymous. On cached /
   *  static pages this is ALWAYS true, so it's re-checked against the
   *  session cookie at click time — a signed-in user on a cached page
   *  still gets a working like instead of a bounce to /login. */
  requiresSignIn?: boolean;
  /** Used to construct the post-login redirectTo. */
  redirectAfterLogin?: string;
  className?: string;
  /** Optional aria label override (defaults to "Like this card"). */
  label?: string;
};

type CardLikeProps = CommonProps & {
  kind: "card";
  cardId: string;
  cardSlug?: string;
  ownerUsername?: string | null;
};

type SetLikeProps = CommonProps & {
  kind: "set";
  setId: string;
  setSlug?: string;
  ownerUsername?: string | null;
};

type QuickLikeButtonProps = CardLikeProps | SetLikeProps;

type State = { liked: boolean; count: number };

export function QuickLikeButton(props: QuickLikeButtonProps) {
  const {
    initialLiked,
    initialCount,
    requiresSignIn = false,
    redirectAfterLogin,
    className,
    label,
  } = props;

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setOptimistic] = useOptimistic<State, State>(
    { liked: initialLiked, count: initialCount },
    (_prev, next) => next,
  );

  const handleClick = (e: React.MouseEvent) => {
    // Tile parents sometimes wrap the heart in a Link to the card detail;
    // we don't want clicking the heart to navigate.
    e.preventDefault();
    e.stopPropagation();

    // The hint only ever PROMOTES: anonymous-rendered page + session
    // cookie present → attempt the action (the server action is the real
    // validator). Without a cookie, bounce to login as before.
    if (requiresSignIn && !hasSupabaseSessionCookie()) {
      const next =
        redirectAfterLogin ??
        (typeof window !== "undefined" ? window.location.pathname : "/");
      router.push(`/login?redirectTo=${encodeURIComponent(next)}`);
      return;
    }

    const nextLiked = !state.liked;
    const nextCount = Math.max(0, state.count + (nextLiked ? 1 : -1));

    startTransition(async () => {
      setOptimistic({ liked: nextLiked, count: nextCount });
      const result =
        props.kind === "card"
          ? await toggleLikeAction(
              props.cardId,
              props.cardSlug,
              props.ownerUsername,
            )
          : await toggleSetLikeAction(
              props.setId,
              props.setSlug,
              props.ownerUsername,
            );
      if (!result.ok) {
        toast.error(result.error);
        setOptimistic({ liked: !nextLiked, count: state.count });
        return;
      }
      setOptimistic({ liked: result.liked, count: result.likes_count });
    });
  };

  const ariaLabel =
    label ??
    (state.liked
      ? `Unlike (${state.count})`
      : `Like (${state.count})`);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={state.liked}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
        state.liked
          ? "text-rose-300 hover:text-rose-200"
          : "text-muted hover:text-foreground",
        isPending && "opacity-70",
        className,
      )}
    >
      <Heart
        className={cn(
          "h-3.5 w-3.5 transition-colors",
          state.liked && "fill-rose-400 text-rose-300",
        )}
        aria-hidden
      />
      <span>{state.count}</span>
    </button>
  );
}
