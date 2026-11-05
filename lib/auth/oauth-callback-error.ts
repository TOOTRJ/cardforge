// What /auth/callback makes of a provider's refusal (TODO HM6). GoTrue
// redirects a failed OAuth sign-in to the callback with `error` (OAuth's
// code: `access_denied` when the visitor cancels on the provider's screen)
// and, for its own refusals, `error_code`. The login page shows one message
// per answer — none of them says whether a PipGlyph account exists.

export type OAuthCallbackError = "oauth-cancelled" | "oauth-verify-email" | "oauth-failed";

export const OAUTH_CALLBACK_ERRORS: readonly OAuthCallbackError[] = [
  "oauth-cancelled",
  "oauth-verify-email",
  "oauth-failed",
];

export function oauthCallbackErrorOf(params: URLSearchParams): OAuthCallbackError | null {
  const error = params.get("error");
  const errorCode = params.get("error_code");
  if (!error && !errorCode) return null;
  if (error === "access_denied" && !errorCode) return "oauth-cancelled";
  // A provider account whose email the provider hasn't verified: GoTrue
  // won't sign it in (and may have sent a confirmation email).
  if (errorCode === "provider_email_needs_verification") return "oauth-verify-email";
  return "oauth-failed";
}

export function isOAuthCallbackError(value: unknown): value is OAuthCallbackError {
  return typeof value === "string" && (OAUTH_CALLBACK_ERRORS as readonly string[]).includes(value);
}
