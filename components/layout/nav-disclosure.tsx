"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The header's panels (TODO NV1) — Community, Learn and Account — each a
// WAI-ARIA DISCLOSURE: a button with aria-expanded + aria-controls and its
// panel right after it in the DOM, so Tab walks from the button into the
// panel's links. Never role="menu": that promises arrow-key menu semantics
// a list of links doesn't have, and takes the links out of a screen
// reader's links list.
//
//   - click or tap toggles (no hover in this version);
//   - one panel at a time: HeaderDisclosures holds the open id;
//   - Escape closes the open panel and puts focus back on its button;
//   - a press outside, focus leaving it, or a navigation closes it;
//   - a closed panel is `hidden`, not unmounted: its links stay in the
//     static HTML for crawlers.
// ---------------------------------------------------------------------------

type DisclosureState = {
  openId: string | null;
  setOpenId: (id: string | null) => void;
};

const DisclosureContext = createContext<DisclosureState | null>(null);

/** One open panel across every NavDisclosure inside it (the header row). */
export function HeaderDisclosures({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // A navigation closes whatever was open (a link to the page you're on
  // closes it through the panel's own click handler).
  const pathname = usePathname();
  const [shownPath, setShownPath] = useState(pathname);
  if (pathname !== shownPath) {
    setShownPath(pathname);
    setOpenId(null);
  }
  const value = useMemo(() => ({ openId, setOpenId }), [openId]);
  return <DisclosureContext.Provider value={value}>{children}</DisclosureContext.Provider>;
}

/** The shared state, or a disclosure's own when it stands alone. */
function useDisclosureOpen(id: string): [boolean, (open: boolean) => void] {
  const shared = useContext(DisclosureContext);
  const [ownOpen, setOwnOpen] = useState(false);
  const sharedSetter = shared?.setOpenId;
  const setOpen = useCallback(
    (open: boolean) => {
      if (sharedSetter) sharedSetter(open ? id : null);
      else setOwnOpen(open);
    },
    [id, sharedSetter],
  );
  return [shared ? shared.openId === id : ownOpen, setOpen];
}

type NavDisclosureProps = {
  /** Unique within the header ("community", "learn", "account"). */
  id: string;
  /** The button's visible content (the caret follows it). */
  label: React.ReactNode;
  /** The button's name when its content has none of its own (the avatar). */
  ariaLabel?: string;
  /** The current page belongs to this panel: the button reads as current. */
  active?: boolean;
  /** Which edge of the button the panel lines up with. */
  align?: "start" | "end";
  className?: string;
  buttonClassName?: string;
  panelClassName?: string;
  children: React.ReactNode;
};

export function NavDisclosure({
  id,
  label,
  ariaLabel,
  active = false,
  align = "start",
  className,
  buttonClassName,
  panelClassName,
  children,
}: NavDisclosureProps) {
  const [open, setOpen] = useDisclosureOpen(id);
  const panelId = `nav-panel-${id}-${useId().replace(/:/g, "")}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      onBlur={(event) => {
        // Focus moved on to something outside (Tab past the last link,
        // Shift+Tab before the button). Null = the window lost focus, or a
        // press on nothing focusable: the pointerdown check owns that.
        const next = event.relatedTarget;
        if (open && next instanceof Node && !event.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ariaLabel}
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
          open || active
            ? "bg-elevated text-foreground"
            : "text-muted hover:bg-elevated hover:text-foreground",
          buttonClassName,
        )}
      >
        {label}
        <ChevronDown
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-subtle transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        id={panelId}
        hidden={!open}
        // A link inside closes the panel — the one to the page you're on
        // too, which no navigation would close.
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a[href]")) setOpen(false);
        }}
        className={cn(
          // 14 px under the h-9 button = the header's bottom edge.
          "absolute top-full z-50 mt-3.5 rounded-card border border-border bg-surface p-2 shadow-2xl",
          "motion-safe:animate-[nav-panel-in_140ms_ease-out]",
          align === "end" ? "right-0" : "left-0",
          panelClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
