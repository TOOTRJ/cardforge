"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentPropsWithoutRef, ComponentRef } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Popover — thin wrapper over @radix-ui/react-popover with the shadcn API
// surface. Used by later chunks (08 bulk actions confirm, 13 source chip,
// future per-card menus). Not consumed anywhere yet — this primitive is
// staged for chunks that depend on it.
// ---------------------------------------------------------------------------

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const PopoverContent = forwardRef<
  ComponentRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border border-border bg-surface p-3 text-sm shadow-xl",
        // Same data-state fade pattern the Dialog uses.
        "transition-[opacity,transform] duration-150 ease-out",
        "data-[state=open]:opacity-100 data-[state=closed]:opacity-0",
        "data-[state=closed]:scale-95",
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;
