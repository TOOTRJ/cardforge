# Chunk 12 — Light Mode + Theme Toggle

## Goal

Today the entire palette is OKLCH dark-only. Ship a light theme + a
header toggle that switches between dark / light / system without a
flash on initial render.

## Scope

In scope:
- A second OKLCH palette in `app/globals.css` keyed off
  `[data-theme="light"]`.
- A small `<ThemeToggle>` in the site header.
- Server-rendered theme attribute (no flash of unstyled content).
- Theme preference stored in a cookie + falls back to
  `prefers-color-scheme` for first-time visitors.
- Card preview color halos adapt to the theme.
- Foil / etched finishes look intentional on both.

Out of scope:
- A third "sepia" / "high-contrast" theme.
- Per-component theme overrides.
- An animated transition between themes (a quick swap is fine).

## Files to add / modify

- Modify: `app/globals.css`
  - Add a `:root[data-theme="light"] @theme` block with light OKLCH
    values for every existing token
  - Tweak the `.bg-grid`, `.bg-radial-glow`, and any hard-coded color
    references that don't go through tokens
- New: `lib/theme.ts` — server-side cookie reader, type
  `Theme = "dark" | "light" | "system"`
- New: `components/layout/theme-toggle.tsx` — `"use client"` toggle
  that writes the cookie and updates the `<html data-theme>` attribute
- Modify: `app/layout.tsx`
  - Server-read the cookie and emit
    `<html data-theme={resolvedTheme}>` so the right palette renders
    on first paint
- Modify: `components/layout/site-header.tsx` — mount the toggle
- Modify: `components/cards/card-preview.tsx` — color halos use
  `color-mix(in oklab, …)` already, so most adapts; verify foil shimmer
  reads well on light

## Implementation approach

- Treat dark as the baseline (current). Light overrides every token.
- Cookie name: `cardforge-theme`. Values: `dark` | `light` | `system`.
- On the server, resolve `system` → `dark` for the initial render to
  avoid a hydration mismatch (the toggle then re-resolves on the
  client and updates if needed).
- The toggle cycles through dark → light → system → dark.
- Keep token names — don't rename `--color-background` etc. Just
  override values per theme block.
- For the card preview's foil shimmer, the conic gradient uses RGBA
  white-ish stops, which work in both themes; verify visually.

## Acceptance criteria

- Toggle in the header switches the theme.
- No flash of dark content on first paint when the user prefers light.
- Cookie persists across navigation and refresh.
- `prefers-color-scheme: light` honored for first-time visitors who
  haven't set the cookie.
- All pages (gallery, dashboard, editor, settings, marketing pages)
  look intentional in both themes.
- The card preview's color halos read distinctly in both.

## Dependencies

None — but ideally land AFTER the chunks that touch CardPreview (03
finishes, 04 hover effects) so we only audit the theme visuals once.

## Estimated effort

~3 hours.

## Done when

Switch to light mode from the header. Navigate through gallery, an
editor session, and a public card page — everything reads intentional,
no broken contrast, refresh persists the theme.
