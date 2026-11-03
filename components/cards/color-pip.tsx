import { cn } from "@/lib/utils";
import { CardPip } from "@/components/cards/mana-cost-glyphs";
import { MANA_GEM_BG, manaGemSpec } from "@/lib/cards/mana-gem";
import { previewDiscShadowCss, symbolStyle } from "@/lib/cards/symbol-style";
import { COLOR_IDENTITY_LABELS, type ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// ColorPip / ColorPips — a card's or a deck's COLOURS on the site's UI (TODO
// UI1): deck tiles and the deck hero, the colour filters and chips (gallery,
// browse, My Cards, profiles), the /frames tiles' verified colours, the deck
// breakdown's colour rows, admin lists. ONE component, drawn from the card
// renderer's own pip art — CardPip over manaGemSpec (lib/cards/mana-gem.ts),
// the very description the preview and the bake draw a card's {W} with — in
// the "modern" symbol style (M15's discs and their hard offset shadow, as a
// card's cost row). Never a second set of symbol drawings, never a plain
// coloured circle: tests/unit/components/color-pip-surfaces.test.ts fails on
// one coming back on the surfaces it lists.
//
// The two colours a mana symbol doesn't name, decided ONCE here:
//
//   - COLOURLESS is the card's own {C}: the colourless diamond on the grey
//     disc (manaGemSpec("c")) — the symbol a colourless card's cost prints.
//   - MULTICOLOUR (gold) has no symbol of its own on a card. It is the
//     card's two-colour split disc (SPLIT_GEM: the disc's colours meeting on
//     straight edges, no drawing inside) taken to all five: one disc with
//     the five colours' own disc fills (MANA_GEM_BG) in WUBRG order,
//     clockwise from the top, the same size and shadow as every other pip.
//     It reads as "several colours" where a gold disc read as a coloured
//     dot, and it uses no colour the cards don't.
//
// Size is for UI, 16–20 px (`size`); the disc is drawn at those px so its
// glyph and shadow round there, as a card's do at the bake's. Each pip has
// an accessible name ("White", "Colorless", "Multicolor"); a row of them is
// ONE image named by its colours (ColorPips), or decorative (`decorative`)
// where the colours are already said in words beside it (a chip named
// "White", a row with its label).
//
// Server-safe: no hooks, no client state. Pages that draw it stay static.
// ---------------------------------------------------------------------------

/** A colour the UI can name: the five, colourless and multicolour (gold). */
export type PipColor = "W" | "U" | "B" | "R" | "G" | "C" | "M";

export const PIP_COLORS: readonly PipColor[] = ["W", "U", "B", "R", "G", "C", "M"];

/** UI sizes, px — 16 (dense rows, tiles), 18 (chips, lists), 20 (filters). */
export type ColorPipSize = 16 | 18 | 20;

const PIP_IDENTITY: Record<PipColor, ColorIdentity> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
  C: "colorless",
  M: "multicolor",
};

/** The accessible name of a colour's pip ("White", "Multicolor"). */
export function pipColorName(color: PipColor): string {
  return COLOR_IDENTITY_LABELS[PIP_IDENTITY[color]];
}

/** The pip colour of a colour identity word ("white" → "W"). */
export function pipColorOfIdentity(identity: ColorIdentity): PipColor {
  return (Object.keys(PIP_IDENTITY) as PipColor[]).find((c) => PIP_IDENTITY[c] === identity) ?? "C";
}

/** A letter or a frame colour key (w u b r g c m, any case) as a pip
 *  colour; null for anything else. */
export function toPipColor(value: string): PipColor | null {
  const upper = value.toUpperCase();
  return (PIP_COLORS as readonly string[]).includes(upper) ? (upper as PipColor) : null;
}

/** The mana-font suffix CardPip draws a colour with — the card's own
 *  symbol ("w"…"g", "c" = {C}); null for multicolour, which no card
 *  symbol names. */
export function pipSuffixOf(color: PipColor): string | null {
  return color === "M" ? null : color.toLowerCase();
}

/** The style every UI pip is drawn in: a card's cost row on the default
 *  ("modern") frame. */
const UI_SYMBOLS = symbolStyle(undefined);

/** The multicolour disc's fill: the five discs' own colours, WUBRG
 *  clockwise from the top, each a fifth (straight edges, as the split
 *  disc's). */
export const MULTICOLOR_PIP_BACKGROUND = (() => {
  const order = ["w", "u", "b", "r", "g"] as const;
  const stops = order.map((key, i) => `${MANA_GEM_BG[key]} ${i * 72}deg ${(i + 1) * 72}deg`);
  return `conic-gradient(${stops.join(", ")})`;
})();

/** The disc's diameter for the multicolour pip: the plain pip's
 *  (manaGemSpec's for {C}, which is a plain pip). */
function multicolorDisc(size: number) {
  const gem = manaGemSpec("c", size, UI_SYMBOLS);
  const boxShadow = previewDiscShadowCss(UI_SYMBOLS, gem.discPx, size);
  return (
    <span
      aria-hidden
      data-pip="multicolor"
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        width: "1em",
        height: "1em",
        borderRadius: "50%",
        background: MULTICOLOR_PIP_BACKGROUND,
        flexShrink: 0,
        ...(boxShadow ? { boxShadow } : {}),
      }}
    />
  );
}

/** The drawing alone (aria-hidden), in a box `size` px square. */
function PipDrawing({ color, size }: { color: PipColor; size: ColorPipSize }) {
  const suffix = pipSuffixOf(color);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center leading-none"
      style={{ fontSize: size, width: size, height: size }}
    >
      {suffix ? <CardPip suffix={suffix} discPx={size} symbols={UI_SYMBOLS} /> : multicolorDisc(size)}
    </span>
  );
}

/** ONE colour's pip, named by its colour ("White") — or decorative. */
export function ColorPip({
  color,
  size = 18,
  decorative = false,
  className,
}: {
  color: PipColor;
  size?: ColorPipSize;
  /** True where the colour is already in words beside it: no name. */
  decorative?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex shrink-0 align-middle", className)}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": pipColorName(color) })}
    >
      <PipDrawing color={color} size={size} />
    </span>
  );
}

/** A row of colours as ONE image, named by them ("White, Blue") — or by
 *  `label` when the surface says it differently ("Colors: White, Blue"). */
export function ColorPips({
  colors,
  size = 16,
  label,
  decorative = false,
  className,
}: {
  colors: readonly PipColor[];
  size?: ColorPipSize;
  label?: string;
  decorative?: boolean;
  className?: string;
}) {
  if (colors.length === 0) return null;
  const name = label ?? colors.map(pipColorName).join(", ");
  return (
    <span
      className={cn("inline-flex shrink-0 flex-wrap items-center gap-1 align-middle", className)}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
    >
      {colors.map((color, i) => (
        <PipDrawing key={`${color}-${i}`} color={color} size={size} />
      ))}
    </span>
  );
}

/** A frame colour key's pip (w u b r g c m, decorative — the key is said
 *  beside it); a key the pips don't name keeps the pip's room, blank. */
export function FrameKeyPip({ colorKey, size = 16 }: { colorKey: string; size?: ColorPipSize }) {
  const color = toPipColor(colorKey);
  if (color) return <ColorPip color={color} size={size} decorative />;
  return <span aria-hidden className="inline-block shrink-0" style={{ width: size, height: size }} />;
}
