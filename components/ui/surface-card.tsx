import { cn } from "@/lib/utils";

type SurfaceCardProps = React.HTMLAttributes<HTMLDivElement> & {
  as?: React.ElementType;
};

export function SurfaceCard({
  className,
  as: Component = "div",
  ...props
}: SurfaceCardProps) {
  return (
    <Component
      className={cn(
        "rounded-xl border border-border/70 bg-surface/80 backdrop-blur-sm shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]",
        className,
      )}
      {...props}
    />
  );
}
