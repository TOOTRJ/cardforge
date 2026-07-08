# PipGlyph palette — full reference

Source of truth: `app/globals.css` (`@theme` = dark default,
`:root[data-theme="light"]` = light overrides) and `lib/brand/constants.ts`
(sRGB literals for contexts that can't read CSS variables). If this file ever
disagrees with those, trust the code and update this file.

## Dark theme (the brand's home)

| Token | Value | sRGB anchor | Use |
| --- | --- | --- | --- |
| `--color-background` | `oklch(0.18 0.03 262)` | `#0d1320` | page ground |
| `--color-surface` | `oklch(0.23 0.03 262)` | `#1a2030` | cards, panels |
| `--color-elevated` | `oklch(0.28 0.032 262)` | — | raised chrome |
| `--color-border` | `oklch(0.33 0.034 262)` | `#2a3346` | hairlines |
| `--color-foreground` | `oklch(0.96 0.005 262)` | `#f2f3f5` | text |
| `--color-muted` | `oklch(0.72 0.018 262)` | `#9aa3b5` | secondary text |
| `--color-subtle` | `oklch(0.62 0.02 262)` | — | tertiary/labels |
| `--color-primary` | `oklch(0.5 0.13 300)` | `#6b4d9a` | CTA fills (light text on top) |
| `--color-primary-bright` | `oklch(0.7 0.11 300)` | `#8e72c9` | purple TEXT/icons/focus |
| `--color-gold` / `--color-accent` | `oklch(0.78 0.09 84)` | `#d8b26e` | gold accents, borders |
| `--color-gold-strong` | `oklch(0.84 0.1 84)` | — | gold emphasis |
| `--color-ember` | `oklch(0.64 0.16 47)` | — | third accent (sparing) |

Gold gradient (web logo, exports): `#ecca8a → #b8904a` at 135°.
Deep Seal socket floor: `#0a0e17` (`BRAND.socket`). Medallion/OG chip face:
`#10151f` (`BRAND.ink`). Headline-gradient midpoint: `#b794e6` (`BRAND.lilac`).
OG footer bronze: `#6e6248` (`BRAND.bronze`).

## Light theme (post-PR #174 contrast fixes)

Do not derive light values by lightening dark ones — they were measured for
WCAG 4.5:1. Key deviations:

| Token | Light value | Note |
| --- | --- | --- |
| `--color-primary` | `oklch(0.45 0.14 300)` | fill-strength (9.3:1 vs bg) |
| `--color-primary-bright` | `oklch(0.4 0.15 300)` | TEXT-strength — same contract as dark, inverted |
| `--color-gold` | `oklch(0.52 0.11 84)` | ≥4.5:1 on light bg + surface |
| `--color-gold-strong` | `oklch(0.47 0.11 84)` | |
| `--color-accent` | `oklch(0.6 0.11 84)` | ⚠ known open item: `text-accent` on light ≈ 3.76:1 — prefer `text-gold` for gold TEXT on light |

Rule of thumb: `-bright` tokens are for text, base tokens for fills — in both
themes. Gold is an accent, not a background; the only gold-filled surfaces are
the mark itself and small chips with navy content.

## Mana palette (WUBRG)

`MANA_HEX` in `lib/brand/constants.ts` — canvas-measured sRGB of the
`--color-mana-*` tokens, so OG art matches the live site:

| | Hex | Token (OKLCH) |
| --- | --- | --- |
| W | `#f7efd1` | `oklch(0.95 0.04 95)` warm parchment |
| U | `#0089df` | `oklch(0.60 0.18 240)` |
| B | `#7055b0` | `oklch(0.52 0.14 295)` arcane violet |
| R | `#ee343b` | `oklch(0.62 0.22 25)` |
| G | `#009c3f` | `oklch(0.60 0.18 150)` |
| C | `#707178` | `oklch(0.55 0.01 275)` |

WUBRG order is the color wheel — keep it. On W pips, use dark text
(`#1a1420`); white text on the rest.

## Rarity palettes — two on purpose

`RARITY_INK` (printed set-symbol ink: common `#0f0f12`, uncommon `#a5a5b5`,
rare `#c9a14a`, mythic `#d35327`) vs `RARITY_TINT` (bright UI gem tints:
`#cfcfd4` / `#c6e2f5` / `#f3d57c` / `#f08a4a`). They serve different surfaces
(printed-card realism vs chip legibility on dark UI) — never merge them, and
never use rarity golds as brand gold.

## Radius scale

`--radius-control` 0.375rem (buttons/inputs) · `--radius-card` 1rem
(SurfaceCard) · `--radius-frame` 1.25rem (hero bands). Use the tokens
(`rounded-control` / `rounded-card` / `rounded-frame`), not raw `rounded-*`.
