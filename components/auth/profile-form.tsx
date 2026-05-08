"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  updateProfileAction,
  type ProfileActionState,
} from "@/app/(app)/settings/actions";

const initialState: ProfileActionState = { status: "idle" };

type ProfileFormProps = {
  defaultValues: {
    username: string;
    display_name: string;
    bio: string;
    website_url: string;
  };
  email: string;
};

export function ProfileForm({ defaultValues, email }: ProfileFormProps) {
  const [state, formAction, isPending] = useActionState(
    updateProfileAction,
    initialState,
  );

  const value = (key: keyof ProfileFormProps["defaultValues"]) => {
    const v = state.values?.[key];
    return typeof v === "string" ? v : defaultValues[key];
  };

  const error = (key: keyof ProfileFormProps["defaultValues"]) =>
    state.fieldErrors?.[key];

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.formError ? (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
        >
          {state.formError}
        </div>
      ) : null}

      {state.success ? (
        <div
          role="status"
          className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-foreground"
        >
          Profile updated.
        </div>
      ) : null}

      <Field
        label="Email"
        name="email"
        value={email}
        readOnly
        helper="Email is managed by your account. Change support arrives in a later phase."
      />

      <Field
        label="Username"
        name="username"
        defaultValue={value("username")}
        placeholder="forgemaster"
        autoComplete="username"
        helper="Lowercase letters, numbers, underscores. 3–32 characters."
        error={error("username")}
      />

      <Field
        label="Display name"
        name="display_name"
        defaultValue={value("display_name")}
        placeholder="Forge Master"
        autoComplete="name"
        error={error("display_name")}
      />

      <Field
        label="Website"
        name="website_url"
        type="url"
        defaultValue={value("website_url")}
        placeholder="https://your-site.example"
        autoComplete="url"
        error={error("website_url")}
      />

      <FieldArea
        label="Bio"
        name="bio"
        defaultValue={value("bio")}
        placeholder="A line or two about your design vibe."
        helper="Up to 280 characters."
        error={error("bio")}
      />

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

type FieldProps = {
  label: string;
  name: string;
  defaultValue?: string;
  value?: string;
  readOnly?: boolean;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  helper?: string;
  error?: string;
};

function Field({
  label,
  name,
  defaultValue,
  value,
  readOnly,
  type = "text",
  placeholder,
  autoComplete,
  helper,
  error,
}: FieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error ? "true" : undefined}
        className={cn(
          "h-10 w-full rounded-md border bg-background/60 px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          error ? "border-danger/60" : "border-border",
          readOnly ? "cursor-not-allowed opacity-70" : "",
        )}
      />
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : helper ? (
        <span className="text-xs text-muted">{helper}</span>
      ) : null}
    </label>
  );
}

function FieldArea({
  label,
  name,
  defaultValue,
  placeholder,
  helper,
  error,
}: Omit<FieldProps, "type" | "value" | "readOnly" | "autoComplete">) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </span>
      <textarea
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        rows={3}
        aria-invalid={error ? "true" : undefined}
        className={cn(
          "w-full rounded-md border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          error ? "border-danger/60" : "border-border",
        )}
      />
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : helper ? (
        <span className="text-xs text-muted">{helper}</span>
      ) : null}
    </label>
  );
}
