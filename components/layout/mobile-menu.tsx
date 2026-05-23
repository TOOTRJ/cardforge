"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// MobileMenu — hamburger-triggered slide-in drawer for narrow viewports.
// Replaces the desktop nav, which is `hidden md:flex`. Reuses Radix Dialog
// for focus trap + ESC + click-outside behavior; the content is styled as
// a right-anchored drawer instead of a centered modal.
// ---------------------------------------------------------------------------

type MobileMenuProps = {
  isAuthed: boolean;
  username: string | null;
};

export function MobileMenu({ isAuthed, username }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const visibleItems = siteConfig.primaryNav.filter((item) => {
    if (item.authedOnly && !isAuthed) return false;
    if (item.anonOnly && isAuthed) return false;
    return true;
  });

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="Open navigation menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-elevated text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 md:hidden"
        >
          <Menu className="h-4 w-4" aria-hidden />
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-background/70 backdrop-blur-sm",
            "transition-opacity duration-150 ease-out",
            "data-[state=open]:opacity-100 data-[state=closed]:opacity-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-72 max-w-[80vw] flex-col border-l border-border bg-surface p-4 shadow-2xl",
            "transition-transform duration-200 ease-out",
            "data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full",
            "focus-visible:outline-none",
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            Navigation menu
          </DialogPrimitive.Title>
          <div className="flex items-center justify-between pb-3">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-subtle">
              Menu
            </span>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close menu"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </DialogPrimitive.Close>
          </div>

          <nav className="flex flex-col gap-0.5">
            {visibleItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-2.5 text-sm transition-colors",
                    active
                      ? "bg-elevated text-foreground"
                      : "text-muted hover:bg-elevated hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {isAuthed ? (
            <>
              <div className="my-3 h-px bg-border/60" />
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">
                Account
              </p>
              <div className="flex flex-col gap-0.5">
                {username ? (
                  <DrawerLink
                    href={`/profile/${username}`}
                    label="View profile"
                    onNav={() => setOpen(false)}
                    active={pathname === `/profile/${username}`}
                  />
                ) : null}
                <DrawerLink
                  href="/settings"
                  label="Settings"
                  onNav={() => setOpen(false)}
                  active={pathname === "/settings"}
                />
              </div>
              <div className="mt-auto pt-4">
                <LogoutButton className="w-full" />
              </div>
            </>
          ) : (
            <div className="mt-auto flex flex-col gap-2 pt-4">
              <Button asChild variant="ghost">
                <Link href="/login" onClick={() => setOpen(false)}>
                  Sign in
                </Link>
              </Button>
              <Button asChild>
                <Link href="/signup" onClick={() => setOpen(false)}>
                  Start creating
                </Link>
              </Button>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function DrawerLink({
  href,
  label,
  active,
  onNav,
}: {
  href: string;
  label: string;
  active: boolean;
  onNav: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNav}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-2.5 text-sm transition-colors",
        active
          ? "bg-elevated text-foreground"
          : "text-muted hover:bg-elevated hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}
