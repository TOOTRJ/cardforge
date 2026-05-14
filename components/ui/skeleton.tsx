import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Skeleton — a placeholder rectangle with a left-to-right shimmer. Used as
// the fallback inside <Suspense> boundaries and as the inline "loading"
// state inside the Scryfall search dialog.
//
// Style:
//   - base color = elevated (sits on `surface` cards without seam)
//   - shimmer = soft white linear-gradient sweep
//   - `prefers-reduced-motion` kills the animation (CSS rule in globals.css)
// ---------------------------------------------------------------------------

type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  /** Pre-set shapes. `block` is the default rounded rectangle, `circle` is
   *  a perfect circle (useful for avatar placeholders), `text` is a thin
   *  rounded bar that matches typical text height. */
  shape?: "block" | "circle" | "text";
};

const SHAPE_CLASS: Record<NonNullable<SkeletonProps["shape"]>, string> = {
  block: "rounded-md",
  circle: "rounded-full",
  text: "h-3 rounded-sm",
};

export function Skeleton({
  shape = "block",
  className,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={cn("skeleton", SHAPE_CLASS[shape], className)}
      aria-hidden
      {...props}
    />
  );
}
