import Link from "next/link";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand/constants";
import {
  ROSE_GEM_FACET_PATH,
  ROSE_GEM_PATH,
  ROSE_ORBIT_PIP,
  ROSE_RING,
  ROSE_STAR_PATH,
  ROSE_TICKS_PATH,
  ROSE_WAKE,
} from "@/lib/brand/geometry";

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
      {/* Astral Rose in the Deep Seal treatment — a compass-rose-astrolabe
          carved into a socket and raised in relief. Geometry comes from
          lib/brand; the gradient + SVG filters are web-only polish (Satori
          and favicons render the flat variant from lib/brand/glyph.tsx).
          Colors are literal brand hexes: gradients and filters can't take
          CSS variables. */}
      <span
        aria-hidden
        className="relative inline-flex h-8 w-8 items-center justify-center transition-transform group-hover:scale-105"
      >
        <svg viewBox="-2 -2 36 36" className="h-8 w-8" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            {/* userSpaceOnUse: objectBoundingBox gradients vanish on
                zero-width geometry like the tick strokes. */}
            <linearGradient id="pg-gold" gradientUnits="userSpaceOnUse" x1="5" y1="5" x2="27" y2="27">
              <stop offset="0%" stopColor={BRAND.goldLight} />
              <stop offset="100%" stopColor={BRAND.goldDeep} />
            </linearGradient>
            {/* Carved socket: dark inner edge at the top reads as chiseled. */}
            <filter id="pg-carve" x="-25%" y="-25%" width="150%" height="150%">
              <feOffset in="SourceAlpha" dx="0" dy="1.7" result="off" />
              <feGaussianBlur in="off" stdDeviation="1.5" result="blurred" />
              <feComposite operator="out" in="SourceAlpha" in2="blurred" result="strip" />
              <feFlood floodColor="#000000" floodOpacity="0.8" result="black" />
              <feComposite operator="in" in="black" in2="strip" result="shadow" />
              <feMerge>
                <feMergeNode in="SourceGraphic" />
                <feMergeNode in="shadow" />
              </feMerge>
            </filter>
            {/* Raised relief: bevel light from the upper-left + lift shadow. */}
            <filter id="pg-pop" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="0.7" result="blur" />
              <feSpecularLighting
                in="blur"
                surfaceScale="2.7"
                specularConstant="0.95"
                specularExponent="15"
                lightingColor="#ffe6b8"
                result="spec"
              >
                <feDistantLight azimuth="235" elevation="36" />
              </feSpecularLighting>
              <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
              <feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="lit" />
              <feDropShadow in="lit" dx="0.5" dy="1" stdDeviation="0.6" floodColor="#04070e" floodOpacity="0.9" />
            </filter>
          </defs>

          {/* Socket + gold rim */}
          <circle cx="16" cy="16" r="15.3" fill={BRAND.socket} filter="url(#pg-carve)" />
          <circle cx="16" cy="16" r="15.3" stroke="url(#pg-gold)" strokeWidth="0.9" opacity="0.8" />
          <path
            d="M29.25 23.65 A15.3 15.3 0 0 1 2.75 23.65"
            stroke={BRAND.goldLight}
            strokeWidth="0.7"
            opacity="0.16"
          />

          {/* The rose, raised */}
          <g filter="url(#pg-pop)" transform="translate(16 16) scale(0.88) translate(-16 -16)">
            <circle
              cx={ROSE_RING.cx}
              cy={ROSE_RING.cy}
              r={ROSE_RING.r}
              stroke="url(#pg-gold)"
              strokeWidth="0.9"
              opacity="0.55"
            />
            <path d={ROSE_TICKS_PATH} stroke="url(#pg-gold)" strokeWidth="0.9" opacity="0.7" />
            <path d={ROSE_STAR_PATH} fill="url(#pg-gold)" />
            <path d={ROSE_GEM_PATH} fill={BRAND.purpleDeep} stroke={BRAND.navy} strokeWidth="0.8" />
            <path d={ROSE_GEM_FACET_PATH} fill={BRAND.purple} />
            <circle
              cx={ROSE_ORBIT_PIP.cx}
              cy={ROSE_ORBIT_PIP.cy}
              r={ROSE_ORBIT_PIP.r}
              fill={BRAND.purpleDeep}
              stroke={BRAND.purple}
              strokeWidth="0.7"
            />
            {ROSE_WAKE.map((star) => (
              <circle
                key={`${star.cx}-${star.cy}`}
                cx={star.cx}
                cy={star.cy}
                r={star.r}
                fill={BRAND.goldLight}
                opacity="0.85"
              />
            ))}
          </g>
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
