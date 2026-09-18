"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { ProfileMediaField } from "@/components/profile/profile-media-field";
import {
  EmailPreferenceFields,
  type EmailPreferenceValues,
} from "@/components/email/email-preference-fields";
import {
  checkUsernameAction,
  completeOnboardingAction,
  saveOnboardingIdentityAction,
  type UsernameCheck,
} from "@/lib/onboarding/actions";
import { isGeneratedUsername } from "@/lib/auth/usernames";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// OnboardingWizard — three short steps on a new account's first visit:
// handle + name, avatar + banner, email preferences. Every step saves on its
// own action so a closed tab loses nothing; "Skip" finishes with the defaults
// the account already has (generated handle, random built-in art, newsletter
// off).
// ---------------------------------------------------------------------------

const STEPS = [
  { key: "identity", label: "Your handle" },
  { key: "look", label: "Your look" },
  { key: "email", label: "Email" },
];

type OnboardingWizardProps = {
  initial: {
    username: string;
    displayName: string;
    bio: string;
    avatarUrl: string | null;
    bannerUrl: string | null;
    email: EmailPreferenceValues;
  };
  /** Where "Finish" lands (a safe same-origin path). */
  next: string;
};

export function OnboardingWizard({ initial, next }: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const generated = isGeneratedUsername(initial.username);
  const [username, setUsername] = useState(initial.username);
  const [displayName, setDisplayName] = useState(
    generated && initial.displayName === initial.username ? "" : initial.displayName,
  );
  const [bio, setBio] = useState(initial.bio);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<"username" | "display_name" | "bio", string>>
  >({});
  const [check, setCheck] = useState<UsernameCheck | { status: "checking" } | null>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 3
  const [email, setEmail] = useState<EmailPreferenceValues>(initial.email);

  // Debounced availability check, driven from the change handler (an effect
  // that set state on every keystroke would cascade renders).
  const handleUsernameChange = (value: string) => {
    setUsername(value);
    if (checkTimer.current) clearTimeout(checkTimer.current);
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === initial.username) {
      setCheck(null);
      return;
    }
    setCheck({ status: "checking" });
    checkTimer.current = setTimeout(async () => {
      const result = await checkUsernameAction(normalized);
      setCheck(result);
    }, 350);
  };
  useEffect(() => {
    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
    };
  }, []);

  const saveIdentity = () =>
    startTransition(async () => {
      setError(null);
      const result = await saveOnboardingIdentityAction({
        username,
        display_name: displayName || username,
        bio,
      });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors);
        if (result.error) setError(result.error);
        return;
      }
      setFieldErrors({});
      setStep(1);
    });

  const finish = (withPreferences: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await completeOnboardingAction(
        withPreferences ? { preferences: email } : {},
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(next);
      router.refresh();
    });

  const usernameHint =
    fieldErrors.username ??
    (check?.status === "taken" || check?.status === "invalid"
      ? check.message
      : check?.status === "available"
        ? "Available."
        : check?.status === "checking"
          ? "Checking…"
          : generated
            ? "We minted this one for you — claim a handle that's yours."
            : "Letters, numbers, underscores. 3–32 characters.");
  const usernameTone =
    fieldErrors.username || check?.status === "taken" || check?.status === "invalid"
      ? "text-danger"
      : check?.status === "available"
        ? "text-primary-bright"
        : "text-muted";

  return (
    <div className="flex flex-col gap-8">
      <Stepper steps={STEPS} current={step} onStepSelect={setStep} />

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
        >
          {error}
        </div>
      ) : null}

      {step === 0 ? (
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            saveIdentity();
          }}
        >
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl font-semibold text-foreground">
              Claim your handle
            </h2>
            <p className="text-sm leading-6 text-muted">
              Your username is your public address on PipGlyph —{" "}
              <span className="font-mono text-xs text-foreground">
                pipglyph.com/profile/{username || "…"}
              </span>
              . Your display name is what people see next to your cards.
            </p>
          </div>

          <Field
            label="Username"
            name="username"
            value={username}
            onChange={handleUsernameChange}
            autoComplete="username"
            autoFocus
            hint={usernameHint}
            hintClassName={usernameTone}
            invalid={Boolean(fieldErrors.username) || check?.status === "taken"}
          />
          <Field
            label="Display name"
            name="display_name"
            value={displayName}
            onChange={setDisplayName}
            autoComplete="name"
            placeholder={username || "Forge Master"}
            hint={fieldErrors.display_name ?? "Up to 64 characters. Leave it blank to use your username."}
            hintClassName={fieldErrors.display_name ? "text-danger" : "text-muted"}
            invalid={Boolean(fieldErrors.display_name)}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
              Bio <span className="font-normal normal-case tracking-normal text-muted">(optional)</span>
            </span>
            <textarea
              name="bio"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              rows={2}
              maxLength={280}
              placeholder="A line or two about the cards you like to make."
              className={cn(
                "w-full rounded-md border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                fieldErrors.bio ? "border-danger/60" : "border-border",
              )}
            />
            <span className={cn("text-xs", fieldErrors.bio ? "text-danger" : "text-muted")}>
              {fieldErrors.bio ?? `${bio.length}/280`}
            </span>
          </label>

          <StepActions
            pending={pending}
            primaryLabel="Save and continue"
            onSkip={() => finish(false)}
            primaryDisabled={check?.status === "checking" || check?.status === "taken"}
          />
        </form>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl font-semibold text-foreground">
              Choose your look
            </h2>
            <p className="text-sm leading-6 text-muted">
              We&apos;ve dealt you a random avatar and banner from our built-in
              set. Keep them, shuffle, pick another, or upload your own — you
              can change them any time in settings.
            </p>
          </div>
          <ProfileMediaField
            kind="avatar"
            currentUrl={initial.avatarUrl}
            label="Avatar"
            hint="Square images look best — 256×256 or larger."
            defaultOpen
          />
          <ProfileMediaField
            kind="banner"
            currentUrl={initial.bannerUrl}
            label="Banner"
            hint="Wide (≈ 4:1). Shown across the top of your profile."
          />
          <StepActions
            pending={pending}
            primaryLabel="Continue"
            onPrimary={() => setStep(2)}
            onBack={() => setStep(0)}
            onSkip={() => finish(false)}
          />
        </div>
      ) : null}

      {step === 2 ? (
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            finish(true);
          }}
        >
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl font-semibold text-foreground">
              Stay in the loop
            </h2>
            <p className="text-sm leading-6 text-muted">
              Choose what lands in your inbox. Everything here can be changed
              in settings, and every email has a one-click unsubscribe link.
            </p>
          </div>
          <EmailPreferenceFields values={email} onChange={setEmail} disabled={pending} />
          <StepActions
            pending={pending}
            primaryLabel="Finish"
            primaryIcon={<Check className="h-4 w-4" aria-hidden />}
            onBack={() => setStep(1)}
            onSkip={() => finish(false)}
            skipLabel="Skip — use the defaults"
          />
        </form>
      ) : null}
    </div>
  );
}

