"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { adminErrorToast } from "@/lib/admin/admin-toast";
import { Button } from "@/components/ui/button";
import { unhideCardAction } from "@/lib/moderation/actions";

// The admin's "Unhide" on a card moderation hid (migration 0156): clears the
// lock and notifies the owner. The card stays PRIVATE — its owner decides
// whether to publish it again.
export function UnhideCardButton({ cardId, title }: { cardId: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      aria-label={`Unhide ${title}`}
      onClick={() =>
        startTransition(async () => {
          const result = await unhideCardAction({ cardId });
          if (result.ok) {
            toast.success("Card unhidden. It stays private until its owner publishes it; they've been notified.");
            router.refresh();
          } else {
            adminErrorToast("card unhide", result.error);
          }
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      Unhide
    </Button>
  );
}
