import { cn } from "@/lib/utils";
import { CompassStar } from "@/components/ui/compass-star";

// ---------------------------------------------------------------------------
// StarfieldBackdrop — absolute decorative layer for heroes / auth cards:
// a tiled gold-dust dot field (.bg-starfield) plus, optionally, a few faint
// compass glyphs. Static — no animation, so no reduced-motion handling
// needed. Place inside a `relative` container; content stacks above it.
// ---------------------------------------------------------------------------

type StarfieldBackdropProps = {
  density?: "low" | "high";
  /** Scatter a few faint compass-star glyphs over the dot field. */
  withGlyphs?: boolean;
  className?: string;
};

export function StarfieldBackdrop({
  density = "low",
  withGlyphs = false,
  className,
}: StarfieldBackdropProps) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <div
        className={cn(
          "absolute inset-0 bg-starfield",
          density === "low" ? "opacity-50" : "opacity-90",
        )}
      />
      {withGlyphs ? (
        <>
          <CompassStar className="absolute left-[12%] top-[16%] h-6 w-6 text-gold/25" />
          <CompassStar className="absolute right-[9%] top-[34%] h-4 w-4 text-gold/20" />
          <CompassStar className="absolute bottom-[18%] left-[24%] h-5 w-5 text-gold/15" />
        </>
      ) : null}
    </div>
  );
}
