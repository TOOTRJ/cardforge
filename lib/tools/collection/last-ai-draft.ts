import type { CommanderDraft } from "./builder";

// ---------------------------------------------------------------------------
// The last "Build with AI" draft, kept in this browser for 7 days (owner
// decision 2026-11-09: a paid answer must not vanish on a reload; per-viewer
// convenience, so localStorage — never anything another device or Claude
// reads). Client-safe. Every access is wrapped: storage can throw or be
// empty (private windows, blocked site data), and the page works without it.
//
// A kept draft is offered back only while it can still be saved: the same
// commander is still in the collection and the collection still holds as
// many different cards (a draft's rows are the user's collection rows; the
// save checks them again on the server either way). It is dropped once it
// is saved as a deck, dismissed, or replaced by a newer AI draft.
// ---------------------------------------------------------------------------

export const LAST_AI_DRAFT_DAYS = 7;
const KEY_PREFIX = "pipglyph.collection-builder.last-ai-draft.v1:";

export type StoredAiDraft = {
  savedAt: string;
  commanderId: string;
  collectionSize: number;
  truncated: boolean;
  draft: CommanderDraft;
};

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function lastAiDraftKey(viewerId: string): string {
  return `${KEY_PREFIX}${viewerId}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Everything the draft review reads, checked — a kept draft of another
 *  shape (an older build of the page) must be dropped, never drawn: the
 *  review would throw and take the page with it. */
function isStored(value: unknown): value is StoredAiDraft {
  if (!isRecord(value)) return false;
  const draft = value.draft;
  if (
    typeof value.savedAt !== "string" ||
    typeof value.commanderId !== "string" ||
    typeof value.collectionSize !== "number" ||
    typeof value.truncated !== "boolean" ||
    !isRecord(draft)
  ) {
    return false;
  }
  const commander = draft.commander;
  const pickOk = (p: unknown) =>
    isRecord(p) && typeof p.cardId === "string" && typeof p.name === "string" && typeof p.role === "string";
  const basicOk = (b: unknown) => isRecord(b) && typeof b.name === "string" && typeof b.count === "number";
  return (
    pickOk(commander) &&
    Array.isArray(draft.picks) &&
    draft.picks.every(pickOk) &&
    Array.isArray(draft.basics) &&
    draft.basics.every(basicOk) &&
    Array.isArray(draft.curve) &&
    draft.curve.every((n) => typeof n === "number") &&
    isRecord(draft.counts) &&
    Array.isArray(draft.warnings) &&
    typeof draft.total === "number"
  );
}

/** The kept draft, when it can still be offered; a stale or broken one is
 *  removed. */
export function readLastAiDraft(
  viewerId: string,
  context: { now?: number; collectionSize: number; commanderIds: ReadonlySet<string> },
  storage: Storage | null = browserStorage(),
): StoredAiDraft | null {
  if (!storage) return null;
  const key = lastAiDraftKey(viewerId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const now = context.now ?? Date.now();
    const age = isStored(parsed) ? now - Date.parse(parsed.savedAt) : Number.NaN;
    if (
      !isStored(parsed) ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > LAST_AI_DRAFT_DAYS * 24 * 60 * 60 * 1000 ||
      parsed.collectionSize !== context.collectionSize ||
      !context.commanderIds.has(parsed.commanderId)
    ) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* storage refused: nothing to clean */
    }
    return null;
  }
}

export function writeLastAiDraft(viewerId: string, value: StoredAiDraft, storage: Storage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(lastAiDraftKey(viewerId), JSON.stringify(value));
  } catch {
    /* full or blocked: the draft is still on screen */
  }
}

export function clearLastAiDraft(viewerId: string, storage: Storage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(lastAiDraftKey(viewerId));
  } catch {
    /* blocked: nothing kept */
  }
}
