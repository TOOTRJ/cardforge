# Chunk 02 — Mana Glyph Expansion

## Goal

Make `<ManaCostGlyphs>` first-class with the full Magic mana vocabulary.
Today it renders single-color (`{W}`, `{U}`, `{B}`, `{R}`, `{G}`) and
numeric generic (`{2}`, `{10}`) as gem circles, and falls back to a flat
colorless gem for anything else (hybrid, Phyrexian, tap, snow). Real
Scryfall imports surface those tokens regularly — without coverage,
imported costs read as washed-out grey blobs.

## Scope

In scope:
- Hybrid two-color tokens: `{W/U}`, `{U/B}`, `{B/R}`, `{R/G}`, `{G/W}`,
  `{W/B}`, `{U/R}`, `{B/G}`, `{R/W}`, `{G/U}`
- Hybrid color + generic: `{2/W}`, `{2/U}`, `{2/B}`, `{2/R}`, `{2/G}`
- Phyrexian: `{W/P}`, `{U/P}`, `{B/P}`, `{R/P}`, `{G/P}`, `{C/P}`
- Tap / untap: `{T}`, `{Q}`
- Snow: `{S}`
- Colorless explicit: `{C}`

Out of scope:
- Mana shorthand outside the curly-brace tokens.
- Animated glyphs (just static gradients + SVG paths).
- The standalone `<TapSymbol>` outside ManaCostGlyphs.

## Files to add / modify

- Modify: `components/cards/mana-cost-glyphs.tsx`
  - Extend `tokenize()` to recognize hybrid (`X/Y`), Phyrexian (`X/P`),
    and special single-char tokens (`T`, `Q`, `S`, `C`).
  - Add a `HybridGem` sub-component using a conic-gradient with a 45° split.
  - Add a `PhyrexianGem` sub-component layering a `φ` glyph over the
    base color.
  - Add a `SymbolGem` for `T` / `Q` / `S` with inline SVG paths.
- Optional: tiny `tokenizer.test.ts` checking edge cases.

## Implementation approach

- The tokenizer returns a discriminated union now:
  `{ kind: "solid" | "hybrid" | "phyrexian" | "symbol" | "text" }`.
- The renderer switches on `kind` and picks the right sub-component.
- For hybrid, the split is a `conic-gradient(from 225deg, <left> 50%, <right> 50%)`.
- For Phyrexian, the inner content is the unicode `ϕ` (U+03D5) on top of the
  base color's gradient.
- For Tap, render a curved-arrow SVG ↺; for Untap, ↻; for Snow, a small
  six-armed snowflake SVG.

## Acceptance criteria

- `{W/U}` renders a half-white / half-blue circle (white top-right).
- `{2/W}` renders "2W" overlaid on the hybrid mix.
- `{R/P}` shows the φ symbol on a red gem.
- `{T}` shows the tap arrow.
- `{S}` shows the snowflake.
- All tokens are ≥12px and remain legible.
- Sizes `sm` / `md` / `lg` all render correctly for the new tokens.
- Used inside the card preview, the cost input live preview, and the
  Scryfall search rows.

## Dependencies

None — pure cosmetic chunk. Safe to do before chunk 01.

## Estimated effort

~1.5 hours.

## Done when

A test card with cost `{T},{2/W},{R/P},{S}` renders four distinct,
recognizable glyphs in the editor preview, the gallery, and the Scryfall
import dialog.
