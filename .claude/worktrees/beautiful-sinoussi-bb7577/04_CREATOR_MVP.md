# Phase 4 — Simple Card Creator MVP

## Goal

Build the first working card creator with live preview, image upload, save, edit, and visibility controls.

## Scope

Build:

- `/create`
- `/card/[slug]/edit`
- card form
- live preview
- art upload
- art crop/position basics
- save card
- edit card
- visibility toggle
- delete card

## Creator Layout

Desktop:

- left panel: form
- right panel: live preview
- sticky action bar

Mobile:

- tabbed flow:
  - Details
  - Art
  - Preview
  - Save

## Form Fields

Include:

- title
- cost
- card type
- subtype
- rarity
- rules text
- flavor text
- power
- toughness
- artist credit
- frame style
- visibility
- artwork upload

## Preview Requirements

Use original generic fantasy card design.

Preview should support:

- creature layout
- spell layout
- artifact layout
- land layout

Do not copy official card frames.

## Upload Requirements

- upload to Supabase Storage
- restrict file types to common images
- restrict file size
- store art URL in card record
- allow simple object-position controls:
  - x
  - y
  - zoom

## UX Requirements

- autosave may be deferred
- manual save required
- show unsaved changes state
- show validation errors
- show loading states
- show success toast

## Acceptance Criteria

- Authenticated user can create a card.
- Authenticated user can upload art.
- Authenticated user can see live preview.
- Authenticated user can save card.
- Authenticated user can edit their card.
- Authenticated user can delete their card.
- Private/public visibility works.
- Build passes.

## Claude Instruction

Implement Phase 4 only. Do not build PNG export yet. Do not build public gallery beyond existing placeholder pages.
