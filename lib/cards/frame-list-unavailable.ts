// ---------------------------------------------------------------------------
// A failed read of the verified frame list (lib/cards/frame-reviews.ts,
// getVerifiedFrameKeys / getVerifiedFrameKeysPublic). The list is the
// creator's only gate, and "nothing is verified" is the one answer a failed
// read must never give: in a PostgREST or pooler hiccup (the 2026-11-10
// incident) /create showed every frame as "Soon" and both card actions
// refused every save with "That frame isn't available in <colour> yet". The
// readers log the failure and throw this; each caller says so in its own
// terms — a save refused with FRAME_LIST_UNAVAILABLE_MESSAGE (retryable), a
// creator page with a notice, a job or a tool refused before any charge.
//
// Its own module, free of Supabase: the card actions, the jobs and the tools
// recognise it without importing the reader (which their tests replace).
// ---------------------------------------------------------------------------

/** The verified frame list could not be read. Never "nothing verified". */
export class VerifiedFramesUnavailableError extends Error {
  constructor(readonly detail: string) {
    super(`The verified frame list could not be read: ${detail}`);
    this.name = "VerifiedFramesUnavailableError";
  }
}

/** What a save, an import or a tool refused for a failed frame-list read
 *  says — retryable, never "that frame isn't available". */
export const FRAME_LIST_UNAVAILABLE_MESSAGE = "We couldn't check the frame list just now — try again.";

/** The refusal's code on a card action's failure and an API answer
 *  (`code`); a tool event names it `frame_list_unavailable` (its reasons
 *  are snake_case). */
export const FRAME_LIST_UNAVAILABLE_CODE = "FRAME_LIST_UNAVAILABLE";

/** True for the error a failed frame-list read throws. */
export function isVerifiedFramesUnavailable(err: unknown): err is VerifiedFramesUnavailableError {
  return err instanceof VerifiedFramesUnavailableError;
}
