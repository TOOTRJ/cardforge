# Chunk 06 — Onboarding Hero & Command Palette

## Goal

Two related upgrades that land together:

1. **Start-with hero on `/create`**: a 3-up callout above the form
   offering "Blank canvas", "Search a real card", and "Generate from
   concept" — kills the empty-page stall for first-time users.
2. **Global ⌘K command palette**: opens from anywhere in the app, lets
   the user jump to any page, search Scryfall, search their own cards,
   or trigger creator actions without navigating manually.

These ship together because they share the same Scryfall trigger logic
and the palette is the natural surface for the hero's "Search a real
card" button.

## Scope

In scope:
- `<StartWithHero>` component rendered above the form on `/create`.
- `<CommandPalette>` mounted globally in the `(app)` layout.
- ⌘K (mac) / Ctrl+K (windows) opens the palette.
- Palette tabs: Navigate, My Cards, Scryfall search.
- Palette uses the chunk-01 Dialog primitive for the modal shell.
- Header chip showing "⌘K" with a thin keyboard tag.

Out of scope:
- A second palette for marketing-only pages (auth/login don't need it).
- Inline command palette inside the editor (use the existing AI panel).
- Recent-items / fuzzy-matching beyond simple `toLowerCase().includes`.
- Per-user palette settings.

## Files to add / modify

- New: `components/creator/start-with-hero.tsx`
- New: `components/layout/command-palette.tsx`
- New: `components/layout/command-palette-trigger.tsx` (header chip)
- New: `app/api/cards/search/route.ts` — owner-scoped card search for
  the palette's "My Cards" tab
- Modify: `app/(app)/create/page.tsx` — render hero above
  `<CardCreatorForm>`
- Modify: `app/(app)/layout.tsx` — mount `<CommandPalette />` once
- Modify: `components/layout/site-header.tsx` — add palette trigger

## Implementation approach

- Use the chunk-01 Dialog as the shell.
- Tabs inside the palette use the existing in-house Tabs primitive.
- `useEffect(() => window.addEventListener("keydown", ...))` for the
  global ⌘K binding; skip when an `<input>` / `<textarea>` is focused.
- "My Cards" tab calls a tiny new server route that returns the user's
  cards filtered by title (server actions don't fit since palettes
  fetch on every keystroke).
- "Scryfall" tab reuses `/api/scryfall/search`.
- Picking a result navigates (`router.push`) or fires an event the
  current page listens for (e.g. opening the Scryfall import dialog
  from a non-create page → it just routes to `/create` first).

## Acceptance criteria

- Visiting `/create` cold shows the 3-up hero above the form. Three
  buttons clearly read as "Blank canvas", "Search a real card", and
  "Generate from concept".
- ⌘K (or Ctrl+K) opens the palette from any authenticated page.
- Typing in the palette filters across tabs.
- Selecting a Scryfall result opens the Scryfall import dialog.
- Selecting a card from My Cards navigates to its edit page.
- Esc closes the palette; focus returns to the trigger.
- Palette respects the existing AI rate limits when surfacing AI actions.

## Dependencies

Chunk 01 (UI primitives) — the palette uses the new Dialog.

## Estimated effort

~3 hours.

## Done when

A new user landing on `/create` sees the 3-up hero. Pressing ⌘K opens the
palette, typing "lightning bolt" surfaces the Scryfall match, picking it
opens the import dialog pre-loaded.
