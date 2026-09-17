"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  changeEmailAction,
  changePasswordAction,
  signOutEverywhereAction,
  type SecurityActionState,
} from "@/lib/account/security-actions";
import type { ChangeEmailInput, ChangePasswordInput } from "@/lib/auth/schemas";

// ---------------------------------------------------------------------------
// Settings → Sign-in & security. Three independent forms: change email
// (confirmed by link before it takes effect), change or set a password
// (current password required when one exists), sign out everywhere.
// ---------------------------------------------------------------------------

type SecurityPanelProps = {
  email: string;
  /** Sign-in methods on the account, e.g. ["email", "google"]. */
  providers: string[];
  /** Set when /auth/confirm just completed an email change. */
  emailJustChanged?: boolean;
};

const PROVIDER_LABEL: Record<string, string> = {
  email: "Email & password",
  google: "Google",
};

const emailInitial: SecurityActionState<ChangeEmailInput> = { status: "idle" };
const passwordInitial: SecurityActionState<ChangePasswordInput> = { status: "idle" };

export function SecurityPanel({ email, providers, emailJustChanged }: SecurityPanelProps) {
  const hasPassword = providers.includes("email");
  const [emailState, emailAction, emailPending] = useActionState(
    changeEmailAction,
    emailInitial,
  );
  const [passwordState, passwordAction, passwordPending] = useActionState(
    changePasswordAction,
    passwordInitial,
  );

  return (
    <div className="flex flex-col divide-y divide-border/60">
      <section className="flex flex-col gap-3 pb-6">
        <SectionHeading
          title="Sign-in methods"
          description={`You sign in as ${email}.`}
        />
        <ul className="flex flex-wrap gap-2">
          {(providers.length > 0 ? providers : ["email"]).map((provider) => (
            <li
              key={provider}
              className="rounded-full border border-border/60 bg-background/40 px-3 py-1 text-xs font-medium text-foreground"
            >
              {PROVIDER_LABEL[provider] ?? provider}
            </li>
          ))}
        </ul>
      </section>

      <form action={emailAction} className="flex flex-col gap-3 py-6" noValidate>
        <SectionHeading
          title="Email address"
          description="We'll send a confirmation link to the new address. Nothing changes until you open it."
        />
        {emailJustChanged && !emailState.success && !emailState.formError ? (
          <Notice tone="success">Your email address was updated.</Notice>
        ) : null}
        <Feedback state={emailState} />
        <SecurityField
          label="New email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={emailState.fieldErrors?.email}
        />
        <div>
          <Button type="submit" variant="secondary" disabled={emailPending}>
            {emailPending ? "Sending…" : "Send confirmation link"}
          </Button>
        </div>
      </form>

      <form action={passwordAction} className="flex flex-col gap-3 py-6" noValidate>
        <SectionHeading
          title={hasPassword ? "Password" : "Add a password"}
          description={
            hasPassword
              ? "Changing your password signs out your other devices."
              : "You sign in with Google. Add a password to also sign in with your email address."
          }
        />
        <Feedback state={passwordState} />
        {/* Lets password managers attach the new password to the right account. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={email}
          readOnly
          hidden
        />
        {hasPassword ? (
          <SecurityField
            label="Current password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            error={passwordState.fieldErrors?.current_password}
          />
        ) : null}
        <SecurityField
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          helper="8–72 characters."
          error={passwordState.fieldErrors?.password}
        />
        <div>
          <Button type="submit" variant="secondary" disabled={passwordPending}>
            {passwordPending
              ? "Saving…"
              : hasPassword
                ? "Update password"
                : "Set password"}
          </Button>
        </div>
      </form>

      <form
        action={signOutEverywhereAction}
        className="flex flex-wrap items-center justify-between gap-3 pt-6"
      >
        <SectionHeading
          title="Sign out everywhere"
          description="Ends every session on every device, including this one. Use it if you've lost a device or signed in somewhere shared."
        />
        <Button type="submit" variant="outline">
          Sign out of all devices
        </Button>
      </form>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex max-w-prose flex-col gap-0.5">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs leading-5 text-muted">{description}</p>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm text-foreground",
        tone === "error"
          ? "border-danger/40 bg-danger/10"
          : "border-primary/40 bg-primary/10",
      )}
    >
      {children}
    </div>
  );
}

function Feedback({
  state,
}: {
  state: { formError?: string; success?: string };
}) {
  if (state.formError) return <Notice tone="error">{state.formError}</Notice>;
  if (state.success) return <Notice tone="success">{state.success}</Notice>;
  return null;
}

function SecurityField({
  label,
  name,
  type,
  autoComplete,
  placeholder,
  helper,
  error,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete: string;
  placeholder?: string;
  helper?: string;
  error?: string;
}) {
  const hintId = `security-${name}-hint`;
  return (
    <label className="flex max-w-sm flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error || helper ? hintId : undefined}
        className={cn(
          "h-10 w-full rounded-md border bg-background/60 px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          error ? "border-danger/60" : "border-border",
        )}
      />
      {error ? (
        <span id={hintId} className="text-xs text-danger">
          {error}
        </span>
      ) : helper ? (
        <span id={hintId} className="text-xs text-muted">
          {helper}
        </span>
      ) : null}
    </label>
  );
}
