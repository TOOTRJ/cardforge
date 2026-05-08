import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { SurfaceCard } from "@/components/ui/surface-card";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { signupAction } from "@/app/(auth)/actions";
import type { SignupInput } from "@/lib/auth/schemas";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a CardForge account to start designing custom cards.",
};

type SearchParams = { redirectTo?: string };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { redirectTo } = await searchParams;
  const configured = isSupabaseConfigured();

  return (
    <SurfaceCard className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Forge an account
        </h1>
        <p className="text-sm text-muted">
          Pick a username and password. You can update your display name and bio
          anytime in settings.
        </p>
      </div>

      {!configured ? (
        <div
          role="status"
          className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground"
        >
          Supabase isn&apos;t configured yet. Add{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
          to <code className="font-mono text-xs">.env.local</code> to enable
          signup.
        </div>
      ) : null}

      <AuthForm<SignupInput>
        action={signupAction}
        redirectTo={redirectTo}
        submitLabel="Create account"
        pendingLabel="Creating account…"
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
            placeholder: "you@example.com",
          },
          {
            name: "username",
            label: "Username",
            type: "text",
            autoComplete: "username",
            placeholder: "forgemaster",
            helper: "Lowercase letters, numbers, underscores. 3–32 characters.",
          },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "new-password",
            placeholder: "At least 8 characters",
          },
        ]}
      />

      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={
            redirectTo
              ? `/login?redirectTo=${encodeURIComponent(redirectTo)}`
              : "/login"
          }
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </SurfaceCard>
  );
}
