"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  pauseAutoRebakeAction,
  resumeAutoRebakeAction,
  retryPoisonedCardsAction,
  type AutoRebakeActionResult,
} from "@/lib/cards/auto-rebake-actions";

// ---------------------------------------------------------------------------
// The buttons on /admin/renders. The actions check is_admin themselves; this
// only runs them, toasts the outcome and refreshes the server-rendered panel.
// ---------------------------------------------------------------------------

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<AutoRebakeActionResult>, success: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(success);
      router.refresh();
    });
  return { pending, run };
}

export function AutoRebakeToggle({ paused }: { paused: boolean }) {
  const { pending, run } = useAction();
  return paused ? (
    <Button
      size="sm"
      disabled={pending}
      onClick={() => run(resumeAutoRebakeAction, "Automatic re-bake resumed — the next run starts within 10 minutes.")}
      data-testid="auto-rebake-resume"
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
      Resume
    </Button>
  ) : (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => run(pauseAutoRebakeAction, "Automatic re-bake paused.")}
      data-testid="auto-rebake-pause"
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Pause aria-hidden />}
      Pause
    </Button>
  );
}

export function RetryPoisonedButton({ count }: { count: number }) {
  const { pending, run } = useAction();
  if (count === 0) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        run(
          retryPoisonedCardsAction,
          `${count} card${count === 1 ? "" : "s"} will be retried once in the next run.`,
        )
      }
      data-testid="auto-rebake-retry"
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
      Retry {count === 1 ? "this card" : "these cards"}
    </Button>
  );
}
