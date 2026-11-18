// ---------------------------------------------------------------------------
// The bell's words for a Re-art run the server carried on after its page
// was closed (migration 0218). A module of its own, with no imports: the
// notifications' one copy source (lib/notifications/describe.ts) is loaded
// with every page, and must not bring the tool's model with it.
// ---------------------------------------------------------------------------

export type ReartBackgroundState = "running" | "paused" | "stopped" | "finished";
export type ReartBackgroundReason = "expired" | "error" | "credits" | "capacity" | "stopped";

/** Why a run the server carried is not running any more, in words. */
export const REART_BACKGROUND_REASON_COPY: Record<ReartBackgroundReason, string> = {
  expired: "the hour your sign-in lasts ran out",
  error: "the cards kept failing to start",
  credits: "you ran out of credits",
  capacity: "you ran out of card slots",
  stopped: "you stopped it",
};

/**
 * How many cards were painted, and why the run stopped if it did. Pure.
 * Reads as the notification's body after its subject ("Re-art deck …").
 */
export function reartRunNotice(input: {
  deckTitle: string | null;
  state: ReartBackgroundState;
  reason: ReartBackgroundReason | null;
  painted: number;
  failed: number;
  waiting: number;
}): string {
  const deck = input.deckTitle?.trim() ? `“${input.deckTitle.trim()}”` : "your deck";
  const cards = (n: number) => `${n} card${n === 1 ? "" : "s"}`;
  const painted = `${cards(input.painted)} painted`;
  const failed = input.failed > 0 ? `, ${input.failed} didn't` : "";
  if (input.state === "finished") return `finished re-arting ${deck}: ${painted}${failed}.`;
  const why = input.reason ? REART_BACKGROUND_REASON_COPY[input.reason] : "it stopped";
  const left =
    input.waiting > 0
      ? ` ${cards(input.waiting)} ${input.waiting === 1 ? "is" : "are"} still to paint — open the deck in Re-art deck to continue.`
      : "";
  return `${input.state === "paused" ? "paused" : "stopped"} re-arting ${deck} (${why}): ${painted}${failed}.${left}`;
}
