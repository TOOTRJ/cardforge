import type { EmailOtpType } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// The email-link types /auth/confirm accepts, the copy each one shows, and
// where it lands. The branded templates in supabase/templates link with the
// token HASH:
//
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery
//
// verifyOtp() exchanges the hash server-side, so the link works in ANY
// browser or device — the default templates' PKCE `?code=` link only works in
// the browser that requested it (the verifier lives in a cookie).
// ---------------------------------------------------------------------------

export const EMAIL_LINK_TYPES = [
  "signup",
  "email",
  "magiclink",
  "invite",
  "recovery",
  "email_change",
] as const satisfies readonly EmailOtpType[];

export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

export function parseEmailLinkType(value: unknown): EmailLinkType | null {
  return EMAIL_LINK_TYPES.find((t) => t === value) ?? null;
}

export const EMAIL_LINK_COPY: Record<
  EmailLinkType,
  { title: string; body: string; button: string; next: string }
> = {
  signup: {
    title: "Confirm your email",
    body: "One click and your PipGlyph account is ready.",
    button: "Confirm and continue",
    next: "/dashboard",
  },
  email: {
    title: "Confirm your email",
    body: "One click and your PipGlyph account is ready.",
    button: "Confirm and continue",
    next: "/dashboard",
  },
  magiclink: {
    title: "Sign in to PipGlyph",
    body: "Continue to sign in with this link.",
    button: "Sign in",
    next: "/dashboard",
  },
  invite: {
    title: "Accept your invitation",
    body: "Continue to set a password for your new PipGlyph account.",
    button: "Accept invitation",
    next: "/reset-password",
  },
  recovery: {
    title: "Reset your password",
    body: "Continue to choose a new password for your account.",
    button: "Choose a new password",
    next: "/reset-password",
  },
  email_change: {
    title: "Confirm your new email",
    body: "Continue to finish changing the email address on your account.",
    button: "Confirm email change",
    next: "/settings?notice=email-changed#security",
  },
};
