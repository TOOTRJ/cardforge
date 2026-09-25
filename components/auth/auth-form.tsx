"use client";

import { useActionState, useState, useTransition } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resendConfirmationAction } from "@/app/(auth)/actions";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/auth/schemas";

type AuthField = {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  helper?: string;
};

type AuthFormProps<T extends Record<string, unknown>> = {
  action: (prev: ActionState<T>, formData: FormData) => Promise<ActionState<T>>;
  fields: AuthField[];
  /** Extra hidden inputs (signup attribution). */
  extraFields?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  redirectTo?: string;
};

const initialState: ActionState<Record<string, unknown>> = { status: "idle" };

export function AuthForm<T extends Record<string, unknown>>({
  action,
  fields,
  extraFields,
  submitLabel,
  pendingLabel = "Working…",
  redirectTo,
}: AuthFormProps<T>) {
  const [state, formAction, isPending] = useActionState(
    action as (
      prev: ActionState<Record<string, unknown>>,
      formData: FormData,
    ) => Promise<ActionState<Record<string, unknown>>>,
    initialState,
  );

  const sentTo =
    typeof state.values?.email === "string" ? state.values.email : "";

  // Signup with email confirmation on: the account exists but isn't signed
  // in yet. Replace the form so the next step is unmissable.
  if (state.status === "sent") {
    return (
      <div className="flex flex-col gap-4" role="status">
        <div className="flex items-start gap-3 rounded-md border border-primary/40 bg-primary/10 px-4 py-3">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-bright" aria-hidden />
          <div className="flex flex-col gap-1 text-sm text-foreground">
            <p className="font-medium">Check your inbox</p>
            <p className="text-muted">
              We sent a confirmation link to{" "}
              <span className="font-medium text-foreground">{sentTo}</span>. Open
              it to finish creating your account — it works on any device.
            </p>
          </div>
        </div>
        <ResendConfirmation email={sentTo} />
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}
      {extraFields}

      {state.formError ? (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
        >
          {state.formError}
          {state.unconfirmed && sentTo ? (
            <div className="mt-2">
              <ResendConfirmation email={sentTo} compact />
            </div>
          ) : null}
        </div>
      ) : null}

      {fields.map((field) => {
        const fieldError = state.fieldErrors?.[field.name];
        const defaultValue =
          (state.values?.[field.name] as string | undefined) ?? "";
        const hasValue = field.type !== "password";

        return (
          <label key={field.name} className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
              {field.label}
            </span>
            <input
              name={field.name}
              type={field.type ?? "text"}
              autoComplete={field.autoComplete}
              placeholder={field.placeholder}
              defaultValue={hasValue ? defaultValue : undefined}
              required
              aria-invalid={fieldError ? "true" : undefined}
              aria-describedby={
                fieldError || field.helper ? `${field.name}-hint` : undefined
              }
              className={cn(
                "h-10 w-full rounded-md border bg-background/60 px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                fieldError ? "border-danger/60" : "border-border",
              )}
            />
            {fieldError ? (
              <span id={`${field.name}-hint`} className="text-xs text-danger">
                {fieldError}
              </span>
            ) : field.helper ? (
              <span id={`${field.name}-hint`} className="text-xs text-muted">
                {field.helper}
              </span>
            ) : null}
          </label>
        );
      })}

      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}

function ResendConfirmation({ email, compact }: { email: string; compact?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { kind: "sent" } | { kind: "error"; message: string } | null
  >(null);

  const resend = () =>
    startTransition(async () => {
      const response = await resendConfirmationAction(email);
      setResult(
        response.ok ? { kind: "sent" } : { kind: "error", message: response.error },
      );
    });

  return (
    <div className={cn("flex flex-col gap-2", compact ? "" : "text-sm text-muted")}>
      {compact ? null : (
        <p>Nothing after a minute? Check spam, or send it again.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending || !email}
          onClick={resend}
        >
          {isPending ? "Sending…" : "Resend confirmation email"}
        </Button>
        <span aria-live="polite" className="text-xs text-muted">
          {result?.kind === "sent"
            ? "Sent — give it a minute."
            : result?.kind === "error"
              ? result.message
              : null}
        </span>
      </div>
    </div>
  );
}
