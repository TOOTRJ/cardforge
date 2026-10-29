"use client";

import { useId } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  groupLinks,
  type NavGroup,
  type NavLink,
  type PrimaryNavEntry,
} from "@/lib/site-config";
import type { NavSurface } from "@/lib/analytics/funnel-events";
import { NavDisclosure } from "./nav-disclosure";
import { NAV_ICONS, NAV_LINK_ICONS } from "./nav-icons";
import { trackNavClick } from "./nav-click";

// ---------------------------------------------------------------------------
// The header's primary navigation from `lg` (TODO NV1): Community and Learn
// as disclosure panels, Pricing as a plain link — siteConfig.primaryNav.
// The drawer (mobile-menu.tsx) shows the same groups as accordions through
// the same NavSections / NavPanelLink, so both read one config.
//
// Active state (aria-current="page" on the link, the group's button lit):
// the path equals the link's href or sits under it (`/gallery/browse`
// lights Card gallery) — never "/" for everything.
// ---------------------------------------------------------------------------

type HeaderNavProps = {
  /** Already filtered by the header (Pricing only where it can be bought). */
  entries: readonly PrimaryNavEntry[];
  isAuthed: boolean;
  /** The current challenge's "Ends in N days" pill (AppShell). */
  challengeBadge?: React.ReactNode;
  className?: string;
};

export function HeaderNav({ entries, isAuthed, challengeBadge, className }: HeaderNavProps) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={className}>
      <ul className="flex items-center gap-1">
        {entries.map((entry) =>
          entry.kind === "group" ? (
            <li key={entry.id}>
              <NavDisclosure
                id={entry.id}
                label={entry.label}
                active={groupLinks(entry).some(
                  (link) => (isAuthed || !link.authedOnly) && isNavItemActive(pathname, link.href),
                )}
                // Learn's two sections side by side; Community's one column.
                panelClassName={entry.sections.length > 1 ? "w-[42rem]" : "w-[24rem]"}
              >
                <NavSections
                  group={entry}
                  isAuthed={isAuthed}
                  surface="header"
                  challengeBadge={challengeBadge}
                  layout="columns"
                />
              </NavDisclosure>
            </li>
          ) : (
            <li key={entry.id}>
              <Link
                href={entry.href}
                aria-current={isNavItemActive(pathname, entry.href) ? "page" : undefined}
                onClick={() => trackNavClick(entry.id, "header", isAuthed)}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
                  isNavItemActive(pathname, entry.href)
                    ? "bg-elevated text-foreground"
                    : "text-muted hover:bg-elevated hover:text-foreground",
                )}
              >
                {entry.label}
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

type NavSectionsProps = {
  group: NavGroup;
  isAuthed: boolean;
  surface: NavSurface;
  challengeBadge?: React.ReactNode;
  /** "columns": a header panel (sections side by side); "stack": the drawer. */
  layout: "columns" | "stack";
  /** After a link is followed (the drawer closes itself). */
  onNavigate?: () => void;
};

/** A group's sections — titled when there is more than one — each a list. */
export function NavSections({
  group,
  isAuthed,
  surface,
  challengeBadge,
  layout,
  onNavigate,
}: NavSectionsProps) {
  const pathname = usePathname();
  const baseId = useId().replace(/:/g, "");
  const titled = group.sections.length > 1;
  return (
    <div className={cn(layout === "columns" && titled ? "grid grid-cols-2 gap-1" : "flex flex-col gap-1")}>
      {group.sections.map((section) => {
        const items = section.items.filter((link) => isAuthed || !link.authedOnly);
        const titleId = `${baseId}-${section.id}`;
        return (
          <div key={section.id} className="min-w-0">
            {titled && section.title ? (
              <p
                id={titleId}
                className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle"
              >
                {section.title}
              </p>
            ) : null}
            <ul aria-labelledby={titled && section.title ? titleId : undefined} className="flex flex-col gap-0.5">
              {items.map((link) => (
                <li key={link.id}>
                  <NavPanelLink
                    link={link}
                    surface={surface}
                    signedIn={isAuthed}
                    active={isNavItemActive(pathname, link.href)}
                    extra={link.liveBadge === "challenge" ? challengeBadge : null}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

type NavPanelLinkProps = {
  link: NavLink;
  /** The resolved destination when it differs from `link.href`. */
  href?: string;
  surface: NavSurface;
  signedIn: boolean;
  active: boolean;
  /** After the label (the challenge pill). */
  extra?: React.ReactNode;
  onNavigate?: () => void;
};

/** One panel or drawer link: icon tile, label, the one-line description. */
export function NavPanelLink({
  link,
  href,
  surface,
  signedIn,
  active,
  extra,
  onNavigate,
}: NavPanelLinkProps) {
  const Icon = NAV_LINK_ICONS[link.id] ?? NAV_ICONS[link.href];
  return (
    <Link
      href={href ?? link.href}
      aria-current={active ? "page" : undefined}
      onClick={() => {
        trackNavClick(link.id, surface, signedIn);
        onNavigate?.();
      }}
      className={cn(
        "group/link flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors",
        "hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
        active && "bg-elevated",
      )}
    >
      {Icon ? (
        <span
          aria-hidden
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background/40 transition-colors",
            active
              ? "border-gold/60 text-gold-strong"
              : "border-gold/25 text-gold group-hover/link:border-gold/55 group-hover/link:text-gold-strong",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium leading-5 text-foreground">
          {link.label}
          {extra}
        </span>
        {link.description ? (
          <span className="mt-0.5 block text-xs leading-snug text-muted">{link.description}</span>
        ) : null}
      </span>
    </Link>
  );
}

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

/** The ONE current link of a list whose hrefs nest (/dashboard,
 *  /dashboard/decks, /dashboard/decks/new): the longest that matches. */
export function activeHrefIn(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (isNavItemActive(pathname, href) && (best == null || href.length > best.length)) best = href;
  }
  return best;
}
