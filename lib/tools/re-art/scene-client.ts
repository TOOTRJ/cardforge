import { REART_SCENE_CREDITS, type ReartCardWords, type ReartSceneResult } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// The browser's side of "Write a scene with AI" (POST
// /api/tools/re-art-deck/scene): one request a card. Whatever the server or
// the network answers comes back as a ReartSceneResult — never a throw: the
// dialog and the batch read one shape. A scene the server wrote is SAVED
// there before it answers, so a lost answer loses nothing (the page's next
// read shows the words).
// ---------------------------------------------------------------------------

export const REART_SCENE_ENDPOINT = "/api/tools/re-art-deck/scene";

const UNREACHABLE: ReartSceneResult = {
  ok: false,
  code: "UNREACHABLE",
  error: "We couldn't reach PipGlyph. If a scene was written it is saved: reload the page to see it.",
};

function wordsOf(value: unknown): ReartCardWords | null {
  if (!value || typeof value !== "object") return null;
  const { text, only } = value as { text?: unknown; only?: unknown };
  return typeof text === "string" && text.trim() ? { text, only: only === true } : null;
}

export async function requestReartScene(input: {
  deckId: string;
  entryId: string;
  /** What the maker typed: direction for the writer. */
  note?: string;
  /** "Use only these words" as the dialog shows it (absent: as stored). */
  only?: boolean;
  signal?: AbortSignal;
}): Promise<ReartSceneResult> {
  let response: Response;
  try {
    response = await fetch(REART_SCENE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deckId: input.deckId,
        entryId: input.entryId,
        ...(input.note?.trim() ? { note: input.note } : {}),
        ...(typeof input.only === "boolean" ? { only: input.only } : {}),
      }),
      signal: input.signal,
    });
  } catch {
    return UNREACHABLE;
  }
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = null;
  }
  // Only an answer of OURS decides anything: a proxy's page, or a body that
  // isn't the route's, is "couldn't reach".
  if (!body || typeof body.ok !== "boolean") return UNREACHABLE;
  const credits = typeof body.credits === "number" && Number.isFinite(body.credits) ? body.credits : null;
  if (body.ok) {
    const words = wordsOf(body.words);
    if (!words) return UNREACHABLE;
    return { ok: true, words, previous: wordsOf(body.previous), credits };
  }
  const code = typeof body.code === "string" ? body.code : null;
  return {
    ok: false,
    error: typeof body.error === "string" && body.error ? body.error : "The scene couldn't be written — try again.",
    ...(code === "INSUFFICIENT_CREDITS" || code === "RATE_LIMITED" || code === "NOT_PAINTABLE" || code === "AI_UNAVAILABLE" ? { code } : {}),
    ...(typeof body.retryAfterSeconds === "number" ? { retryAfterSeconds: body.retryAfterSeconds } : {}),
    credits,
  };
}

/** Whether a failure ends a batch (the next card would fail the same way). */
export function sceneFailureStopsBatch(result: Extract<ReartSceneResult, { ok: false }>): boolean {
  return result.code === "INSUFFICIENT_CREDITS" || result.code === "RATE_LIMITED" || result.code === "AI_UNAVAILABLE" || result.code === "UNREACHABLE";
}

/** What a batch of `cards` scenes costs, in credits. */
export const scenesCredits = (cards: number) => cards * REART_SCENE_CREDITS;
