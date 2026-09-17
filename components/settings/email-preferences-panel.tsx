"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  EmailPreferenceFields,
  type EmailPreferenceValues,
} from "@/components/email/email-preference-fields";
import { updateEmailPreferencesAction } from "@/lib/email/preferences-actions";

export function EmailPreferencesPanel({
  initial,
  suppressed,
}: {
  initial: EmailPreferenceValues;
  suppressed: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, startTransition] = useTransition();
  const dirty =
    values.account !== saved.account ||
    values.activity !== saved.activity ||
    values.newsletter !== saved.newsletter;

  const save = () =>
    startTransition(async () => {
      const result = await updateEmailPreferencesAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSaved(values);
      toast.success("Email preferences saved.");
    });

  return (
    <div className="flex flex-col gap-4">
      {suppressed ? (
        <div
          role="status"
          className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground"
        >
          Emails to your address bounced or were marked as spam, so we&apos;ve
          paused everything except security emails. Update your email address
          under Sign-in &amp; security, or contact the team to resume.
        </div>
      ) : null}
      <EmailPreferenceFields values={values} onChange={setValues} disabled={pending} />
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save email preferences"}
        </Button>
        <p className="text-xs text-muted">
          Every email also carries a one-click unsubscribe link.
        </p>
      </div>
    </div>
  );
}
