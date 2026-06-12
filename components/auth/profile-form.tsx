"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  updateProfileAction,
  type ProfileActionState,
} from "@/app/(app)/settings/actions";
import { SOCIAL_PLATFORMS } from "@/lib/auth/schemas";

const initialState: ProfileActionState = { status: "idle" };

type ProfileFormDefaults = {
  username: string;
  display_name: string;
  bio: string;
  website_url: string;
  accent_color: string;
  twitter_url: string;
  bluesky_url: string;
  instagram_url: string;
  youtube_url: string;
  tiktok_url: string;
  discord_url: string;
  github_url: string;
};

type ProfileFormProps = {
  defaultValues: ProfileFormDefaults;
  email: string;
};

const SOCIAL_PLACEHOLDERS: Record<string, string> = {
  twitter_url: "https://x.com/your-handle",
  bluesky_url: "https://bsky.app/profile/your-handle",
  instagram_url: "https://instagram.com/your-handle",
  youtube_url: "https://youtube.com/@your-channel",
  tiktok_url: "https://tiktok.com/@your-handle",
  discord_url: "https://discord.gg/your-invite",
  github_url: "https://github.com/your-handle",
};

export function ProfileForm({ defaultValues, email }: ProfileFormProps) {
  const [state, formAction, isPending] = useActionState(
    updateProfileAction,
    initialState,
  );

  const value = (key: keyof ProfileFormDefaults): string => {
    const v = state.values?.[key];
    return typeof v === "string" ? v : defaultValues[key];
  };

  const error = (key: keyof ProfileFormDefaults) =>
    state.fieldErrors?.[key];

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
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

      <FormSection title="Identity">
        <Field
          label="Email"
          name="email"
          value={email}
          readOnly
          helper="Email is managed by your account."
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
      </FormSection>

      <FormSection title="About">
        <FieldArea
          label="Bio"
          name="bio"
          defaultValue={value("bio")}
          placeholder="A line or two about your design vibe."
          helper="Up to 280 characters."
          error={error("bio")}
        />
      </FormSection>

      <FormSection
        title="Branding"
        description="Optional accent color used on your public profile."
      >
        <ColorField
          label="Accent color"
          name="accent_color"
          defaultValue={value("accent_color")}
          helper="Hex color (e.g. #FF5577). Leave blank for the PipGlyph default."
          error={error("accent_color")}
        />
      </FormSection>

      <FormSection
        title="Links"
        description="Each link is checked against the platform's domain — paste the full URL."
      >
        <Field
          label="Website"
          name="website_url"
          type="url"
          defaultValue={value("website_url")}
          placeholder="https://your-site.example"
          autoComplete="url"
          error={error("website_url")}
        />
        {SOCIAL_PLATFORMS.map((platform) => (
          <Field
            key={platform.key}
            label={platform.label}
            name={platform.key}
            type="url"
            defaultValue={value(platform.key)}
            placeholder={SOCIAL_PLACEHOLDERS[platform.key]}
            error={error(platform.key)}
          />
        ))}
      </FormSection>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border/40 bg-background/30 p-4">
      <legend className="px-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">
          {title}
        </span>
      </legend>
      {description ? (
        <p className="text-xs text-muted">{description}</p>
      ) : null}
      {children}
    </fieldset>
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
          "h-10 w-full rounded-md border bg-background/60 px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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
          "w-full rounded-md border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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

// Color picker paired with a text input so the user can either pick visually
// or paste a hex value. Both controls share the same `name` so only one
// submits — the text input wins because it's the second control with the
// same name (FormData last-wins for plain inputs).
function ColorField({
  label,
  name,
  defaultValue,
  helper,
  error,
}: Omit<FieldProps, "type" | "value" | "readOnly" | "autoComplete">) {
  const fallback = defaultValue && /^#[0-9a-fA-F]{6}$/.test(defaultValue)
    ? defaultValue
    : "#d4af37";
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          name={`${name}_picker`}
          defaultValue={fallback}
          aria-label="Accent color picker"
          className="h-10 w-12 cursor-pointer rounded-md border border-border bg-background/60 p-1"
          onChange={(e) => {
            const text = e.currentTarget.parentElement?.querySelector<HTMLInputElement>(
              `input[name="${name}"]`,
            );
            if (text) text.value = e.currentTarget.value;
          }}
        />
        <input
          name={name}
          type="text"
          defaultValue={defaultValue}
          placeholder="#d4af37"
          aria-invalid={error ? "true" : undefined}
          className={cn(
            "h-10 flex-1 rounded-md border bg-background/60 px-3 font-mono text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            error ? "border-danger/60" : "border-border",
          )}
        />
      </div>
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : helper ? (
        <span className="text-xs text-muted">{helper}</span>
      ) : null}
    </label>
  );
}
