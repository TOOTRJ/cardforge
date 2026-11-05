// The OAuth providers the sign-in and sign-up pages offer (TODO HM6). ONE
// list: both pages, the button and the tests read it.
//
// Google is configured on production and always shown. Discord shows only
// where `NEXT_PUBLIC_AUTH_DISCORD=1` says its provider is configured in that
// environment's Supabase project (docs/AUTH.md): supabase-js navigates
// straight to GoTrue's /authorize, so an unconfigured provider would leave
// the visitor on GoTrue's raw JSON error page — and asking GoTrue's
// /settings first would cost a network call per render. A NEXT_PUBLIC_
// value is inlined at build time: changing it needs a redeploy.

export type OAuthProvider = "google" | "discord";

export const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Google",
  discord: "Discord",
};

export function enabledOAuthProviders(): OAuthProvider[] {
  const providers: OAuthProvider[] = ["google"];
  if (process.env.NEXT_PUBLIC_AUTH_DISCORD === "1") providers.push("discord");
  return providers;
}

// What GoTrue asks the provider for beyond the visitor's sign-in. Google's
// account chooser lets a visitor with several accounts pick one. Discord gets
// NOTHING extra: GoTrue already asks for exactly `email identify`, and a
// `scopes` option is APPENDED to that list (never replaces it).
export const OAUTH_QUERY_PARAMS: Partial<Record<OAuthProvider, Record<string, string>>> = {
  google: { prompt: "select_account" },
};
