"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// InfoTip — a "what's this?" box (a toggletip) for the deck page's help
// (TODO DK11): the total mana value, the boards, every part of the
// breakdown, the format check's list. ONE component, three ways in:
//
//   * a mouse that RESTS on the trigger shows the box (and keeps it while
//     the pointer crosses into it — its links are clickable); it goes when
//     the pointer leaves both;
//   * a KEYBOARD focus on the trigger shows it too (`:focus-visible` — a
//     click's focus is the click's), and it goes when the focus moves on;
//   * a press (click, Enter, Space) PINS it and moves the focus into it —
//     the way a keyboard or screen-reader user reaches a link inside —
//     and Escape, a click outside or a second press closes it, the focus
//     back on the trigger.
//
// The box is Radix's popover in a portal, so a parent's `overflow: hidden`
// (the summary bar's one line) never clips it. The trigger is a real
// button with its own name (`label`) and aria-expanded; the box is a
// non-modal dialog named the same. Opened by a hover or a focus it takes no
// focus and returns none: a box that came and went on its own never moves
// the reader.
// ---------------------------------------------------------------------------

const REST_MS = 150;
const LEAVE_MS = 150;

function isKeyboardFocus(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    // An engine without :focus-visible: a focus is a keyboard's.
    return true;
  }
}

export function InfoTip({
  label,
  children,
  trigger,
  triggerClassName,
  className,
  side = "top",
  align = "center",
}: {
  /** The trigger's accessible name and the box's ("About total mana value"). */
  label: string;
  /** What the box says. */
  children: ReactNode;
  /** What the trigger shows; an "i" icon when left out (then `label` is its
   *  only name — keep it a phrase). */
  trigger?: ReactNode;
  triggerClassName?: string;
  /** The box's own classes (its width). */
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  /** The focus is coming back to the trigger from a closed box: no peek. */
  const returning = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const later = (ms: number, run: () => void) => {
    cancel();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      run();
    }, ms);
  };
  const close = () => {
    cancel();
    setOpen(false);
  };
  const leave = () => {
    if (!pinned.current) later(LEAVE_MS, () => setOpen(false));
  };
  const focusInside = () => {
    const box = contentRef.current;
    if (!box) return;
    (box.querySelector<HTMLElement>("a[href], button:not([disabled])") ?? box).focus({ preventScroll: true });
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        cancel();
        setOpen(false);
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={trigger ? undefined : label}
          // The "i" is a 24 × 24 px target (WCAG 2.5.8) that takes the
          // 20 px it always took in the line: the -0.5 margin hands the
          // extra back, so nothing beside it moves.
          className={cn(
            trigger
              ? "inline-flex items-center gap-1.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
              : "-m-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-subtle transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 data-[state=open]:text-primary-bright",
            triggerClassName,
          )}
          onPointerEnter={(event) => {
            if (event.pointerType !== "mouse" || pinned.current) return;
            if (open) cancel();
            else later(REST_MS, () => setOpen(true));
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") leave();
          }}
          onFocus={(event) => {
            if (returning.current) {
              returning.current = false;
              return;
            }
            if (open || !isKeyboardFocus(event.currentTarget)) return;
            cancel();
            pinned.current = false;
            setOpen(true);
          }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (pinned.current || (next && contentRef.current?.contains(next))) return;
            close();
          }}
          onClick={(event) => {
            // Ours, not Radix's toggle: a press pins a box a hover opened.
            event.preventDefault();
            cancel();
            if (open && pinned.current) {
              pinned.current = false;
              setOpen(false);
              return;
            }
            pinned.current = true;
            if (open) requestAnimationFrame(focusInside);
            else setOpen(true);
          }}
        >
          {trigger ?? <Info className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={contentRef}
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (pinned.current) requestAnimationFrame(focusInside);
          }}
          onCloseAutoFocus={(event) => {
            const wasPinned = pinned.current;
            pinned.current = false;
            const active = document.activeElement;
            // A hover's or a focus's box returns nothing; nor does one left
            // for somewhere the reader chose (a link it held).
            if (!wasPinned || (active && active !== document.body && active !== triggerRef.current)) {
              event.preventDefault();
              return;
            }
            // Radix hands the focus back: that focus is no keyboard's peek.
            if (active !== triggerRef.current) {
              returning.current = true;
              window.setTimeout(() => {
                returning.current = false;
              }, 0);
            }
          }}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") cancel();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") leave();
          }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && (contentRef.current?.contains(next) || next === triggerRef.current)) return;
            if (!pinned.current) close();
          }}
          className={cn(
            "z-50 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-surface p-3 text-xs leading-5 text-muted shadow-xl",
            "focus-visible:outline-none",
            className,
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
