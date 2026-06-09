"use client";

import { useState, useTransition } from "react";
import { Flag, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { reportCardAction } from "@/lib/moderation/actions";
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type ReportReason,
} from "@/lib/moderation/reasons";

export function ReportCardDialog({ cardId }: { cardId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("nsfw");
  const [details, setDetails] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await reportCardAction({ cardId, reason, details });
      if (result.ok) {
        toast.success("Thanks — our team will review this.");
        setOpen(false);
        setDetails("");
      } else {
        toast.error(result.error);
      }
    });
  }

  const fieldClass =
    "rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="Report this card">
          <Flag className="h-4 w-4" aria-hidden /> Report
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Report this card</DialogTitle>
          <DialogDescription>
            Tell us what&apos;s wrong. Reports are reviewed by our moderation team.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="report-reason"
              className="text-xs font-semibold uppercase tracking-wider text-subtle"
            >
              Reason
            </label>
            <select
              id="report-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value as ReportReason)}
              disabled={pending}
              className={`h-10 ${fieldClass}`}
            >
              {REPORT_REASONS.map((value) => (
                <option key={value} value={value}>
                  {REPORT_REASON_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="report-details"
              className="text-xs font-semibold uppercase tracking-wider text-subtle"
            >
              Details{" "}
              <span className="font-normal normal-case text-muted">(optional)</span>
            </label>
            <textarea
              id="report-details"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              maxLength={1000}
              rows={3}
              disabled={pending}
              placeholder="Anything that helps us review faster…"
              className={`py-2 ${fieldClass}`}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Flag className="h-4 w-4" aria-hidden />
            )}
            Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
