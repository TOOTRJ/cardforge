"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createPortalSessionAction } from "@/lib/stripe/actions";
import { cn } from "@/lib/utils";

type ManageBillingButtonProps = {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "outline" | "accent" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
};

// Opens the Stripe Customer Portal for self-serve plan changes, payment-method
// updates, invoices, and cancellation.
export function ManageBillingButton({
  children,
  variant = "outline",
  size = "md",
  className,
}: ManageBillingButtonProps) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await createPortalSessionAction();
      if (result.ok) {
        window.location.href = result.url;
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
