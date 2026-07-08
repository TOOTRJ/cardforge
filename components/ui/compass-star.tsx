import { cn } from "@/lib/utils";
import {
  MARK_VIEWBOX,
  ROSE_ORBIT_PIP,
  ROSE_RING,
  ROSE_STAR_CUT_PATH,
} from "@/lib/brand/geometry";

// ---------------------------------------------------------------------------
// CompassStar — the PipGlyph brand glyph in one-color form: the Astral Rose
// reduced to ring, quill-curved star (gem cut out), and orbit pip. Drawn in
// code so it scales crisply anywhere from a 12px divider accent to the
// header logo. Colors come from `currentColor`, so callers control tone via
// text-* utilities (text-gold, text-primary-bright, ...).
//
// Decorative by default (aria-hidden); pass `role="img"` + `aria-label`
// when it stands alone as meaningful content.
// ---------------------------------------------------------------------------

type CompassStarProps = React.SVGProps<SVGSVGElement>;

export function CompassStar({ className, ...props }: CompassStarProps) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={cn("h-4 w-4", className)}
      {...props}
    >
      <circle
        cx={ROSE_RING.cx}
        cy={ROSE_RING.cy}
        r={ROSE_RING.r}
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.5"
      />
      <path d={ROSE_STAR_CUT_PATH} fill="currentColor" fillRule="evenodd" />
      <circle
        cx={ROSE_ORBIT_PIP.cx}
        cy={ROSE_ORBIT_PIP.cy}
        r={ROSE_ORBIT_PIP.r}
        fill="currentColor"
        opacity="0.8"
      />
    </svg>
  );
}
