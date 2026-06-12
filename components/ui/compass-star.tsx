import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CompassStar — the PipGlyph brand glyph: a four-point compass star with
// diagonal ticks inside a thin circle. Drawn in code (like the old pentagon
// mark) so it scales crisply anywhere from a 12px divider accent to the
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
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={cn("h-4 w-4", className)}
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="10.25"
        stroke="currentColor"
        strokeWidth="0.9"
        opacity="0.45"
      />
      {/* Cardinal star */}
      <path
        d="M12 2.6 L13.7 10.3 L21.4 12 L13.7 13.7 L12 21.4 L10.3 13.7 L2.6 12 L10.3 10.3 Z"
        fill="currentColor"
      />
      {/* Ordinal ticks */}
      <path
        d="M16.6 7.4 L18.2 5.8 M7.4 16.6 L5.8 18.2 M16.6 16.6 L18.2 18.2 M7.4 7.4 L5.8 5.8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}
