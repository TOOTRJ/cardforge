"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, Menu, Plus, ShieldCheck, X } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { Button } from "@/components/ui/button";
import {
  groupLinks,
  siteConfig,
  type NavGroup,
  type PrimaryNavEntry,
} from "@/lib/site-config";
import { cn } from "@/lib/utils";
import { NavSections, isNavItemActive } from "./nav-links";
import {
  AccountLinks,
  AccountSummary,
  SignedOutAccountLinks,
  type AccountPlan,
} from "./user-menu";
import { trackNavClick } from "./nav-click";

// ---------------------------------------------------------------------------
// MobileMenu — the menu button's drawer below `lg` (TODO NV1), where the
// header row holds only the logo, Create, the bell, the avatar and this
// button. Top to bottom: Create a card (full width), Community and Learn as
// accordions (a caret button each — aria-expanded / aria-controls; the group
// holding the current page starts open), Pricing, then the Account part:
// the same links as the avatar's panel, or Sign in / Create account.
//
// Radix Dialog does the dialog's work: focus trap, Escape, the focus back on
// the menu button, scroll lock, the overlay click. The content is styled as
// a right-anchored drawer instead of a centred modal.
// ---------------------------------------------------------------------------

type MobileMenuProps = {
  /** Already filtered by the header (Pricing only where it can be bought). */
  entries: readonly PrimaryNavEntry[];
  isAuthed: boolean;
  username: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  isAdmin?: boolean;
  /** Null while billing is off. */
  plan?: AccountPlan | null;
  credits?: number;
  creditsUsed?: number;
  /** Shows "Messages" — only for users with a support thread. */
  hasMessages?: boolean;
  unreadMessages?: number;
  challengeBadge?: React.ReactNode;
};

export function MobileMenu({
  entries,
  isAuthed,
  username,
  displayName = null,
  avatarUrl = null,
  isAdmin = false,
  plan = null,
  credits = 0,
  creditsUsed = 0,
  hasMessages = false,
  unreadMessages = 0,
  challengeBadge,
}: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const label = displayName?.trim() || username || "Account";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="Open navigation menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-elevated text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 lg:hidden"
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
          aria-describedby={undefined}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-80 max-w-[88vw] flex-col border-l border-border bg-surface shadow-2xl",
            "transition-transform duration-200 ease-out motion-reduce:transition-none",
            "data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full",
            "focus-visible:outline-none",
          )}
        >
          <DialogPrimitive.Title className="sr-only">Navigation menu</DialogPrimitive.Title>
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-subtle">Menu</span>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
            <Button asChild className="mb-3 w-full">
              <Link
                href={siteConfig.createCta.href}
                onClick={() => {
                  trackNavClick(siteConfig.createCta.id, "drawer", isAuthed);
                  close();
                }}
              >
                <Plus aria-hidden /> {siteConfig.createCta.label}
              </Link>
            </Button>

            <DrawerNav
              entries={entries}
              isAuthed={isAuthed}
              challengeBadge={challengeBadge}
              onNavigate={close}
            />

            <div className="my-3 h-px bg-border/60" />
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">
              Account
            </p>
            {isAuthed ? (
              <>
                <AccountSummary
                  username={username}
                  label={label}
                  avatarUrl={avatarUrl}
                  plan={plan}
                  credits={credits}
                  creditsUsed={creditsUsed}
                />
                <AccountLinks
                  username={username}
                  hasMessages={hasMessages}
                  unreadMessages={unreadMessages}
                  surface="drawer"
                  onNavigate={close}
                />
                {isAdmin ? (
                  <Link
                    href={siteConfig.adminNav[0].href}
                    onClick={close}
                    className="mt-1 flex items-center gap-2.5 rounded-md border-t border-border/60 px-2 py-2 pt-3 text-sm text-muted transition-colors hover:bg-elevated hover:text-foreground focus-visible:bg-elevated focus-visible:outline-none"
                  >
                    <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
                    Admin
                  </Link>
                ) : null}
              </>
            ) : (
              <SignedOutAccountLinks surface="drawer" onNavigate={close} />
            )}
          </div>

          {isAuthed ? (
            <div className="border-t border-border/60 px-3 py-3">
              <LogoutButton className="w-full [&>button]:w-full" variant="secondary" />
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Community and Learn as accordions, then the plain links (Pricing). */
function DrawerNav({
  entries,
  isAuthed,
  challengeBadge,
  onNavigate,
}: {
  entries: readonly PrimaryNavEntry[];
  isAuthed: boolean;
  challengeBadge?: React.ReactNode;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  // The drawer mounts on every open, so a group holding the current page
  // starts open each time; the others start closed.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        entries
          .filter((entry): entry is NavGroup => entry.kind === "group")
          .filter((group) => groupLinks(group).some((link) => isNavItemActive(pathname, link.href)))
          .map((group) => group.id),
      ),
  );
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <nav aria-label="Main">
      <ul className="flex flex-col gap-0.5">
        {entries.map((entry) =>
          entry.kind === "group" ? (
            <li key={entry.id}>
              <DrawerGroup
                group={entry}
                open={expanded.has(entry.id)}
                onToggle={() => toggle(entry.id)}
                isAuthed={isAuthed}
                challengeBadge={challengeBadge}
                onNavigate={onNavigate}
              />
            </li>
          ) : (
            <li key={entry.id}>
              <Link
                href={entry.href}
                aria-current={isNavItemActive(pathname, entry.href) ? "page" : undefined}
                onClick={() => {
                  trackNavClick(entry.id, "drawer", isAuthed);
                  onNavigate();
                }}
                className={cn(
                  "flex items-center rounded-md px-3 py-3 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
                  isNavItemActive(pathname, entry.href)
                    ? "bg-elevated text-foreground"
                    : "text-foreground hover:bg-elevated",
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

function DrawerGroup({
  group,
  open,
  onToggle,
  isAuthed,
  challengeBadge,
  onNavigate,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
  isAuthed: boolean;
  challengeBadge?: React.ReactNode;
  onNavigate: () => void;
}) {
  const panelId = `drawer-${group.id}-${useId().replace(/:/g, "")}`;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-md px-3 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
      >
        {group.label}
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 text-subtle transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      <div id={panelId} hidden={!open} className="pb-2 pl-1">
        <NavSections
          group={group}
          isAuthed={isAuthed}
          surface="drawer"
          challengeBadge={challengeBadge}
          layout="stack"
          onNavigate={onNavigate}
        />
      </div>
    </>
  );
}
