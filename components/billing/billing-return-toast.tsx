"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

// Reads the ?billing=success|credits|cancel param Stripe Checkout returns to,
// shows a confirmation, and refreshes so the webhook-driven tier/credit change
// shows up (the webhook usually lands a beat after the redirect). Then strips
// the param so a refresh/back doesn't re-fire. Render inside <Suspense>.
export function BillingReturnToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    const billing = params.get("billing");
    if (!billing) return;
    fired.current = true;

    const timers: ReturnType<typeof setTimeout>[] = [];
    if (billing === "success") {
      toast.success("You're subscribed — your plan is activating…");
      // Webhook lands shortly after the redirect; refresh to pick it up.
      timers.push(setTimeout(() => router.refresh(), 1500));
      timers.push(setTimeout(() => router.refresh(), 4000));
    } else if (billing === "credits") {
      toast.success("Credits added — thanks!");
      timers.push(setTimeout(() => router.refresh(), 1500));
    } else if (billing === "cancel") {
      toast("Checkout canceled — no charge was made.");
    }

    // Drop the query param so re-renders / back-nav don't replay the toast.
    router.replace(pathname, { scroll: false });
    return () => timers.forEach(clearTimeout);
  }, [params, router, pathname]);

  return null;
}
