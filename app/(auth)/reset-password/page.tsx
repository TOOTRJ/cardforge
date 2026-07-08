import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { SurfaceCard } from "@/components/ui/surface-card";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { resetPasswordAction } from "@/app/(auth)/actions";
import type { ResetPasswordInput } from "@/lib/auth/schemas";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new password for your PipGlyph account.",
  robots: { index: false },
};

export default async function ResetPasswordPage() {
  // The email link lands on /auth/callback, which exchanges the recovery
  // code for a session and forwards here. No session = the link was opened
  // stale/expired or the page was visited directly — point back at the
  // request form instead of showing a form that can only fail.
  let hasSession = false;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    hasSession = Boolean(user);
  }

  return (
    <SurfaceCard tone="gold" className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Choose a new password
        </h1>
        <p className="text-sm text-muted">
          {hasSession
            ? "Set a new password for your account. You'll stay signed in."
            : "This reset link is missing or has expired."}
        </p>
      </div>

      {hasSession ? (
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
          href="/forgot-password"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Request a new reset link
        </Link>
      )}
    </SurfaceCard>
  );
}
