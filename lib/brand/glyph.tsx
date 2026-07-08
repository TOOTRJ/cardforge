// ---------------------------------------------------------------------------
// Satori-safe Astral Rose renders, shared by app/icon.tsx and every OG image
// route. Rules baked in (Satori/next-og cannot handle more):
//   - flat literal colors only — no CSS variables, classes, or gradients
//   - no <defs>/<filter> — the etched/relief treatments are web-only
//   - every multi-child <div> declares display:flex
// The gradient + relief version of the mark lives in
// components/layout/logo.tsx, built from the same lib/brand geometry.
// ---------------------------------------------------------------------------

import { BRAND } from "./constants";
import {
  MARK_VIEWBOX,
  ROSE_GEM_FACET_PATH,
  ROSE_GEM_PATH,
  ROSE_ORBIT_PIP,
  ROSE_RING,
  ROSE_STAR_PATH,
  ROSE_TICKS_PATH,
  ROSE_WAKE,
} from "./geometry";

type AstralRoseProps = {
  size?: number;
  /** "compact" drops the ticks and star wake — sub-pixel noise below ~40px
   *  (favicons); "full" is the complete astrolabe. */
  detail?: "full" | "compact";
};

export function AstralRose({ size = 32, detail = "full" }: AstralRoseProps) {
  const full = detail === "full";
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx={ROSE_RING.cx}
        cy={ROSE_RING.cy}
        r={ROSE_RING.r}
        stroke={BRAND.gold}
        strokeWidth={full ? 0.9 : 1.2}
        opacity={0.55}
      />
      {full ? (
        <path
          d={ROSE_TICKS_PATH}
          stroke={BRAND.gold}
          strokeWidth={0.9}
          opacity={0.7}
        />
      ) : null}
      <path d={ROSE_STAR_PATH} fill={BRAND.gold} />
      <path
        d={ROSE_GEM_PATH}
        fill={BRAND.purpleDeep}
        stroke={BRAND.navy}
        strokeWidth={0.8}
      />
      <path d={ROSE_GEM_FACET_PATH} fill={BRAND.purple} />
      <circle
        cx={ROSE_ORBIT_PIP.cx}
        cy={ROSE_ORBIT_PIP.cy}
        r={ROSE_ORBIT_PIP.r}
        fill={BRAND.purpleDeep}
        stroke={BRAND.purple}
        strokeWidth={0.7}
      />
      {full
        ? ROSE_WAKE.map((star) => (
            <circle
              key={`${star.cx}-${star.cy}`}
              cx={star.cx}
              cy={star.cy}
              r={star.r}
              fill={BRAND.goldLight}
              opacity={0.85}
            />
          ))
        : null}
    </svg>
  );
}

/** Squared ink chip carrying the rose — the OG-image lockup tile. */
export function BrandMarkTile({
  size = 56,
  markSize,
}: {
  size?: number;
  markSize?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BRAND.ink,
        borderRadius: Math.round(size * 0.21),
        border: `2px solid ${BRAND.gold}`,
      }}
    >
      <AstralRose size={markSize ?? Math.round(size * 0.62)} />
    </div>
  );
}
