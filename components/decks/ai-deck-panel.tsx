// ---------------------------------------------------------------------------
// The AI deck remix's estimate helpers (TODO 5.4; emblems, owner 2026-10-13).
//
// The AiDeckPanel that read them — the deck page's "Add with AI" and "Remix
// with AI" dialogs — was removed when deck AI was paused (owner 2026-10-28,
// TODO DK1, lib/ai/deck-ai-pause.ts; the route answers DECK_AI_PAUSED while
// it holds). The estimate's shape and the emblem line stay for the rebuilt
// remix: tests/unit/components/remix-emblems-line.test.ts holds them.
// ---------------------------------------------------------------------------

/** GET /api/ai/remix-estimate's answer (TODO 5.4): the entries a remix runs
 *  and the credits they reserve, double-faced printings at two. */
export type RemixEstimate = {
  cards: number;
  credits: number;
  doubleFaced: number;
  skipped: number;
  /** Emblems the remix leaves out (owner 2026-10-13): no step, no credit. */
  emblems: number;
  /** Own cards moderation hid (migration 0156): left out the same way. */
  moderationLocked?: number;
};

/** The one line that tells a deck's owner its emblems stay behind. */
export function emblemsLeftOutLine(emblems: number): string {
  if (emblems <= 0) return "";
  return `${emblems} emblem${emblems === 1 ? " is" : "s are"} left out: emblems are not remixed.`;
}

/** The one line that tells a deck's owner its cards moderation hid stay
 *  behind (owner 2026-10-30: a locked card is never remixed). */
export function moderationLockedLeftOutLine(count: number | undefined): string {
  if (!count || count <= 0) return "";
  return count === 1
    ? "1 card is left out: it was hidden by moderation and isn't remixed."
    : `${count} cards are left out: they were hidden by moderation and aren't remixed.`;
}

/** The deck's remix estimate, or null when the request fails — the paused
 *  route's refusal included (a caller then keeps a "one per card" copy; the
 *  server re-checks at the job). */
export async function fetchRemixEstimate(deckId: string): Promise<RemixEstimate | null> {
  try {
    const response = await fetch(`/api/ai/remix-estimate?deck_id=${encodeURIComponent(deckId)}`, {
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as
      | ({ ok: true } & RemixEstimate)
      | { ok: false }
      | null;
    if (!response.ok || !body || body.ok !== true) return null;
    return {
      cards: body.cards,
      credits: body.credits,
      doubleFaced: body.doubleFaced,
      skipped: body.skipped,
      emblems: body.emblems ?? 0,
      ...(body.moderationLocked ? { moderationLocked: body.moderationLocked } : {}),
    };
  } catch {
    return null;
  }
}
