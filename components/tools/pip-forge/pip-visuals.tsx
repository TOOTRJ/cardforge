"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { CardPip } from "@/components/cards/mana-cost-glyphs";
import { symbolStyle } from "@/lib/cards/symbol-style";
import { cn } from "@/lib/utils";
import { LEGIBILITY_MIN } from "@/lib/tools/pip-forge/glyph";
import {
  inkFor,
  WHEEL_COLOUR_NAMES,
  wheelPlace,
  type Legibility,
  type WheelColour,
  type WheelGap,
} from "@/lib/tools/pip-forge/model";

// ---------------------------------------------------------------------------
// Pip Forge's pictures: the pip itself (its stored PNG, or — while a new disc
// colour is being tried — the stored glyph on that disc, drawn live as an
// SVG with no AI and no canvas), the pip at the sizes a card prints it, drawn
// by the card renderer's own CardPip beside the standard symbols, and the
// six-colour wheel its colour card places it on.
// ---------------------------------------------------------------------------

/** Every UI pip's style: a card's cost row on the default frame. */
const UI_SYMBOLS = symbolStyle(undefined);

/** A forged pip drawn live: `disc` filling the box, the glyph file (black on
 *  transparent, placed as on the stored pip) recoloured to the disc's ink by
 *  an SVG filter — the same disc, glyph and ink the server paints. */
export function PipDiscPreview({
  glyphUrl,
  disc,
  size,
  label,
  className,
}: {
  glyphUrl: string;
  disc: string;
  size: number;
  /** Null: decorative. */
  label: string | null;
  className?: string;
}) {
  const filterId = `pip-ink-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feFlood floodColor={inkFor(disc)} />
          <feComposite in2="SourceAlpha" operator="in" />
        </filter>
      </defs>
      <circle cx="256" cy="256" r="256" fill={disc} />
      <image href={glyphUrl} x="0" y="0" width="512" height="512" filter={`url(#${filterId})`} />
    </svg>
  );
}

/** One pip at `px` (a card's disc size): the stored file through CardPip —
 *  the element every card draws a custom pip with — or the live preview. */
function PipAt({ px, src, glyphUrl, disc }: { px: number; src: string | null; glyphUrl: string; disc: string }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center leading-none" style={{ fontSize: px, width: px, height: px }}>
      {src ? (
        <CardPip suffix="w" discPx={px} symbols={UI_SYMBOLS} overrideSrc={src} />
      ) : (
        <PipDiscPreview glyphUrl={glyphUrl} disc={disc} size={px} label={null} />
      )}
    </span>
  );
}

function StandardPip({ suffix, px }: { suffix: string; px: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center leading-none" style={{ fontSize: px, width: px, height: px }}>
      <CardPip suffix={suffix} discPx={px} symbols={UI_SYMBOLS} />
    </span>
  );
}

const SIZES = [
  { px: 16, key: "at16" as const, where: "In rules text and on small cards" },
  { px: 24, key: "at24" as const, where: "In a card's mana cost" },
];

/**
 * The legibility preview: the pip at 16 and 24 px in a cost row beside real
 * symbols, and the share of its shape that survives at each size (a pip is
 * only saved once both clear the bar).
 */
