"use client";

import { EMAIL_LISTS, EMAIL_LIST_COPY, type EmailList } from "@/lib/email/lists";
import { cn } from "@/lib/utils";

// The three email switches, shared by onboarding (step 3) and Settings →
// Email. Controlled: the parent owns the values and the save.
export type EmailPreferenceValues = Record<EmailList, boolean>;

export function EmailPreferenceFields({
  values,
  onChange,
  disabled,
}: {
  values: EmailPreferenceValues;
  onChange: (next: EmailPreferenceValues) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="flex flex-col divide-y divide-border/60 rounded-md border border-border/60 bg-background/40">
      {EMAIL_LISTS.map((list) => {
        const copy = EMAIL_LIST_COPY[list];
        const id = `email-pref-${list}`;
        return (
          <li key={list} className="flex items-start gap-3 px-4 py-3">
            <input
              id={id}
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary-bright)]"
              checked={values[list]}
              disabled={disabled}
              onChange={(event) => onChange({ ...values, [list]: event.target.checked })}
            />
            <label htmlFor={id} className={cn("flex flex-col gap-0.5", disabled && "opacity-70")}>
              <span className="text-sm font-medium text-foreground">{copy.label}</span>
              <span className="text-xs leading-5 text-muted">{copy.description}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
