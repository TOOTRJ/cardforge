import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// IconTile — square tile with a thin colored border and matching icon
// stroke; the feature-tile pattern from the PipGlyph mockups. Pass a lucide
// icon (or any svg) as children.
// ---------------------------------------------------------------------------

const iconTileVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-lg border bg-surface/60 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        gold: "border-gold/40 text-gold-strong",
        purple: "border-primary/50 text-primary-bright",
        ember: "border-ember/45 text-ember",
      },
      size: {
        md: "h-10 w-10 [&_svg]:size-5",
        lg: "h-12 w-12 [&_svg]:size-6",
      },
    },
    defaultVariants: {
      tone: "gold",
      size: "md",
    },
  },
);

type IconTileProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof iconTileVariants>;

export function IconTile({ className, tone, size, ...props }: IconTileProps) {
  return (
    <span className={cn(iconTileVariants({ tone, size }), className)} {...props} />
  );
}
