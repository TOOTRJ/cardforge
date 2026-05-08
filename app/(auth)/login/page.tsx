import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { SurfaceCard } from "@/components/ui/surface-card";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { loginAction } from "@/app/(auth)/actions";
import type { LoginInput } from "@/lib/auth/schemas";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your CardForge account.",
};

type SearchParams = { redirectTo?: string; notice?: string };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { redirectTo, notice } = await searchParams;
  const configured = isSupabaseConfigured();

  return (
    <SurfaceCard className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Welcome back
        </h1>
        <p className="text-sm text-muted">
          Sign in to access your dashboard, drafts, and sets.
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
          authentication.
        </div>
      ) : null}

      {notice === "check-email" ? (
        <div
          role="status"
          className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-foreground"
        >
          Account created. Check your inbox to confirm your email, then sign in.
        </div>
      ) : null}

      <AuthForm<LoginInput>
        action={loginAction}
        redirectTo={redirectTo}
        submitLabel="Sign in"
        pendingLabel="Signing in…"
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
            placeholder: "you@example.com",
          },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "current-password",
            placeholder: "Your password",
          },
        ]}
      />

      <p className="text-sm text-muted">
        New to CardForge?{" "}
        <Link
          href={
            redirectTo
              ? `/signup?redirectTo=${encodeURIComponent(redirectTo)}`
              : "/signup"
          }
          className="font-medium text-primary hover:underline"
        >
          Create an account
        </Link>
      </p>
    </SurfaceCard>
  );
}
