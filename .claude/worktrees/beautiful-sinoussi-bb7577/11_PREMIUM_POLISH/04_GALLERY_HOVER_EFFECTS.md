# Chunk 04 — Gallery 3D Tilt + Glare

## Goal

When the user hovers a card in the gallery, dashboard, profile, or set
page, the card tilts toward the cursor in 3D and a specular highlight
sweeps across its surface. Same effect collectors get on "holographic"
trading-card preview sites. Pure-CSS + a tiny pointer handler — no
animation lib.

## Scope

In scope:
- A reusable `<CardHoverEffect>` wrapper that wraps `<CardPreview>`.
- 3D rotation via `perspective(800px) rotateX() rotateY()`, driven by
  pointer position relative to the card's bounding rect.
- A moving radial-gradient overlay that mimics a specular highlight.
- Honors `prefers-reduced-motion: reduce` (disables the effect).
- Skips on touch devices (no hover concept).
- Pairs naturally with the foil / etched finishes from chunk 03.

Out of scope:
- Persisting tilt state when the user clicks away (cards reset on leave).
- Holographic rainbow color sweep — that's a foil finish concern, not a
  hover effect.
- Performance optimizations beyond `transform: translateZ(0)` for layer
  promotion.

## Files to add / modify

- New: `components/cards/card-hover-effect.tsx`
- Modify: `app/(marketing)/gallery/page.tsx` — wrap each card
- Modify: `app/(app)/dashboard/page.tsx` — same
- Modify: `app/(marketing)/profile/[username]/page.tsx` — same
- Modify: `app/(marketing)/set/[slug]/page.tsx` — same
- Modify: `globals.css` — `@media (prefers-reduced-motion: reduce)` guard

## Implementation approach

- `<CardHoverEffect>` is a `"use client"` wrapper component.
- `onPointerMove` → compute `(x, y)` ratio within the card → set CSS
  custom properties (`--rx`, `--ry`, `--gx`, `--gy`).
- A child `::after` pseudo (or absolutely positioned `<span>`) carries
  the radial gradient at `(--gx, --gy)`.
- Transforms read `--rx` / `--ry` so the React component never re-renders.
- `onPointerLeave` resets the properties with a CSS transition.
- Use `requestAnimationFrame` to throttle pointer-move writes to avoid
  jank on lower-end machines.
- Detect `(hover: hover) and (pointer: fine)` to short-circuit the
  handler on touch.

## Acceptance criteria

- Hovering a gallery card causes a smooth 3D tilt (±8°) following the
  pointer.
- A subtle specular highlight follows the cursor.
- Moving the cursor away returns the card to flat with a ~300ms ease.
- `prefers-reduced-motion: reduce` removes both the tilt and the glare.
- Touch devices (`@media (hover: none)`) see no effect.
- No layout shift; sibling cards don't reflow when one tilts.
- 60 FPS on a M1 Air.

## Dependencies

Chunk 03 (premium card finishes) — recommended to land first so the
hover effect interacts with foil/etched correctly. Not strictly required;
this chunk can ship against the current preview.

## Estimated effort

~2 hours.

## Done when

Mouse over a gallery card → card visibly tilts and the highlight tracks
the cursor, including across all four pages listed above.
