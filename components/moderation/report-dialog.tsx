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
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type ReportReason,
} from "@/lib/moderation/reasons";
import {
  REPORT_DETAILS_MAX_LENGTH,
  reportDetailsSchema,
  reportReasonSchema,
} from "@/lib/moderation/schemas";

type ReportDialogProps = {
  title: string;
  description: string;
  onSubmit: (
    reason: ReportReason,
    details: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** The element that opens the dialog (rendered via DialogTrigger asChild). */
  trigger: React.ReactNode;
};

// Shared report dialog for any content type (cards, comments). The caller wires
// `onSubmit` to the right server action and supplies a trigger.
export function ReportDialog({
  title,
  description,
  onSubmit,
  trigger,
}: ReportDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("nsfw");
  const [details, setDetails] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    reason?: string;
    details?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    // Same schemas the server actions run — inline errors before a round
    // trip. The server re-validates.
    const reasonParsed = reportReasonSchema.safeParse(reason);
    const detailsParsed = reportDetailsSchema.safeParse(details);
    if (!reasonParsed.success || !detailsParsed.success) {
      setFieldErrors({
        reason: reasonParsed.success
          ? undefined
          : reasonParsed.error.issues[0]?.message,
        details: detailsParsed.success
          ? undefined
          : detailsParsed.error.issues[0]?.message,
      });
      return;
    }
    setFieldErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = await onSubmit(reasonParsed.data, details);
      if (result.ok) {
        toast.success("Thanks — our team will review this.");
        setOpen(false);
        setDetails("");
      } else {
        setFormError(result.error ?? "Couldn't file the report.");
      }
    });
  }

  const fieldClass =
    "rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 disabled:opacity-50";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // A reopened dialog starts clean — stale errors from the last
        // attempt would read as errors about the fresh (empty) fields.
        setFieldErrors({});
        setFormError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
              onChange={(event) => {
                setReason(event.target.value as ReportReason);
                setFieldErrors((prev) => ({ ...prev, reason: undefined }));
              }}
              disabled={pending}
              aria-invalid={Boolean(fieldErrors.reason)}
              className={`h-10 ${fieldClass}`}
            >
              {REPORT_REASONS.map((value) => (
                <option key={value} value={value}>
                  {REPORT_REASON_LABELS[value]}
                </option>
              ))}
            </select>
            {fieldErrors.reason ? (
              <p role="alert" className="text-xs text-danger">
                {fieldErrors.reason}
              </p>
            ) : null}
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
              onChange={(event) => {
                setDetails(event.target.value);
                setFieldErrors((prev) => ({ ...prev, details: undefined }));
              }}
              maxLength={REPORT_DETAILS_MAX_LENGTH}
              rows={3}
              disabled={pending}
              placeholder="Anything that helps us review faster…"
              aria-invalid={Boolean(fieldErrors.details)}
              className={`py-2 ${fieldClass}`}
            />
            {fieldErrors.details ? (
              <p role="alert" className="text-xs text-danger">
                {fieldErrors.details}
              </p>
            ) : null}
          </div>

          {formError ? (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}
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
