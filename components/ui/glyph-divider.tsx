import { cn } from "@/lib/utils";
import { CompassStar } from "@/components/ui/compass-star";

// ---------------------------------------------------------------------------
// GlyphDivider — a gold hairline that fades at both ends, optionally
// interrupted by a centered brand glyph. Purely decorative.
// ---------------------------------------------------------------------------

type GlyphDividerProps = {
  glyph?: "compass" | "diamond" | "none";
  className?: string;
};

export function GlyphDivider({ glyph = "compass", className }: GlyphDividerProps) {
  if (glyph === "none") {
    return <hr aria-hidden className={cn("divider-gold w-full", className)} />;
  }
  return (
    <div aria-hidden className={cn("flex w-full items-center gap-3", className)}>
      <span className="divider-gold flex-1" />
      {glyph === "compass" ? (
        <CompassStar className="h-3.5 w-3.5 text-gold" />
      ) : (
        <span className="h-1.5 w-1.5 rotate-45 bg-gold/70" />
      )}
      <span className="divider-gold flex-1" />
    </div>
  );
}
