"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { applyBankedDaysAction } from "@/lib/billing/day-bank-actions";

// "Apply N banked days" (the billing page, a live plan): the viewer's banked
// free days are added to their plan's time (lib/billing/day-bank.ts). The
// page re-reads itself afterwards so the new end date shows.
export function ApplyBankButton({ days }: { days: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await applyBankedDaysAction();
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button type="button" size="sm" disabled={pending || days < 1} onClick={handleClick}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      Apply {days} banked day{days === 1 ? "" : "s"}
    </Button>
  );
}