function StepActions({
  pending,
  primaryLabel,
  primaryIcon,
  primaryDisabled,
  onPrimary,
  onBack,
  onSkip,
  skipLabel = "Skip for now",
}: {
  pending: boolean;
  primaryLabel: string;
  primaryIcon?: React.ReactNode;
  primaryDisabled?: boolean;
  /** Omitted = the surrounding form's submit. */
  onPrimary?: () => void;
  onBack?: () => void;
  onSkip: () => void;
  skipLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-5">
      <Button
        type={onPrimary ? "button" : "submit"}
        onClick={onPrimary}
        disabled={pending || primaryDisabled}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          (primaryIcon ?? <ArrowRight className="h-4 w-4" aria-hidden />)
        )}
        {primaryLabel}
      </Button>
      {onBack ? (
        <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
          Back
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        className="ml-auto text-muted"
        onClick={onSkip}
        disabled={pending}
      >
        {skipLabel}
      </Button>
    </div>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  autoComplete,
  autoFocus,
  placeholder,
  hint,
  hintClassName,
  invalid,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  autoFocus?: boolean;
  placeholder?: string;
  hint: string;
  hintClassName: string;
  invalid?: boolean;
}) {
  const hintId = `onboarding-${name}-hint`;
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">{label}</span>
      <input
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-invalid={invalid ? "true" : undefined}
        aria-describedby={hintId}
        className={cn(
          "h-10 w-full rounded-md border bg-background/60 px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          invalid ? "border-danger/60" : "border-border",
        )}
      />
      <span id={hintId} className={cn("text-xs", hintClassName)} aria-live="polite">
        {hint}
      </span>
    </label>
  );
}