export function PipAtCardSize({
  src,
  glyphUrl,
  disc,
  legibility,
  name,
}: {
  /** The stored pip, or null while a new disc colour is being tried. */
  src: string | null;
  glyphUrl: string;
  disc: string;
  legibility: Legibility;
  name: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">At card size</span>
      <ul className="flex flex-col gap-2">
        {SIZES.map(({ px, key, where }) => {
          const score = legibility[key];
          const pass = score >= LEGIBILITY_MIN[key];
          return (
            <li key={px} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-[#f3ede0] px-3 py-2.5">
              <span className="w-12 shrink-0 font-mono text-xs text-[#5b4b33]">{px} px</span>
              <span
                role="img"
                aria-label={`${name} at ${px} pixels, in a cost of two generic, two ${name} and one blue`}
                className="flex items-center gap-[3px]"
              >
                <StandardPip suffix="2" px={px} />
                <PipAt px={px} src={src} glyphUrl={glyphUrl} disc={disc} />
                <PipAt px={px} src={src} glyphUrl={glyphUrl} disc={disc} />
                <StandardPip suffix="u" px={px} />
              </span>
              <span className="min-w-0 flex-1 text-xs text-[#5b4b33]">{where}</span>
              <span className={cn("inline-flex items-center gap-1 text-xs font-medium", pass ? "text-[#2f6b2a]" : "text-[#9a3412]")}>
                {pass ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                {Math.round(score * 100)}% of the shape kept
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs leading-5 text-muted">
        Every pip is checked at both sizes before it&apos;s saved; thin lines are thickened until it reads.
      </p>
    </div>
  );
}

const WHEEL_BOX = 220;
const WHEEL_R = 82;

function at(index: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / 6;
  return { x: WHEEL_BOX / 2 + WHEEL_R * Math.cos(angle), y: WHEEL_BOX / 2 + WHEEL_R * Math.sin(angle) };
}

/** The six-colour wheel: the five where they always sit, the new colour in
 *  its gap, lines to its allies (solid), enemies (dashed) and opposite
 *  (dotted). Decorative — the colour card says the same in words. */
export function ColourWheel({
  gap,
  pipSrc,
  glyphUrl,
  disc,
}: {
  gap: WheelGap;
  pipSrc: string | null;
  glyphUrl: string;
  disc: string;
}) {
  const place = wheelPlace(gap);
  const x = at(place.order.indexOf("X"));
  const line = (colour: WheelColour, kind: "ally" | "enemy" | "opposite") => {
    const p = at(place.order.indexOf(colour));
    return (
      <line
        key={`${kind}-${colour}`}
        x1={x.x}
        y1={x.y}
        x2={p.x}
        y2={p.y}
        strokeWidth={kind === "ally" ? 2.5 : 1.75}
        strokeLinecap="round"
        strokeDasharray={kind === "enemy" ? "6 5" : kind === "opposite" ? "1.5 5" : undefined}
        className={kind === "ally" ? "stroke-gold" : "stroke-ember"}
      />
    );
  };
  return (
    <div aria-hidden className="relative mx-auto shrink-0" style={{ width: WHEEL_BOX, height: WHEEL_BOX }}>
      <svg viewBox={`0 0 ${WHEEL_BOX} ${WHEEL_BOX}`} width={WHEEL_BOX} height={WHEEL_BOX} className="absolute inset-0">
        <circle cx={WHEEL_BOX / 2} cy={WHEEL_BOX / 2} r={WHEEL_R} fill="none" strokeWidth={1} className="stroke-border" />
        {place.allies.map((c) => line(c, "ally"))}
        {place.enemies.map((c) => line(c, "enemy"))}
        {line(place.opposite, "opposite")}
      </svg>
      {place.order.map((colour, index) => {
        const p = at(index);
        const isNew = colour === "X";
        const px = isNew ? 40 : 28;
        return (
          <span
            key={colour}
            className={cn(
              "absolute flex items-center justify-center rounded-full",
              isNew && "ring-2 ring-gold ring-offset-2 ring-offset-surface",
            )}
            style={{ left: p.x - px / 2, top: p.y - px / 2, width: px, height: px }}
          >
            {isNew ? (
              pipSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pipSrc} alt="" width={px} height={px} className="rounded-full" />
              ) : (
                <PipDiscPreview glyphUrl={glyphUrl} disc={disc} size={px} label={null} />
              )
            ) : (
              <StandardPip suffix={colour.toLowerCase()} px={px} />
            )}
          </span>
        );
      })}
    </div>
  );
}

/** "Green and White" — the words beside the wheel. */
export function colourList(colours: readonly WheelColour[]): string {
  const names = colours.map((c) => WHEEL_COLOUR_NAMES[c]);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
