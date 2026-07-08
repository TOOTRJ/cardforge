---
name: pipglyph-brand
description: The locked PipGlyph brand system — the Astral Rose mark, palette, treatment rules, voice, and asset workflow. Use this whenever producing ANYTHING visual or outward-facing for PipGlyph, even if "brand" isn't mentioned - marketing/landing pages, OG or social images, logos and icons, emails, slide decks, announcements or social posts, charts and dashboards about PipGlyph, new UI surfaces, or edits to lib/brand, public/brand, or brand colors anywhere. Also use it before answering questions about PipGlyph's colors, logo, fonts, or naming.
---

# PipGlyph brand system

PipGlyph's brand was locked 2026-07 (PRs #169–#174): the **Astral Rose** mark, a
gold/purple/navy palette, Cinzel + Geist type, and a "craftsman's arcana" voice.
Everything below exists so output stays consistent — brand-consistency drift is
the exact problem this system replaced, so never restate hex values, redraw the
mark by hand, or invent new golds. Derive from the sources of truth:

- **Code:** `lib/brand/` — `constants.ts` (hexes), `geometry.ts` (mark paths,
  32-unit grid), `glyph.tsx` (Satori-safe React), `svg.ts` (string builders),
  `wordmark.ts` (outlined Cinzel path). CSS tokens live in `app/globals.css`
  `@theme` (dark) + `:root[data-theme="light"]`.
- **Files:** `public/brand/` — every logo variant, lockups, banners, the press
  kit zip, and the guidelines PDF. Browse `/press` for the human-readable kit.

## The mark: the Astral Rose

A compass rose become astrolabe. Ring + graduation ticks (a maker's calibrated
instrument), a quill-curved four-point star, a cut-gem heart with a bright
facet, a violet orbit pip riding the ring at 45° (a plane in orbit — the walk
between worlds), and a three-star wake upper-left (what every journey leaves
glowing). Never redraw it: import from `lib/brand` in code, or use the files
in `public/brand/` (inline copies for no-repo contexts are in
[references/mark-svg.md](references/mark-svg.md)).

## Treatment decision table

One geometry, five dresses. Pick by placement — don't improvise new ones:

| Context | Treatment | File / API |
| --- | --- | --- |
| Site header, section seals | **Deep Seal** (carved socket + gold rim + relief) | `components/layout/logo.tsx`, `pipglyph-mark-seal.svg` |
| Avatars, social profiles, stamps | **Medallion** (gold-bordered floating coin) | `pipglyph-medallion-{512,1024}.png` |
| App icons, manifest, bookmark tiles | **Sigil Plaque** (bordered rounded-square tile) | `pipglyph-plaque-*.png`, `icon-{192,512}.png` |
| Hero moments, empty states, loading | **Levitant** (borderless float + shadow) | `pipglyph-mark-levitant.svg` |
| OG images, favicons, anything Satori | **Flat** (no filters — they don't render there) | `AstralRose` from `lib/brand/glyph`, `pipglyph-mark-flat.svg` |
| Single-ink (print, engraving, watermark) | **Mono** (gem knocked out, currentColor) | `CompassStar` component, `pipglyph-mark-mono-{black,white}.svg` |

Size rules: flat mark holds to 16px; bordered treatments need 24px+; relief is
for 32px+. Below ~40px use `detail="compact"` (drops ticks + wake — they turn
to sub-pixel noise).

## Palette (quick reference)

Dark theme is the brand's home. Core anchors — full scales, light-mode values,
mana + rarity palettes, and contrast rules are in
[references/palette.md](references/palette.md):

| Role | Hex | Token |
| --- | --- | --- |
| Gold (accent, never background) | `#d8b26e` | `--color-gold` / `BRAND.gold` |
| Gold gradient stops | `#ecca8a → #b8904a` | `BRAND.goldLight/goldDeep` |
| Purple (bright accent) | `#8e72c9` | `--color-primary-bright` / `BRAND.purple` |
| Purple deep (fills, gem) | `#6b4d9a` | `--color-primary` / `BRAND.purpleDeep` |
| Navy (background) | `#0d1320` | `--color-background` / `BRAND.navy` |
| Surface | `#1a2030` | `--color-surface` / `BRAND.surface` |
| Foreground | `#f2f3f5` | `--color-foreground` |

In app code use the CSS tokens (`text-gold`, `bg-surface`, …). Literal hexes
are allowed ONLY where CSS variables can't reach (Satori, SVG gradients/
filters, node scripts) — and then they come from `BRAND`, with light-mode
values from the light token block, never eyeballed.

## Typography

- **Display:** Cinzel SemiBold (600) — headings, the wordmark, `font-display`.
  Cinzel has no true lowercase (lowercase renders as small caps), so "PipGlyph"
  set in it is correct as typed. For distributed art, never re-typeset the
  wordmark: use the outlined path (`lib/brand/wordmark.ts` or
  `pipglyph-wordmark-*.svg`) so no font dependency ships.
- **Body/UI:** Geist (`font-sans`), Geist Mono for code/data.
- Card-render fonts (Beleren/MPlantin) are for card art only — never brand chrome.

## Voice, naming, legal

The short version — full copy rules, boilerplate paragraphs, and the required
WotC disclaimer text are in [references/voice.md](references/voice.md):

- The name is **"PipGlyph"** — one word, capital P and G. Tagline: *"Precision
  tools for legendary ideas."*
- Voice: a craftsman's — precise, warm, a little arcane, **never campy**. Magic
  flavor is seasoning, not the meal; clarity beats lore.
- Anything outward-facing (press, ads, app-store copy, printed material) carries
  the Wizards of the Coast non-affiliation disclaimer.

## Workflows

**Changing a brand color or the mark:** edit `lib/brand/` and/or the
`@theme` + light blocks in `app/globals.css` (keep the `BRAND` comments'
OKLCH annotations in sync), then regenerate every static asset:

```bash
node scripts/generate-brand-assets.mjs   # node ≥ 23.6; rewrites public/brand/* + app/favicon.ico
```

The card renderer (`lib/render/card-image.tsx`) bakes brand geometry into
stored card PNGs — if you change the mark there, bump `CARD_LAYOUT_VERSION`
(`lib/cards/layout-version.ts`) and plan a rebake (`scripts/rebake-renders.mjs`).

**Building SVG/OG art:** read
[references/svg-and-satori.md](references/svg-and-satori.md) FIRST — it holds
the hard-won gotchas (Satori renders flat colors only; gradients need
userSpaceOnUse; `<use>` needs explicit width/height; lighting filters wash out
flat container faces) plus the filter recipes for the four treatments.

**Out-of-repo deliverables** (decks, posters, one-off graphics): copy the SVG
snippets from [references/mark-svg.md](references/mark-svg.md) and the hexes
above — don't approximate from memory or screenshots.
