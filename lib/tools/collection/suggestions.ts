import { collectionDeckType, type CollectionDeckTypeId } from "./archetypes";
import type { CommanderSupport } from "./commander-scores";

// ---------------------------------------------------------------------------
// "Suggest a commander"'s answer as the page holds it (client-safe), and its
// week in this browser (owner decision 8, 2026-11-09: a paid answer must
// not vanish on a reload — per-viewer, localStorage; every access wrapped,
// the page works without it). Offered back only while the collection holds
// as many different cards; a suggestion whose commander is gone is dropped.
// ---------------------------------------------------------------------------

export type CommanderSuggestion = {
  /** The commander's collection row. */
  commanderId: string;
  name: string;
  imageUrl: string | null;
  colorIdentity: string[];
  deckType: CollectionDeckTypeId | null;
  pitch: string;
  why: string;
  gaps: string;
  keyCards: { id: string; name: string; imageUrl?: string | null }[];
  /** The CODE's numbers (commander-scores.ts), never the model's. */
  support: CommanderSupport;
};

export type SuggestResult = { overview: string; suggestions: CommanderSuggestion[] };

export const LAST_SUGGESTIONS_DAYS = 7;
const KEY_PREFIX = "pipglyph.collection-builder.last-suggestions.v1:";

export type StoredSuggestions = { savedAt: string; collectionSize: number; result: SuggestResult };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function lastSuggestionsKey(viewerId: string): string {
  return `${KEY_PREFIX}${viewerId}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function isSuggestion(v: unknown): v is CommanderSuggestion {
  if (!isRecord(v) || !isRecord(v.support) || !isRecord(v.support.roles) || !isRecord(v.support.deckTypes)) return false;
  return (
    typeof v.commanderId === "string" &&
    typeof v.name === "string" &&
    typeof v.pitch === "string" &&
    typeof v.why === "string" &&
    typeof v.gaps === "string" &&
    Array.isArray(v.colorIdentity) &&
    Array.isArray(v.keyCards) &&
    v.keyCards.every((k) => isRecord(k) && typeof k.id === "string" && typeof k.name === "string") &&
    typeof v.support.inColours === "number" &&
    typeof v.support.fit === "number" &&
    Array.isArray(v.support.tribes)
  );
}

/** The kept suggestions, the ones whose commander is still owned; a stale
 *  or broken entry is removed. */
export function readLastSuggestions(
  viewerId: string,
  context: { now?: number; collectionSize: number; commanderIds: ReadonlySet<string> },
  storage: Storage | null = browserStorage(),
): StoredSuggestions | null {
  if (!storage) return null;
  const key = lastSuggestionsKey(viewerId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const now = context.now ?? Date.now();
    if (
      !isRecord(parsed) ||
      typeof parsed.savedAt !== "string" ||
      typeof parsed.collectionSize !== "number" ||
      !isRecord(parsed.result) ||
      typeof parsed.result.overview !== "string" ||
      !Array.isArray(parsed.result.suggestions) ||
      !parsed.result.suggestions.every(isSuggestion)
    ) {
      storage.removeItem(key);
      return null;
    }
    const age = now - Date.parse(parsed.savedAt);
    // A deck type renamed since is read as none (never sent to a draft).
    const suggestions = (parsed.result.suggestions as CommanderSuggestion[])
      .filter((s) => context.commanderIds.has(s.commanderId))
      .map((s) => ({ ...s, deckType: collectionDeckType(s.deckType)?.id ?? null }));
    if (
      !Number.isFinite(age) ||
      age < 0 ||
      age > LAST_SUGGESTIONS_DAYS * 24 * 60 * 60 * 1000 ||
      parsed.collectionSize !== context.collectionSize ||
      suggestions.length === 0
    ) {
      storage.removeItem(key);
      return null;
    }
    return {
      savedAt: parsed.savedAt,
      collectionSize: parsed.collectionSize,
      result: { overview: parsed.result.overview, suggestions },
    };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* storage refused: nothing to clean */
    }
    return null;
  }
}

export function writeLastSuggestions(viewerId: string, value: StoredSuggestions, storage: Storage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(lastSuggestionsKey(viewerId), JSON.stringify(value));
  } catch {
    /* full or blocked: the answer is still on screen */
  }
}

export function clearLastSuggestions(viewerId: string, storage: Storage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(lastSuggestionsKey(viewerId));
  } catch {
    /* blocked: nothing kept */
  }
}
