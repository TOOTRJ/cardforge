"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentPropsWithoutRef, ComponentRef, HTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Dialog — thin wrapper over @radix-ui/react-dialog with the shadcn API
// surface. Replaces the hand-rolled modal pattern previously copied into
// each dialog (DeleteCardDialog, ScryfallImportDialog).
//
// Wins over the hand-rolled version:
//   - real focus trap (Tab cycles inside the dialog, no escape until close)
//   - inert background (assistive tech ignores the rest of the page)
//   - portal-rendered (stacks above any nested overflow:hidden)
//   - automatic aria-labelledby / aria-describedby wiring
//   - Esc + click-outside handling is upstream-tested
//
// Style: matches the project's surface/border/backdrop tokens.
// ---------------------------------------------------------------------------

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = forwardRef<
  ComponentRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-background/70 backdrop-blur-sm",
      // Radix sets data-state on the overlay; we hook a simple fade onto it
      // so opening/closing has a soft transition without a motion library.
      "transition-opacity duration-150 ease-out",
      "data-[state=open]:opacity-100 data-[state=closed]:opacity-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  /** When true, the close X button in the corner is hidden — use this when
   *  the dialog supplies its own close affordance (e.g. a header). */
  hideCloseButton?: boolean;
  /** Sizes: default is comfortable for a small confirm; "lg" is for the
   *  Scryfall import; "xl" for future content-heavy modals. */
  size?: "sm" | "md" | "lg" | "xl";
};

const SIZE_CLASS: Record<NonNullable<DialogContentProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-5xl",
  xl: "max-w-6xl",
};

export const DialogContent = forwardRef<
  ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideCloseButton, size = "md", ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 flex w-full translate-x-[-50%] translate-y-[-50%] flex-col",
        "max-h-[85vh] overflow-hidden border border-border bg-surface shadow-2xl",
        "rounded-xl",
        // Simple fade+scale via CSS transition. The closed-state classes
        // apply just before unmount, so this is best-effort exit animation;
        // entry is smooth.
        "transition-[opacity,transform] duration-200 ease-out",
        "data-[state=open]:opacity-100 data-[state=closed]:opacity-0",
        "data-[state=closed]:scale-95",
        "focus-visible:outline-none",
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      {children}
      {hideCloseButton ? null : (
        <DialogPrimitive.Close
          aria-label="Close"
          className={cn(
            "absolute right-3 top-3 rounded-md p-1 text-muted transition-colors",
            "hover:bg-elevated hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          )}
        >
          <X className="h-4 w-4" aria-hidden />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export function DialogHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-b border-border/60 px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 border-t border-border/60 px-5 py-3 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export const DialogTitle = forwardRef<
  ComponentRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "font-display text-lg font-semibold tracking-tight text-foreground",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = forwardRef<
  ComponentRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-xs leading-5 text-muted", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
