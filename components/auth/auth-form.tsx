"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
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
  submitLabel: string;
  pendingLabel?: string;
  redirectTo?: string;
};

const initialState: ActionState<Record<string, unknown>> = { status: "idle" };

export function AuthForm<T extends Record<string, unknown>>({
  action,
  fields,
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

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

      {state.formError ? (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
        >
          {state.formError}
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
              aria-invalid={fieldError ? "true" : undefined}
              className={cn(
                "h-10 w-full rounded-md border bg-background/60 px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                fieldError ? "border-danger/60" : "border-border",
              )}
            />
            {fieldError ? (
              <span className="text-xs text-danger">{fieldError}</span>
            ) : field.helper ? (
              <span className="text-xs text-muted">{field.helper}</span>
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
