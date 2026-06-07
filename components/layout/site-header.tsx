import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Logo } from "./logo";
import { Button } from "@/components/ui/button";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";
import { MobileMenu } from "./mobile-menu";
import { CommandPaletteTrigger } from "./command-palette-trigger";
import { ThemeToggle } from "./theme-toggle";
import { siteConfig } from "@/lib/site-config";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

type HeaderUser = {
  username: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
  /** Drives the header "Upgrade" CTA — hidden for paid users. */
  isPaid?: boolean;
};

type SiteHeaderProps = {
  /** Kept for the ⌘K trigger gating — the palette is only mounted in the
   *  (app) route group, so showing the trigger elsewhere would be a dead
   *  shortcut. Nav items themselves no longer depend on variant. */
  variant?: "marketing" | "app";
  user?: HeaderUser | null;
  theme?: Theme;
  className?: string;
};

export function SiteHeader({
  variant = "marketing",
  user,
  theme = "system",
  className,
}: SiteHeaderProps) {
  const isAuthed = Boolean(user);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/55",
        className,
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6 lg:px-8">
        <Logo />

        <NavLinks
          className="hidden md:flex md:items-center md:gap-1"
          items={siteConfig.primaryNav}
          isAuthed={isAuthed}
          activeClassName="bg-elevated"
        />

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle initialTheme={theme} />
          {isAuthed ? (
            <>
              {variant === "app" ? <CommandPaletteTrigger /> : null}
              {user?.isPaid ? null : (
                <Button
                  asChild
                  variant="accent"
                  size="sm"
                  className="hidden sm:inline-flex"
                >
                  <Link href="/pricing">
                    <Sparkles className="h-4 w-4" aria-hidden /> Upgrade
                  </Link>
                </Button>
              )}
              <Button asChild size="sm" className="hidden sm:inline-flex">
                <Link href="/create">New card</Link>
              </Button>
              <UserMenu
                username={user?.username ?? null}
                displayName={user?.displayName ?? null}
                avatarUrl={user?.avatarUrl ?? null}
                isPaid={user?.isPaid ?? false}
              />
            </>
          ) : (
            <>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="hidden sm:inline-flex"
              >
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm" className="hidden sm:inline-flex">
                <Link href="/signup">Start creating</Link>
              </Button>
            </>
          )}
          <MobileMenu
            isAuthed={isAuthed}
            username={user?.username ?? null}
          />
        </div>
      </div>
    </header>
  );
}

export type { HeaderUser };
