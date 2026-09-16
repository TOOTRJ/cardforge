"use client";

// "Clear all" for /notifications: two-step inline confirm (no modal), then
// the server action deletes the caller's rows and the page refreshes.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clearAllNotifications } from "@/lib/notifications/actions";

export function ClearNotificationsButton({ count }: { count: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  if (count === 0) return null;

  const clear = () => {
    startTransition(async () => {
      const result = await clearAllNotifications();
      if (!result.ok) {
        toast.error("Couldn't clear notifications — try again.");
        return;
      }
      toast.success("Notifications cleared.");
      setConfirming(false);
      router.refresh();
    });
  };

  if (!confirming) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        Clear all
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted">
        Delete {count} notification{count === 1 ? "" : "s"}?
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        Keep
      </Button>
      <Button type="button" size="sm" onClick={clear} disabled={pending} className="bg-danger text-white hover:bg-danger/90">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
        Clear
      </Button>
    </span>
  );
}
