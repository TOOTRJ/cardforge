# Chunk 15 — Usage Insights UI

## Goal

The `card_ai_calls` and `scryfall_calls` tables are already populated by
the rate limiters from PR 1 and PR 3 but never surfaced in the UI. Add
a "Usage" panel to the Settings page so users can see how much of their
daily quota they've used and a 30-day trend.

## Scope

In scope:
- A `UsagePanel` on `/settings` with two sections (AI assistant +
  Scryfall search).
- Each section shows: "X / Y today", "X / Y this minute", a small
  30-day bar chart.
- Queries hit the existing tables — no new schema.
- All data is owner-scoped (the existing RLS already binds reads to the
  caller's user_id).

Out of scope:
- Admin views of other users' usage.
- A graph for the historical month-over-month trend beyond 30 days.
- A "Reset my quota" admin button.
- Exporting usage data as CSV.
- Per-action breakdown beyond the high-level AI / Scryfall split.

## Files to add / modify

- Modify: `app/(app)/settings/page.tsx` — embed `<UsagePanel>`
- New: `components/settings/usage-panel.tsx`
- New: `components/settings/usage-bar-chart.tsx` — tiny inline SVG
  bar chart (no chart lib)
- New: `lib/ai/usage-queries.ts`
  - `countAiCallsLastMinute(userId)` / `countAiCallsToday(userId)`
  - `aiCallsByDayLast30(userId): Array<{ day: string; count: number }>`
- New: `lib/scryfall/usage-queries.ts` — same shape, different table

## Implementation approach

- Queries use Postgres `date_trunc('day', created_at)` + GROUP BY,
  returned as a flat array client-side.
- The bar chart is a pure SVG: one `<rect>` per day, height scaled to
  the max in the series.
- Empty state ("You haven't used the AI assistant yet") shows when
  count is 0.
- "Limit hit today" surfaces a clear red banner with a countdown to
  the daily reset (midnight UTC, or 24h from the first call of the
  day — match whatever the limiter uses).

## Acceptance criteria

- `/settings` shows the usage panel below the profile form.
- Numbers match what the limiter sees (live, not cached).
- The bar chart shows the last 30 days; days with zero calls are flat.
- Hovering a bar shows the date and count.
- A user who's at the daily limit sees the red banner.
- Anonymous / signed-out users don't see the panel (they can't reach
  /settings anyway).

## Dependencies

None — the tables are already populated.

## Estimated effort

~2.5 hours.

## Done when

Use the AI assistant a few times. Visit `/settings` — see "X / 200 today"
and the bar for today reflects your usage. Same for Scryfall.
