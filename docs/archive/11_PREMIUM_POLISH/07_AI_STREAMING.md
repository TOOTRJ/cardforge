# Chunk 07 — AI Streaming

## Goal

Stream AI suggestions token-by-token into the AI panel preview so the
user sees the response materialize instead of staring at a frozen
"Loading…" for several seconds. Especially valuable for the longer
actions (Improve wording, Generate from concept) where the wait is most
noticeable.

## Scope

In scope:
- Switch `runCardAssistant` from `generateObject` to `streamObject`.
- Update `/api/ai/card-assistant/route.ts` to return a streaming response.
- Update `<AIAssistantPanel>` to consume the stream and progressively
  fill the suggestion preview.
- Keep the rate limit gate BEFORE the stream starts.
- Apply remains atomic — only enabled once the stream completes.

Out of scope:
- A "stream into the form fields directly" mode — keep the staging
  preview flow.
- Cancellation UX (let the user click away; the stream aborts).
- Per-action streaming configuration.

## Files to add / modify

- Modify: `lib/ai/card-assistant.ts`
  - Convert each action's `generateObject` call to `streamObject`
  - Export an iterator-friendly result type
- Modify: `app/api/ai/card-assistant/route.ts`
  - Return `result.toTextStreamResponse()` (or equivalent for
    `streamObject` — the AI SDK exposes
    `result.experimental_partialObjectStream`)
  - Log the AI call BEFORE streaming starts
- Modify: `components/creator/ai-assistant-panel.tsx`
  - Use `useObject` (`@ai-sdk/react`) or a manual `for await` over the
    response stream
  - Progressively render whatever fields are present in the partial
  - Apply button is disabled while streaming, enabled when finished

## Implementation approach

- AI SDK v6 ships `streamObject` and a `useObject` hook
  (`@ai-sdk/react`). If `useObject` is available, lean on it — it
  handles partial deltas, errors, and complete signaling for you.
- The rate limit + auth checks fire before the stream starts; an
  abort mid-stream still counts toward the day quota.
- The suggestion preview component reads from the partial object —
  text fields appear character-by-character, arrays grow item-by-item.

## Acceptance criteria

- Clicking "Improve wording" or "Generate from concept" starts showing
  text within ~500ms instead of a frozen spinner.
- The Apply button is disabled while streaming; enabled at end-of-stream.
- Streaming respects the rate limit (still returns 429 when over).
- Errors mid-stream surface a toast and clear the partial.
- Other actions (suggest cost / rarity / etc.) also stream cleanly even
  though their payload is short.
- `card_ai_calls` row is inserted before the stream begins.

## Dependencies

None — the rate-limit table and the existing AI panel are already in place.

## Estimated effort

~2.5 hours.

## Done when

Open the AI panel, click "Generate from concept" with a concept like
"a flying dragon at uncommon, 4 mana" — watch the title, type, rules,
and flavor fields stream in within a couple seconds, then apply.
