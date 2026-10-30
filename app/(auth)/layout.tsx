import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { StarfieldBackdrop } from "@/components/ui/starfield-backdrop";
import { PageContainer } from "@/components/layout/page-container";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-svh flex-col bg-background">
      <div className="absolute inset-0 bg-radial-glow" aria-hidden />
      <StarfieldBackdrop withGlyphs />

      <PageContainer as="header" className="relative z-10 flex items-center justify-between py-6">
        <Logo />
        <Link
          href="/"
          className="text-sm text-muted transition-colors hover:text-foreground"
        >
          Back to site
        </Link>
      </PageContainer>

      <main
        id="main"
        className="relative z-10 flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8"
      >
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
