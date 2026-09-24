"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createCheckoutSessionAction, type CheckoutInput } from "@/lib/stripe/actions";
import { cn } from "@/lib/utils";
import { navigateTo } from "@/lib/routing/navigate";
import { trackFunnelEvent } from "@/lib/analytics/funnel-client";

type CheckoutButtonProps = {
  input: CheckoutInput;
  /** Where the button sits (funnel `cta_click.surface`). */
  surface?: "pricing" | "billing" | "modal" | "other";
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "outline" | "accent";
  size?: "sm" | "md" | "lg";
  className?: string;
};

// Kicks off a Stripe Checkout session for a subscription or credit pack and
// redirects the browser to the hosted page. Server-side `createCheckoutSessionAction`
// resolves the price id from a stable key, so the client never handles one.
export function CheckoutButton({
  input,
  surface = "other",
  children,
  variant = "primary",
  size = "md",
  className,
}: CheckoutButtonProps) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    trackFunnelEvent("cta_click", {
      surface,
      kind: input.kind,
      ...(input.kind === "subscription"
        ? { tier: input.tier, period: input.period ?? "monthly" }
        : { pack: input.pack }),
    });
    startTransition(async () => {
      const result = await createCheckoutSessionAction(input);
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
      className={cn("w-full", className)}
      disabled={pending}
      onClick={handleClick}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  );
}
