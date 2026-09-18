import { Logo } from "@/components/layout/logo";
import { LogoutButton } from "@/components/auth/logout-button";
import { StarfieldBackdrop } from "@/components/ui/starfield-backdrop";

// The first-run onboarding chrome: the auth layout's quiet backdrop with a
// wider column for the avatar/banner galleries, and a way out (sign out) but
// no site navigation — /onboarding is the only destination until it's done.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col bg-background">
      <div className="absolute inset-0 bg-radial-glow" aria-hidden />
      <StarfieldBackdrop withGlyphs />

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-6 sm:px-6 lg:px-8">
        <Logo />
        <LogoutButton variant="ghost" size="sm" />
      </header>

      <main
        id="main"
        className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 justify-center px-4 py-8 sm:px-6 lg:px-8"
      >
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  );
}
