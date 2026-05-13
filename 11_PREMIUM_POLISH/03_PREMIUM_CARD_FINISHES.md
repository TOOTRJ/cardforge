# Chunk 03 — Premium Card Finishes

## Goal

Introduce a `finish` attribute on the frame style so every saved card can
look like a "real product." A user can pick from:

- **Regular** — what we render today, baseline.
- **Foil** — animated conic shimmer (rainbow holographic).
- **Etched** — subtle gold-leaf border + faint holographic tint on rare
  metallic detail; quieter than foil.
- **Borderless** — art bleeds all the way to the frame edge, title plate
  floats over the art.
- **Showcase** — alternate display font + tighter title bar with an
  ornate underline.

This is one of the highest "premium-feel" upgrades because it instantly
makes saved cards feel collectible.

## Scope

In scope:
- Extend `FrameStyle.finish` + Zod schema + DB check constraint.
- Render each finish in `<CardPreview>`.
- Add a `Finish` ChipGroup to the Publishing tab.
- Mirror the finish in the Satori export (`lib/render/card-image.tsx`).

Out of scope:
- New custom borders beyond the four listed.
- Per-card animation timing controls.
- Foil "etched" + "borderless" combinations (single finish, not stacked).

## Files to add / modify

- Migration: `0014_card_finish.sql` — add a check constraint update for
  `frame_style.finish` (jsonb keys are unstructured, so this is documentary).
- Modify: `types/card.ts` — `FrameStyle.finish?: "regular" | "foil" | "etched" | "borderless" | "showcase"`
- Modify: `lib/validation/card.ts` — `frameStyleSchema` accepts the new key
- Modify: `components/cards/card-preview.tsx`
  - Branch by finish at the outer frame
  - Foil: existing conic shimmer extracted into a `<FoilSheen />` overlay
  - Etched: gold-leaf inner border + `mix-blend-soft-light` holo tint
  - Borderless: zero inner padding, art well covers full bleed, title
    bar floats with backdrop-blur
  - Showcase: alternate font on title + ornate underline
- Modify: `components/creator/card-creator-form.tsx` — add Finish ChipGroup
  to the Publishing tab (alongside Border + Accent)
- Modify: `lib/render/card-image.tsx` — Satori-compatible variants
  (Satori has no animation, so foil renders as a static specular sheen)

## Implementation approach

- Keep finishes pure CSS where possible. The conic foil + the etched
  inner border + the showcase underline are all gradients.
- For the Satori export, foil renders as a frozen gradient and the
  `<style>` keyframes block is dropped — Satori doesn't run animations.
- The new finish reads from `frame_style?.finish ?? "regular"`.
- Card-preview retains the existing `staticInEditor` prop so animated
  finishes still freeze inside the editor.

## Acceptance criteria

- All five finishes render distinctly in the editor preview.
- Export PNG matches the editor preview for each finish.
- Finish ChipGroup in the Publishing tab persists on save and round-trips.
- Foil + showcase use the `font-display` Cinzel face for titles.
- Borderless cards have art touching the outer frame.
- No regressions in the regular finish.

## Dependencies

Chunk 01 nice-to-have (the picker uses ChipGroup), but not required —
ChipGroup already exists; the multi-select extension from chunk 01 isn't
needed here.

## Estimated effort

~3 hours.

## Done when

A user can switch a card through all five finishes, watch the preview
update, save, refresh, and see the chosen finish persist; the exported
PNG renders the same finish.
