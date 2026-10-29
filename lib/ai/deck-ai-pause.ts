// ---------------------------------------------------------------------------
// The AI deck pause (owner 2026-10-28, TODO DK1): while decks are rebuilt,
// every NEW piece of deck AI is refused — a deck build and the deck page's
// "Add with AI" (job kind `deck`), the deck remix (`deck_remix`) and its
// estimate (GET /api/ai/remix-estimate), theme ideas (POST
// /api/ai/deck-ideas) and a new or refreshed deck guide (POST
// /api/decks/[id]/guide). Each route asks `isDeckAiPaused()` BEFORE any
// rate limit, outside call or credit, and answers `deckAiPausedBody()`.
//
// What the pause never touches:
//   * jobs already running finish: the step route and the runner's resume
//     read no pause (owner D6);
//   * guides that exist stay readable to the viewers who read them today
//     (owner D4);
//   * the creator's deck-aware card AI — the `card` / `card_fill` kinds with
//     a `deck_id`, "Theme the ideas to a deck" — is create-card AI (owner D5).
//
// Turning the SERVER back on is this one constant. The deck pages show the
// same words on greyed "Coming soon" controls
// (components/decks/deck-ai-coming-soon.tsx); the old deck AI screens were
// removed with the pause, and the rebuilt ones arrive with the new decks.
// Client-safe: no server imports.
// ---------------------------------------------------------------------------

export const DECK_AI_PAUSED = true;

/** The refusal's `code`, for a client that wants to tell it apart. */
export const DECK_AI_PAUSED_CODE = "DECK_AI_PAUSED";

/** The one sentence every paused control and refusal says. */
export const DECK_AI_PAUSED_MESSAGE =
  "AI deck building is paused while we rebuild decks. It's coming back soon.";

/** HTTP status of the refusal: the feature is off for everyone, not a fault. */
export const DECK_AI_PAUSED_STATUS = 403;

/** Whether the deck AI routes refuse new work (the routes' one question). */
export function isDeckAiPaused(): boolean {
  return DECK_AI_PAUSED;
}

/** The JSON body every paused route answers with. */
export function deckAiPausedBody(): { ok: false; code: typeof DECK_AI_PAUSED_CODE; error: string } {
  return {
    ok: false,
    code: DECK_AI_PAUSED_CODE,
    error: `${DECK_AI_PAUSED_MESSAGE} No credits were used.`,
  };
}
