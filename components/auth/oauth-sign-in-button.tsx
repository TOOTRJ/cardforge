"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import {
  OAUTH_PROVIDER_LABELS,
  OAUTH_QUERY_PARAMS,
  type OAuthProvider,
} from "@/lib/auth/oauth-providers";

export function OAuthSignInButton({
  provider,
  redirectTo,
}: {
  provider: OAuthProvider;
  redirectTo?: string;
}) {
  const [loading, setLoading] = useState(false);
  const label = OAUTH_PROVIDER_LABELS[provider];

  async function signIn() {
    setLoading(true);
    const failed = () => {
      setLoading(false);
      toast.error(`Couldn't start ${label} sign-in. Please try again.`);
    };
    try {
      const supabase = createClient();
      const dest = safeRedirectPath(redirectTo);
      // Provider → Supabase → our /auth/callback (PKCE code exchange) → dest.
      // Every provider comes back through the same callback.
      const callback = `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(
        dest,
      )}`;
      const queryParams = OAUTH_QUERY_PARAMS[provider];
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: callback, ...(queryParams ? { queryParams } : {}) },
      });
      // On success the browser navigates to the provider; leave `loading`
      // true. supabase-js only reports an error it hits BEFORE navigating (a
      // provider that isn't enabled is GoTrue's answer after it).
      if (error) failed();
    } catch {
      failed();
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      onClick={signIn}
      disabled={loading}
      className="w-full"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : provider === "google" ? (
        <GoogleGlyph />
      ) : (
        <DiscordGlyph />
      )}
      Continue with {label}
    </Button>
  );
}

/** Every provider this environment offers, one full-width button each. */
export function OAuthSignInButtons({
  providers,
  redirectTo,
}: {
  providers: readonly OAuthProvider[];
  redirectTo?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => (
        <OAuthSignInButton key={provider} provider={provider} redirectTo={redirectTo} />
      ))}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z"
      />
    </svg>
  );
}

// Discord's own mark (the "Clyde" symbol) in Blurple, unaltered, as their
// brand guidelines ask.
function DiscordGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#5865F2"
        d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"
      />
    </svg>
  );
}

// A labelled "or" divider for placing between the provider buttons and the
// email/password form.
export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs uppercase tracking-wider text-subtle">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
