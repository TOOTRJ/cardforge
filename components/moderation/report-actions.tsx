"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  resolveCardReportsAction,
  type ResolveAction,
} from "@/lib/moderation/actions";

export function ReportActions({ cardId }: { cardId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function act(action: ResolveAction) {
    startTransition(async () => {
      const result = await resolveCardReportsAction({ cardId, action });
      if (result.ok) {
        toast.success(action === "hide" ? "Card hidden." : "Reports dismissed.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex shrink-0 flex-row gap-2 sm:flex-col">
      <Button
        variant="accent"
        size="sm"
        disabled={pending}
        onClick={() => act("hide")}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <EyeOff className="h-4 w-4" aria-hidden />
        )}
        Hide card
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => act("dismiss")}
      >
        <Check className="h-4 w-4" aria-hidden />
        Dismiss
      </Button>
    </div>
  );
}
