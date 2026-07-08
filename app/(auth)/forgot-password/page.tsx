import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { SurfaceCard } from "@/components/ui/surface-card";
import { forgotPasswordAction } from "@/app/(auth)/actions";
import type { ForgotPasswordInput } from "@/lib/auth/schemas";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a password reset link for your PipGlyph account.",
  robots: { index: false },
};

export default function ForgotPasswordPage() {
  return (
    <SurfaceCard tone="gold" className="flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Reset your password
        </h1>
        <p className="text-sm text-muted">
          Enter your account email and we&apos;ll send you a link to set a new
          password.
        </p>
      </div>

      <AuthForm<ForgotPasswordInput>
        action={forgotPasswordAction}
        submitLabel="Send reset link"
        pendingLabel="Sending…"
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
            placeholder: "you@example.com",
          },
        ]}
      />

      <p className="text-sm text-muted">
        Remembered it?{" "}
        <Link
          href="/login"
          className="font-medium text-primary-bright hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </SurfaceCard>
  );
}
