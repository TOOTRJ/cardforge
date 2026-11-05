// What /auth/callback makes of an OAuth provider's refusal (TODO HM6).
//
// The callback is ALSO where Supabase's default email links land (password
// reset, signup confirmation, email change), and an expired or used one comes
// back as `?error=access_denied&error_code=otp_expired`. So only the answers
// an OAuth sign-in can give are read as one:
//   - a refusal relayed from the provider: `error` with NO `error_code`
//     (`access_denied` = the visitor pressed Cancel on the provider's screen);
//   - GoTrue's own OAuth codes below.
// Anything else is not ours (null): the callback answers it as it always did.
// The login page shows one message per answer — none says whether a
// PipGlyph account exists.

export type OAuthCallbackError = "oauth-cancelled" | "oauth-verify-email" | "oauth-failed";

export const OAUTH_CALLBACK_ERRORS: readonly OAuthCallbackError[] = [
  "oauth-cancelled",
  "oauth-verify-email",
  "oauth-failed",
];

// GoTrue error codes only an OAuth sign-in produces.
const OAUTH_ERROR_CODES = new Set([
  "bad_oauth_callback",
  "bad_oauth_state",
  "oauth_provider_not_supported",
  "provider_disabled",
]);

export function oauthCallbackErrorOf(params: URLSearchParams): OAuthCallbackError | null {
  const error = params.get("error");
  const errorCode = params.get("error_code");
  // A provider account whose email the provider hasn't verified: GoTrue
  // won't sign it in (and may have sent a confirmation email).
  if (errorCode === "provider_email_needs_verification") return "oauth-verify-email";
  if (errorCode) return OAUTH_ERROR_CODES.has(errorCode) ? "oauth-failed" : null;
  if (!error) return null;
  return error === "access_denied" ? "oauth-cancelled" : "oauth-failed";
}

export function isOAuthCallbackError(value: unknown): value is OAuthCallbackError {
  return typeof value === "string" && (OAUTH_CALLBACK_ERRORS as readonly string[]).includes(value);
}
