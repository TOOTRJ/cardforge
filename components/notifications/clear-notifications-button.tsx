"use client";

// "Clear all" for /notifications: two-step inline confirm (no modal), then
// every alert is marked read — badge, dashboard count and dots clear; the
// notifications themselves stay.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clearNotificationAlerts } from "@/lib/notifications/actions";

export function ClearNotificationsButton({ count }: { count: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  if (count === 0) return null;

  const clear = () => {
    startTransition(async () => {
      const result = await clearNotificationAlerts();
      if (!result.ok) {
        toast.error("Couldn't clear the alerts — try again.");
        return;
      }
      toast.success("All caught up.");
      setConfirming(false);
      router.refresh();
    });
  };

  if (!confirming) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
        <CheckCheck className="h-3.5 w-3.5" aria-hidden />
        Clear all
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted">
        Mark {count} alert{count === 1 ? "" : "s"} as read?
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        Keep
      </Button>
      <Button type="button" size="sm" onClick={clear} disabled={pending}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCheck className="h-3.5 w-3.5" aria-hidden />}
        Clear
      </Button>
    </span>
  );
}
