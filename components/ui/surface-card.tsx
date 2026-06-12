import { cn } from "@/lib/utils";

type SurfaceCardProps = React.HTMLAttributes<HTMLDivElement> & {
  as?: React.ElementType;
  /** "gold" draws the thin gold border from the PipGlyph panel pattern. */
  tone?: "default" | "gold";
};

export function SurfaceCard({
  className,
  as: Component = "div",
  tone = "default",
  ...props
}: SurfaceCardProps) {
  return (
    <Component
      className={cn(
        "rounded-xl border bg-surface/80 backdrop-blur-sm shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]",
        tone === "gold" ? "border-gold/40" : "border-border/70",
        className,
      )}
      {...props}
    />
  );
}
