# Chunk 05 — Loading Skeletons & View Transitions

## Goal

Replace every `<Loader2 className="animate-spin" />` placeholder with
shimmer skeletons that match the actual content shape. Add cross-fade
route transitions via the View Transitions API so navigating between
pages feels polished instead of jarring.

## Scope

In scope:
- A `<Skeleton>` primitive (rectangle with a left-to-right shimmer).
- Skeleton card placeholders for gallery / dashboard / profile / set.
- Skeleton row placeholders for the Scryfall search results list.
- Skeleton table rows for the settings + sets pages.
- View Transitions API integration for navigation between routes that
  share a card (gallery → card detail, dashboard → editor).
- `prefers-reduced-motion: reduce` skips the shimmer and the transition.

Out of scope:
- A full design system of skeletons for every component.
- Streaming React Server Components beyond the existing `<Suspense>`
  boundaries.
- Animated page transitions with motion physics — keep it to a clean
  cross-fade.

## Files to add / modify

- New: `components/ui/skeleton.tsx`
- New: `components/cards/card-preview-skeleton.tsx`
- Modify: `app/(marketing)/gallery/page.tsx` — `<Suspense fallback>`
- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `app/(marketing)/profile/[username]/page.tsx`
- Modify: `app/(marketing)/set/[slug]/page.tsx`
- Modify: `components/creator/scryfall-import-dialog.tsx` — skeleton rows
  when `searching` is true
- Modify: `app/globals.css` — `@keyframes shimmer`, view-transition CSS
- Modify: `app/layout.tsx` — opt into View Transitions

## Implementation approach

- `<Skeleton>` is a `div` with a left-to-right shimmer using a
  `linear-gradient` background and `background-position` animation.
- `<CardPreviewSkeleton>` matches the aspect ratio (`aspect-[5/7]`) and
  the inner blocks (title bar, art well, type line, rules text).
- View Transitions API:
  - Set `view-transition-name: card-<id>` on each card preview and the
    detail page's hero card.
  - Wrap navigation in `document.startViewTransition` (Next.js 16 has
    built-in support via the `unstable_ViewTransition` hook or the
    `@next/view-transitions` pattern — check Next 16.2 docs).
- The shimmer animation pauses for reduced-motion users.

## Acceptance criteria

- Navigating to `/gallery` while data loads shows a 6-up grid of card
  skeletons that match the real card dimensions.
- Dashboard, profile, and set pages all show skeletons during loading.
- Clicking a card from the gallery animates a smooth shared-element
  transition into the detail page.
- `prefers-reduced-motion: reduce` shows static placeholders with no
  shimmer and no transition.
- No layout shift between skeleton → real content.

## Dependencies

None — pure polish, safe to ship anytime.

## Estimated effort

~2.5 hours.

## Done when

Slow-throttle the network (DevTools → Slow 3G), reload `/gallery` — see
skeletons, then a smooth transition into populated cards. Click into a
card — the shared element animates.
