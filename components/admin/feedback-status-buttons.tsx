"use client";

// Admin inbox status control — one-click transitions with optimistic-free
// simplicity (revalidatePath refreshes the list after the action).

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setFeedbackStatusAction } from "@/lib/feedback/actions";
import { FEEDBACK_STATUSES, type FeedbackStatus } from "@/lib/feedback/schemas";

const LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  resolved: "Resolved",
};

export function FeedbackStatusButtons({
  feedbackId,
  status,
}: {
  feedbackId: string;
  status: FeedbackStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Status">
      {pending ? (
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-subtle" aria-hidden />
      ) : null}
      {FEEDBACK_STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          disabled={pending || s === status}
          onClick={() =>
            startTransition(async () => {
              const result = await setFeedbackStatusAction(feedbackId, s);
              if (!result.ok) toast.error(result.error);
              else router.refresh();
            })
          }
          className={cn(
            "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
            s === status
              ? "border-primary/60 bg-primary/15 text-foreground"
              : "border-border/50 text-muted hover:border-border-strong hover:text-foreground",
          )}
        >
          {LABEL[s]}
        </button>
      ))}
    </div>
  );
}
