import Link from "next/link";
import { Logo } from "./logo";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/auth/logout-button";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

type HeaderUser = {
  username: string | null;
  displayName: string | null;
};

type SiteHeaderProps = {
  variant?: "marketing" | "app";
  user?: HeaderUser | null;
  className?: string;
};

export function SiteHeader({
  variant = "marketing",
  user,
  className,
}: SiteHeaderProps) {
  const nav = variant === "app" ? siteConfig.appNav : siteConfig.marketingNav;
  const isAuthed = Boolean(user);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/55",
        className,
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Logo />

        <nav className="hidden md:flex md:items-center md:gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {isAuthed ? (
            <>
              {user?.username ? (
                <Link
                  href={`/profile/${user.username}`}
                  className="hidden rounded-full border border-border/70 bg-elevated px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground sm:inline-flex"
                  title={user.displayName ?? user.username}
                >
                  @{user.username}
                </Link>
              ) : null}
              <LogoutButton />
              <Button asChild size="sm">
                <Link href="/create">New card</Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Start creating</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export type { HeaderUser };
