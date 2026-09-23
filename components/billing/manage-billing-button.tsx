"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createPortalSessionAction, type PortalFlow } from "@/lib/stripe/actions";
import { cn } from "@/lib/utils";
import { navigateTo } from "@/lib/routing/navigate";

type ManageBillingButtonProps = {
  children: React.ReactNode;
  /** Open the portal straight into one flow (default: its home page). */
  flow?: PortalFlow;
  variant?: "primary" | "secondary" | "outline" | "accent" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
};

// Opens the Stripe Customer Portal for self-serve plan changes, payment-method
// updates, invoices, and cancellation.
export function ManageBillingButton({
  children,
  flow = "home",
  variant = "outline",
  size = "md",
  className,
}: ManageBillingButtonProps) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await createPortalSessionAction(flow);
      if (result.ok) {
        navigateTo(result.url);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn(className)}
      disabled={pending}
      onClick={handleClick}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  );
}
