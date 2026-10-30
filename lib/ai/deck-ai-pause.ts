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

/** The AI job kinds that are deck AI: a deck build (and "Add with AI") and
 *  the deck restyle. */
export function isDeckAiJobKind(kind: unknown): kind is "deck" | "deck_remix" {
  return kind === "deck" || kind === "deck_remix";
}

/** Whether a FAILED step of a job of this kind can't be re-run right now:
 *  the step route refuses it, so the runner (components/ai/
 *  generation-provider.tsx) offers no Retry and promises none. Running
 *  steps still finish (D6); card jobs are never paused. */
export function isDeckAiRetryPaused(kind: unknown): boolean {
  return isDeckAiPaused() && isDeckAiJobKind(kind);
}

/** The JSON body every paused route answers with. */
export function deckAiPausedBody(): { ok: false; code: typeof DECK_AI_PAUSED_CODE; error: string } {
  return {
    ok: false,
    code: DECK_AI_PAUSED_CODE,
    error: `${DECK_AI_PAUSED_MESSAGE} No credits were used.`,
  };
}

// ---------------------------------------------------------------------------
// Deck guides behind "Coming soon" (owner 2026-10-30). The deck page's
// "Game plan & combos" section — the AI guide — is hidden from EVERY viewer
// (owner, visitor, Pro) until AI generation returns to decks: the guide
// redaction fix (0151 doesn't hide a deleted card's name in an old guide) is
// deferred until then. While this is false:
//   * the deck page never calls `deck_guide_for_viewer` (lib/decks/guides.ts)
//     — no guide text is read for, or sent to, the browser — and shows the
//     section greyed with `DECK_GUIDES_HIDDEN_MESSAGE`;
//   * POST /api/decks/[id]/guide answers `deckGuidesComingSoonBody()`;
//   * the Pro export's deck.pdf report prints no guide;
//   * a deck job's free guide step (a job already running) writes none.
// The stored `deck_guides` rows are never deleted or changed: switching this
// to true brings every guide back as it was. The ONE switch.
// ---------------------------------------------------------------------------

export const DECK_GUIDES_ENABLED = false;

/** The refusal's `code` while guides are hidden. */
export const DECK_GUIDES_COMING_SOON_CODE = "DECK_GUIDES_COMING_SOON";

/** The one line the hidden section (and the refusal) says. */
export const DECK_GUIDES_HIDDEN_MESSAGE =
  "Deck guides are being reworked and will be back with AI deck tools. Guides already written are saved.";

/** Whether deck guides are read, shown, printed and written (the one question). */
export function areDeckGuidesEnabled(): boolean {
  return DECK_GUIDES_ENABLED;
}

/** The JSON body POST /api/decks/[id]/guide answers while guides are hidden. */
export function deckGuidesComingSoonBody(): {
  ok: false;
  code: typeof DECK_GUIDES_COMING_SOON_CODE;
  error: string;
} {
  return {
    ok: false,
    code: DECK_GUIDES_COMING_SOON_CODE,
    error: `${DECK_GUIDES_HIDDEN_MESSAGE} No credits were used.`,
  };
}
