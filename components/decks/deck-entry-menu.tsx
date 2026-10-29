"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The deck page's action menus (TODO DK5.4) — a row's "⋯", the preview
// pane's and the bottom sheet's "Move to", the bulk bar's, and the menu the
// M key opens on a focused card. ONE menu, built the WAI-ARIA menu-button
// way on Radix's popover (focus moved in on open, Escape and a click
// outside close it, the focus back where it came from):
//
//   * role="menu" with menuitem / menuitemradio items (a board is a radio:
//     the card's own board is checked), a separator between groups;
//   * ↑ ↓ move between items (wrapping), Home / End to the ends, Enter or
//     Space picks, Tab closes; a menu opens on its checked item, else the
//     first;
//   * an item that can't be picked is aria-disabled (reachable, its reason
//     in its name) and does nothing — never `disabled`.
//
// It opens from its own trigger, or — the M key on a card in the Stacks
// and Grid views, which have no "⋯" — at an element of the page
// (`anchor`): closed, the focus goes back to that element.
// ---------------------------------------------------------------------------

export type MenuItem =
  | {
      kind: "radio";
      label: string;
      checked: boolean;
      onSelect: () => void;
      disabled?: string;
    }
  | {
      kind: "item";
      label: string;
      icon?: ReactNode;
      /** A link (the creator); otherwise `onSelect`. */
      href?: string;
      onSelect?: () => void;
      danger?: boolean;
      disabled?: string;
      /** The key that does the same, shown at the end. */
      shortcut?: string;
    }
  | { kind: "separator" }
  | { kind: "heading"; label: string };

type TriggerProps = {
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
};

type EntryMenuProps = {
  /** The menu's name ("Move Sol Ring", "Sol Ring: actions"). */
  label: string;
  items: MenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control that opens it (rendered as the popover's trigger). */
  trigger?: ReactNode;
  /** …or the element it opens at (no trigger of its own). */
  anchor?: RefObject<HTMLElement | null>;
  /** Where the focus goes once it closes after a pick that took its
   *  trigger away (a removal); left out: back to the trigger / anchor. */
  onCloseAutoFocus?: (event: Event) => void;
  align?: "start" | "end" | "center";
  side?: "top" | "bottom";
};

const ITEM_CLASS =
  "flex w-full min-h-9 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-foreground outline-none transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:ring-2 focus-visible:ring-primary-bright/50 aria-disabled:cursor-not-allowed aria-disabled:text-subtle pointer-coarse:min-h-11";

export function EntryMenu({ label, items, open, onOpenChange, trigger, anchor, onCloseAutoFocus, align = "end", side = "bottom" }: EntryMenuProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const triggerOf = () => (typeof document === "undefined" ? null : document.querySelector<HTMLElement>(`[data-menu-trigger="${menuId}"]`));
  const itemsOf = () => Array.from(contentRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = itemsOf();
    const from = list.indexOf(document.activeElement as HTMLElement);
    let to: number | null = null;
    if (event.key === "ArrowDown") to = from < 0 ? 0 : (from + 1) % list.length;
    else if (event.key === "ArrowUp") to = from < 0 ? list.length - 1 : (from - 1 + list.length) % list.length;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = list.length - 1;
    else if (event.key === "Tab") {
      // A menu is one stop: Tab leaves it (closed).
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (to === null || list.length === 0) return;
    event.preventDefault();
    list[to]?.focus();
  };

  const pick = (item: Extract<MenuItem, { kind: "radio" | "item" }>) => {
    if (item.disabled) return;
    onOpenChange(false);
    if (item.kind === "radio" || !item.href) item.onSelect?.();
  };

  // The trigger is the menu's own button: aria-haspopup="menu" (Radix's
  // Popover.Trigger would say "dialog"), its expanded state, the menu it
  // controls; ↓ / ↑ on it open the menu as a click does.
  const ownTrigger = isValidElement<TriggerProps>(trigger)
    ? cloneElement(trigger, {
        "data-menu-trigger": menuId,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
        onClick: (event: MouseEvent<HTMLElement>) => {
          trigger.props.onClick?.(event);
          if (!event.defaultPrevented) onOpenChange(!open);
        },
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          trigger.props.onKeyDown?.(event);
          if (event.defaultPrevented || open) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            onOpenChange(true);
          }
        },
      } as Partial<TriggerProps>)
    : null;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {ownTrigger ? <PopoverPrimitive.Anchor asChild>{ownTrigger}</PopoverPrimitive.Anchor> : null}
      {anchor ? <PopoverPrimitive.Anchor virtualRef={anchor as RefObject<HTMLElement>} /> : null}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={contentRef}
          id={menuId}
          role="menu"
          aria-label={label}
          // A press on the trigger toggles it (never closed by the press and
          // opened again by its click).
          onInteractOutside={(event) => {
            if (triggerOf()?.contains(event.target as Node)) event.preventDefault();
          }}
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={12}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(event) => {
            // The checked board, else the first item.
            event.preventDefault();
            const list = itemsOf();
            (list.find((el) => el.getAttribute("aria-checked") === "true") ?? list[0])?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (onCloseAutoFocus) {
              onCloseAutoFocus(event);
              return;
            }
            const back = anchor?.current ?? triggerOf();
            if (back && back.isConnected) {
              event.preventDefault();
              back.focus();
            }
          }}
          className={cn(
            "z-50 flex min-w-52 max-w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-0.5 rounded-md border border-border bg-surface p-1 text-sm shadow-xl",
            "transition-[opacity,transform] duration-150 ease-out data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
          )}
        >
          {items.map((item, index) => {
            if (item.kind === "separator") return <div key={`s${index}`} role="separator" className="my-1 h-px bg-border/70" />;
            if (item.kind === "heading") {
              return (
                <div key={`h${index}`} role="presentation" className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
                  {item.label}
                </div>
              );
            }
            const common = {
              "data-menu-item": "",
              tabIndex: -1,
              "aria-disabled": item.disabled ? true : undefined,
              title: item.disabled,
            } as const;
            if (item.kind === "radio") {
              return (
                <button
                  key={`r${index}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={item.checked}
                  {...common}
                  onClick={() => pick(item)}
                  className={ITEM_CLASS}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                    {item.checked ? <Check className="h-3.5 w-3.5 text-primary-bright" /> : null}
                  </span>
                  {item.label}
                </button>
              );
            }
            const body = (
              <>
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted" aria-hidden>
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">{item.label}</span>
                {item.shortcut ? (
                  <kbd aria-hidden className="ml-3 rounded border border-border px-1 font-mono text-[10px] text-subtle">
                    {item.shortcut}
                  </kbd>
                ) : null}
              </>
            );
            const className = cn(ITEM_CLASS, item.danger && "text-danger hover:text-danger focus-visible:text-danger");
            if (item.href && !item.disabled) {
              return (
                <Link key={`i${index}`} href={item.href} role="menuitem" {...common} onClick={() => pick(item)} className={className}>
                  {body}
                </Link>
              );
            }
            return (
              <button
                key={`i${index}`}
                type="button"
                role="menuitem"
                {...common}
                aria-keyshortcuts={item.shortcut}
                onClick={() => pick(item)}
                className={className}
              >
                {body}
              </button>
            );
          })}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
