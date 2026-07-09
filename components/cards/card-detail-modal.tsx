"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Maximize2, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// CardDetailModal — dialog shell for the intercepted card route
// (app/@modal/(.)card/[username]/[slug]). The children are the same
// server-rendered CardDetailContent the full page uses.
//
// UX contract:
//   - Esc, overlay click, and the ✕ button all close by navigating back,
//     so the page behind (gallery, profile, feed…) keeps its scroll spot.
//   - Close plays the exit animation first, then router.back() — Radix
//     keeps the tree mounted until the CSS animation finishes.
//   - "Open full page" is a plain <a> (hard navigation), which skips the
//     interceptor and renders the real /card/... page.
//   - In-modal links to OTHER routes (profile, tags, sets) soft-navigate;
//     parallel-route slots keep their state on soft nav, so we watch the
//     pathname and render nothing once it stops being a card detail URL.
//   - Navigating modal → another card swaps content in place; the scroll
//     container resets to the top on each card change.
// ---------------------------------------------------------------------------

/** Matches /card/[username]/[slug] but not /card/[username]/edit. */
function isCardDetailPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  return (
    segments.length === 3 && segments[0] === "card" && segments[2] !== "edit"
  );
}

const EXIT_ANIMATION_MS = 170;

export function CardDetailModal({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const closingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // Play the exit animation before unwinding the history entry — the
    // route (and this component) unmounts as soon as router.back() lands.
    setOpen(false);
    setTimeout(() => router.back(), EXIT_ANIMATION_MS);
  }, [router]);

  // Modal → modal navigation (clicking a related card) reuses this mounted
  // shell with fresh children; start the new card at the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // A link inside the modal navigated somewhere that isn't a card detail
  // URL (profile, tag search, set page…). The slot keeps rendering on soft
  // navigations, so step out of the way.
  if (!isCardDetailPath(pathname)) {
    return null;
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="card-modal-overlay fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" />
        <DialogPrimitive.Content
          ref={panelRef}
          tabIndex={-1}
          // The content is a full page's worth of links — let focus land on
          // the panel itself so Esc works immediately and screen readers
          // announce the dialog before its first link.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            panelRef.current?.focus();
          }}
          className={[
            "card-modal-panel fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "h-[calc(100dvh-1.5rem)] w-[calc(100vw-0.75rem)] sm:h-auto sm:max-h-[calc(100dvh-4rem)] sm:w-[calc(100vw-3rem)]",
            "max-w-6xl rounded-frame border border-border bg-background shadow-2xl",
            "focus:outline-none focus-visible:outline-none",
          ].join(" ")}
        >
          <VisuallyHidden>
            <DialogPrimitive.Title>Card details</DialogPrimitive.Title>
            <DialogPrimitive.Description>
              Card detail view. Press Escape to close and return to the
              previous page.
            </DialogPrimitive.Description>
          </VisuallyHidden>

          {/* Chrome bar — stays put while the content scrolls beneath. */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-surface/60 px-4 py-2.5 sm:px-6">
            <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
              Card details
            </span>
            <div className="flex items-center gap-1">
              {/* Plain <a> on purpose: a hard navigation bypasses the route
                  interceptor, landing on the canonical full page. */}
              <a
                href={pathname}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted transition-colors hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
              >
                <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">Open full page</span>
                <span className="sr-only sm:hidden">Open full page</span>
              </a>
              <DialogPrimitive.Close
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
              >
                <X className="h-4 w-4" aria-hidden />
              </DialogPrimitive.Close>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
