"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cancelScheduledPlanChangeAction } from "@/lib/stripe/actions";
import { navigateTo } from "@/lib/routing/navigate";

// "Keep current plan": drops the downgrade scheduled for the end of the
// period. Lands back on the billing page with ?billing=kept so the toast +
// refresh show the schedule is gone.
export function KeepPlanButton({
  children,
  size = "sm",
}: {
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await cancelScheduledPlanChangeAction();
      if (result.ok) {
        navigateTo(result.url);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button type="button" variant="outline" size={size} disabled={pending} onClick={handleClick}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  );
}
