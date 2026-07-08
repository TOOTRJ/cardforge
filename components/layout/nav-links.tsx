"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/site-config";

type NavLinksProps = {
  items: readonly NavItem[];
  isAuthed: boolean;
  className?: string;
  itemClassName?: string;
  activeClassName?: string;
};

/**
 * Renders the header's primary navigation with active-route highlighting.
 * Auth-gated items are filtered out for anonymous visitors so the menu
 * doesn't tease links that immediately redirect to /login.
 *
 * Active state matches:
 *   - exact path equality, OR
 *   - the current path begins with `${href}/` (so /dashboard/sets keeps
 *     "Dashboard" highlighted as a parent — except for "/" which would
 *     match everything).
 */
export function NavLinks({
  items,
  isAuthed,
  className,
  itemClassName,
  activeClassName,
}: NavLinksProps) {
  const pathname = usePathname();
  const visible = items.filter((item) => {
    if (item.authedOnly && !isAuthed) return false;
    if (item.anonOnly && isAuthed) return false;
    return true;
  });

  return (
    <nav className={className}>
      {visible.map((item) => {
        const isActive = isItemActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm transition-colors",
              isActive
                ? cn("text-foreground", activeClassName)
                : cn(
                    "text-muted hover:bg-elevated hover:text-foreground",
                    itemClassName,
                  ),
            )}
          >
            {item.label}
            {item.badge ? (
              <span className="ml-1.5 rounded-full border border-border/70 bg-elevated px-1.5 py-px align-middle text-[9px] font-semibold uppercase tracking-wide text-subtle">
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function isItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}
