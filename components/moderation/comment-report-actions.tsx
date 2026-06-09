"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  resolveCommentReportsAction,
  type CommentResolveAction,
} from "@/lib/moderation/actions";

export function CommentReportActions({ commentId }: { commentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function act(action: CommentResolveAction) {
    startTransition(async () => {
      const result = await resolveCommentReportsAction({ commentId, action });
      if (result.ok) {
        toast.success(
          action === "remove" ? "Comment removed." : "Reports dismissed.",
        );
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
        onClick={() => act("remove")}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden />
        )}
        Remove
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
