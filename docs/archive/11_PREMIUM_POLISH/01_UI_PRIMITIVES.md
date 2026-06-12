# Chunk 01 — UI Primitives Upgrade

## Goal

Replace the hand-rolled modal pattern with Radix UI primitives (Dialog,
Popover) so every dialog in the app gets a proper focus trap, escape
handling, and screen-reader treatment for free. Add a multi-select variant
to the existing ChipGroup so the bespoke ColorIdentityPicker can be
retired in favor of the same primitive every other chip group uses.

This is the foundation layer — later chunks (06 command palette, 08 bulk
actions, 10 DFC) will build on the new Dialog primitive.

## Scope

In scope:
- Add `@radix-ui/react-dialog`, `@radix-ui/react-popover`, and
  `@radix-ui/react-visually-hidden` to the dep graph.
- Author thin `components/ui/dialog.tsx` and `components/ui/popover.tsx`
  wrappers matching the shadcn API surface.
- Extend `ChipGroup` with a `multiSelect` mode (toggle add/remove).
- Refactor `DeleteCardDialog` and `ScryfallImportDialog` to use the new
  Dialog primitive.
- Replace the inline `ColorIdentityPicker` in `card-creator-form.tsx`
  with the multi-select `ChipGroup`.

Out of scope:
- Replacing the in-house Tabs primitive — it works and isn't blocking
  anything; revisit only if accessibility issues surface.
- Building a Tooltip primitive — not needed yet.
- New shadcn components beyond Dialog/Popover.

## Files to add / modify

- `package.json` — add the three Radix deps
- New: `components/ui/dialog.tsx`
- New: `components/ui/popover.tsx`
- Modify: `components/ui/chip-group.tsx` — multi-select branch
- Refactor: `components/creator/delete-card-dialog.tsx`
- Refactor: `components/creator/scryfall-import-dialog.tsx`
- Refactor: `components/creator/card-creator-form.tsx` — color_identity
  field uses `<ChipGroup multiSelect />`, remove `ColorIdentityPicker`

## Implementation approach

- Mirror shadcn's Dialog API: `<Dialog open onOpenChange>`,
  `<DialogTrigger>`, `<DialogContent>`, `<DialogHeader>`, `<DialogTitle>`,
  `<DialogDescription>`, `<DialogFooter>`. Tailwind classes match the
  existing surface/border/backdrop-blur palette.
- For Popover, expose `<Popover>`, `<PopoverTrigger>`, `<PopoverContent>`.
- `ChipGroup`'s `multiSelect` mode flips `value`/`onChange` to
  `value: T[]` / `onChange: (next: T[]) => void` and `role` to
  `"checkbox"` on each chip with `aria-checked`.
- Use a TypeScript discriminated union on the `multiSelect` prop so the
  compiler picks the correct `value`/`onChange` signature.

## Acceptance criteria

- `lint`, `typecheck`, and `build` are all green.
- The Delete dialog still opens, closes on Esc, closes on backdrop click,
  and confirm works.
- The Scryfall search dialog renders identically, focus traps in the
  search input on open, Tab cycles inside the dialog only.
- The Color identity field still toggles colors and persists them on save.
- No regressions on the editor's tabbed layout or save flow.

## Dependencies

None — this is the first chunk.

## Estimated effort

~2 hours.

## Done when

The two refactored dialogs and the color identity picker are powered by
the new primitives, three Radix packages are in `package.json`, and the
existing `ColorIdentityPicker` function has been removed (or marked
unused) from `card-creator-form.tsx`.
