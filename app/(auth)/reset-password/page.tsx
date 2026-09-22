import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { SurfaceCard } from "@/components/ui/surface-card";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isRecoverySession } from "@/lib/auth/recovery-session";
import { resetPasswordAction } from "@/app/(auth)/actions";
import type { ResetPasswordInput } from "@/lib/auth/schemas";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new password for your PipGlyph account.",
  robots: { index: false },
};

export default async function ResetPasswordPage() {
  // The email link lands on /auth/confirm (or /auth/callback), which turns
  // the recovery token into a session and forwards here. Only a session
  // that came from a RECENT recovery link may set a password without the
  // current one (lib/auth/recovery-session.ts): an ordinary signed-in
  // session — say, an unattended browser — is sent to Settings instead, and
  // no session at all means the link was stale, expired or visited directly.
  let recovery = false;
  let signedIn = false;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    recovery = await isRecoverySession(supabase);
    if (!recovery) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      signedIn = Boolean(user);
    }
  }

  return (
    <SurfaceCard tone="gold" className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Choose a new password
        </h1>
        <p className="text-sm text-muted">
          {recovery
            ? "Set a new password for your account. You'll stay signed in."
            : signedIn
              ? "You're signed in, so this reset link isn't needed — change your password from Settings, where your current password confirms it's you."
              : "This reset link is missing, has expired, or was already used."}
        </p>
      </div>

      {recovery ? (
        <AuthForm<ResetPasswordInput>
          action={resetPasswordAction}
          submitLabel="Update password"
          pendingLabel="Updating…"
          fields={[
            {
              name: "password",
              label: "New password",
              type: "password",
              autoComplete: "new-password",
              placeholder: "At least 8 characters",
              helper: "8–72 characters.",
            },
          ]}
        />
      ) : (
        <Link
          href={signedIn ? "/settings" : "/forgot-password"}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {signedIn ? "Go to Settings" : "Request a new reset link"}
        </Link>
      )}
    </SurfaceCard>
  );
}
