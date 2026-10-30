import { Logo } from "@/components/layout/logo";
import { LogoutButton } from "@/components/auth/logout-button";
import { StarfieldBackdrop } from "@/components/ui/starfield-backdrop";
import { PageContainer } from "@/components/layout/page-container";

// The first-run onboarding chrome: the auth layout's quiet backdrop with a
// wider column for the avatar/banner galleries, and a way out (sign out) but
// no site navigation — /onboarding is the only destination until it's done.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col bg-background">
      <div className="absolute inset-0 bg-radial-glow" aria-hidden />
      <StarfieldBackdrop withGlyphs />

      <PageContainer as="header" className="relative z-10 flex items-center justify-between py-6">
        <Logo />
        <LogoutButton variant="ghost" size="sm" />
      </PageContainer>

      <PageContainer as="main" id="main" className="relative z-10 flex flex-1 justify-center py-8">
        <div className="w-full max-w-2xl">{children}</div>
      </PageContainer>
    </div>
  );
}
