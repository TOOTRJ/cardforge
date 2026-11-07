"use client";

import { useOptimistic, useTransition } from "react";
import { Bell, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setToolInterestAction } from "@/lib/tools/actions";
import { cn } from "@/lib/utils";

/**
 * "Notify me" on a tool the viewer can't open yet — a toggle
 * (aria-pressed). The admin page lists who pressed it and lets them in from
 * there; a tester is told by a notification.
 */
export function ToolInterestButton({
  slug,
  toolName,
  interested,
  className,
}: {
  slug: string;
  toolName: string;
  interested: boolean;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useOptimistic(interested);

  function toggle() {
    const next = !on;
    startTransition(async () => {
      setOn(next);
      const result = await setToolInterestAction(slug, next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        next
          ? `You're on the list. We'll tell you when ${toolName} opens.`
          : `You won't hear about ${toolName}.`,
      );
    });
  }

  const Icon = pending ? Loader2 : on ? BellRing : Bell;
  return (
    <Button
      type="button"
      size="sm"
      variant={on ? "secondary" : "outline"}
      aria-pressed={on}
      onClick={toggle}
      disabled={pending}
      className={cn(on && "border-gold/45 text-gold-strong", className)}
    >
      <Icon className={cn("h-4 w-4", pending && "animate-spin")} aria-hidden />
      {on ? "You'll be notified" : "Notify me"}
      <span className="sr-only"> about {toolName}</span>
    </Button>
  );
}
