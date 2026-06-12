import Link from "next/link";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  href?: string;
  showWordmark?: boolean;
};

export function Logo({ className, href = "/", showWordmark = true }: LogoProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex items-center gap-2.5 font-semibold tracking-tight",
        className,
      )}
      aria-label="PipGlyph home"
    >
      {/* Compass-star mark — a precision instrument pointing every direction,
          drawn with literal brand hexes so it reads identically on both
          themes (gradients can't take CSS variables as stops). */}
      <span
        aria-hidden
        className="relative inline-flex h-8 w-8 items-center justify-center transition-transform group-hover:scale-105"
      >
        <svg
          viewBox="0 0 32 32"
          className="h-8 w-8 drop-shadow-[0_0_10px_rgba(216,178,110,0.45)]"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="pg-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ecca8a" />
              <stop offset="100%" stopColor="#b8904a" />
            </linearGradient>
          </defs>
          {/* Ring */}
          <circle
            cx="16"
            cy="16"
            r="13.5"
            stroke="url(#pg-gold)"
            strokeWidth="1.1"
            opacity="0.55"
          />
          {/* Cardinal compass star */}
          <path
            d="M16 3.4 L18.3 13.7 L28.6 16 L18.3 18.3 L16 28.6 L13.7 18.3 L3.4 16 L13.7 13.7 Z"
            fill="url(#pg-gold)"
          />
          {/* Ordinal ticks — purple, the precision accents */}
          <path
            d="M22.2 9.8 L24.4 7.6 M9.8 22.2 L7.6 24.4 M22.2 22.2 L24.4 24.4 M9.8 9.8 L7.6 7.6"
            stroke="#8e72c9"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.85"
          />
        </svg>
      </span>

      {showWordmark ? (
        <span className="font-display text-lg leading-none tracking-wider text-foreground">
          PipGlyph
        </span>
      ) : null}
    </Link>
  );
}
