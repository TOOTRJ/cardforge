"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setFrameReviewAction } from "@/lib/cards/frame-review-actions";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The verification checkbox — shared by the checklist rows and the compare
// view header. Checking publishes the (template, color) combo to the frame
// picker for all users; unchecking withdraws it.
// ---------------------------------------------------------------------------

type FrameVerifyCheckboxProps = {
  template: string;
  colorKey: string;
  verified: boolean;
  /** Larger hit target + label for the compare-view header. */
  withLabel?: boolean;
  className?: string;
};

export function FrameVerifyCheckbox({
  template,
  colorKey,
  verified: initialVerified,
  withLabel = false,
  className,
}: FrameVerifyCheckboxProps) {
  // Optimistic local state; reverted if the action fails.
  const [verified, setVerified] = useState(initialVerified);
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    setVerified(next);
    startTransition(async () => {
      const result = await setFrameReviewAction({
        template,
        colorKey,
        verified: next,
      });
      if (!result.ok) {
        setVerified(!next);
        toast.error(result.error);
        return;
      }
      toast.success(
        next
          ? `${template}/${colorKey} verified — now available to all users.`
          : `${template}/${colorKey} withdrawn from the picker.`,
      );
    });
  };

  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 text-xs text-muted",
        pending && "opacity-60",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={verified}
        disabled={pending}
        onChange={(event) => toggle(event.target.checked)}
        aria-label={`Mark ${template}/${colorKey} as verified`}
        className="h-4 w-4 accent-primary"
      />
      {withLabel ? (
        <span className="inline-flex items-center gap-1.5">
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : null}
          Frame renders near-perfectly — publish to all users
        </span>
      ) : null}
    </label>
  );
}
