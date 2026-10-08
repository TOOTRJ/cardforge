"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createPortalSessionAction,
  getResumePreviewAction,
  resumeSubscriptionAction,
  type ResumePreview,
} from "@/lib/stripe/actions";
import { formatCalendarDate } from "@/lib/format/dates";
import { navigateTo } from "@/lib/routing/navigate";

// ---------------------------------------------------------------------------
// "Resume <Plan>" — un-cancels a plan that is set to end, in the app
// (resumeSubscriptionAction), behind a confirm step that states what
// happens: the plan renews on <date> at <price>, nothing is charged today.
// The date and price come from Stripe when the dialog opens
// (getResumePreviewAction), so every surface — the billing page, the
// dashboard notice, Settings, the plan grid, the upgrade modal — states the
// same thing. If the in-app step fails, the Customer Portal opens instead:
// it has its own "Renew plan" button.
// ---------------------------------------------------------------------------

/** What the confirm step says — exported so it is unit-tested as a table. */
export function resumeConfirmCopy(planName: string, preview: ResumePreview | null): string {
  if (!preview || !preview.ok) {
    return `Your ${planName} plan will carry on and renew as usual, at the price you already pay. Nothing is charged today.`;
  }
  const price = preview.priceLine ? ` at ${preview.priceLine}` : "";
  if (preview.trial) {
    return preview.nextBillAt
      ? `Your ${preview.planName} free trial will carry on until ${formatCalendarDate(preview.nextBillAt)}; then ${preview.planName} starts${price} on the card you added. Nothing is charged today.`
      : `Your ${preview.planName} free trial will carry on, then ${preview.planName} starts${price}. Nothing is charged today.`;
  }
  return preview.nextBillAt
    ? `Your ${preview.planName} plan will renew on ${formatCalendarDate(preview.nextBillAt)}${price}. Nothing is charged today.`
    : `Your ${preview.planName} plan will renew as usual${price}. Nothing is charged today.`;
}

export function ResumePlanButton({
  planName,
  surface,
  children,
  variant = "primary",
  size = "sm",
  className,
}: {
  /** The plan the viewer is on ("Pro") — the label until Stripe answers. */
  planName: string;
  /** Funnel: where the button sits. */
  surface: "billing" | "dashboard" | "settings" | "pricing" | "modal";
  children?: React.ReactNode;
  variant?: "primary" | "secondary" | "outline" | "accent" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ResumePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  function openConfirm() {
    setOpen(true);
    setPreview(null);
    setLoading(true);
    getResumePreviewAction()
      .then(setPreview)
      .catch(() => setPreview({ ok: false, error: "Couldn't read your plan from Stripe." }))
      .finally(() => setLoading(false));
  }

  function confirm() {
    startTransition(async () => {
      const result = await resumeSubscriptionAction({ surface });
      if (result.ok) {
        navigateTo(result.url);
        return;
      }
      toast.error(result.error);
      if (result.fallback !== "portal") {
        setOpen(false);
        return;
      }
      const portal = await createPortalSessionAction();
      if (portal.ok) navigateTo(portal.url);
      else setOpen(false);
    });
  }

  const name = preview?.ok ? preview.planName : planName;

  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={openConfirm}>
        {children ?? `Resume ${planName}`}
      </Button>
      <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
        <DialogContent size="sm" closeDisabled={pending}>
          <DialogHeader>
            <DialogTitle>Resume {name}?</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              {loading ? "Checking your plan with Stripe…" : resumeConfirmCopy(planName, preview)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(false)}>
              Not now
            </Button>
            <Button type="button" variant="primary" size="sm" disabled={pending || loading} onClick={confirm}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Resume {name}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
