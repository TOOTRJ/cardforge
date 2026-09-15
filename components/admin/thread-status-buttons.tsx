"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminSetThreadStatusAction } from "@/lib/messages/actions";
import type { ThreadStatus } from "@/lib/messages/schemas";

// Open ↔ closed toggle for an admin thread. Closing tells the user the
// matter is settled (their composer locks); an admin reply reopens it.
export function ThreadStatusButtons({
  threadId,
  status,
}: {
  threadId: string;
  status: ThreadStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next: ThreadStatus = status === "open" ? "closed" : "open";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await adminSetThreadStatusAction(threadId, next);
          if (!result.ok) toast.error(result.error);
          else {
            toast.success(next === "closed" ? "Conversation closed." : "Conversation reopened.");
            router.refresh();
          }
        })
      }
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : next === "closed" ? (
        <CheckCircle2 className="h-4 w-4" aria-hidden />
      ) : (
        <RotateCcw className="h-4 w-4" aria-hidden />
      )}
      {next === "closed" ? "Close conversation" : "Reopen"}
    </Button>
  );
}
