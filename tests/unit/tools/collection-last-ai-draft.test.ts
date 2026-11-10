import { describe, expect, it } from "vitest";
import type { CommanderDraft } from "@/lib/tools/collection/builder";
import {
  LAST_AI_DRAFT_DAYS,
  clearLastAiDraft,
  lastAiDraftKey,
  readLastAiDraft,
  writeLastAiDraft,
  type StoredAiDraft,
} from "@/lib/tools/collection/last-ai-draft";

// ---------------------------------------------------------------------------
// The last "Build with AI" draft, kept in this browser for 7 days (owner
// 2026-11-09): offered back only while it can still be saved; a stale,
// broken or unreadable entry is dropped; storage that throws is ignored.
// ---------------------------------------------------------------------------

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const DRAFT = {
  commander: { cardId: "c1", scryfallId: "s1", name: "Krenko, Mob Boss", role: "core", manaValue: 4, typeLine: null, manaCost: null, imageUrl: null },
  picks: [],
  basics: [],
  total: 1,
  short: 99,
  counts: { land: 0, ramp: 0, draw: 0, removal: 0, wipe: 0, core: 0 },
  curve: [0, 0, 0, 0, 0, 0, 0, 0],
  poolSize: 0,
  warnings: [],
  strategy: "Go wide.",
} satisfies CommanderDraft;

const NOW = Date.parse("2026-11-09T12:00:00Z");
const stored = (over: Partial<StoredAiDraft> = {}): StoredAiDraft => ({
  savedAt: new Date(NOW - 60_000).toISOString(),
  commanderId: "c1",
  collectionSize: 71,
  truncated: false,
  draft: DRAFT,
  ...over,
});
const context = { now: NOW, collectionSize: 71, commanderIds: new Set(["c1"]) };

describe("the kept AI draft", () => {
  it("round-trips per viewer", () => {
    const storage = memoryStorage();
    writeLastAiDraft("u1", stored(), storage);
    expect(storage.map.has(lastAiDraftKey("u1"))).toBe(true);
    expect(readLastAiDraft("u1", context, storage)?.draft.strategy).toBe("Go wide.");
    expect(readLastAiDraft("u2", context, storage)).toBeNull();
    clearLastAiDraft("u1", storage);
    expect(readLastAiDraft("u1", context, storage)).toBeNull();
  });

  it.each([
    ["older than the week", stored({ savedAt: new Date(NOW - (LAST_AI_DRAFT_DAYS * 24 + 1) * 3_600_000).toISOString() })],
    ["from the future", stored({ savedAt: new Date(NOW + 3_600_000).toISOString() })],
    ["for a collection that changed size", stored({ collectionSize: 70 })],
    ["for a commander no longer owned", stored({ commanderId: "gone" })],
  ])("is dropped when %s", (_label, value) => {
    const storage = memoryStorage({ [lastAiDraftKey("u1")]: JSON.stringify(value) });
    expect(readLastAiDraft("u1", context, storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it("drops what isn't a draft, or a draft of another shape the review can't draw", () => {
    const { curve: _curve, ...noCurve } = DRAFT;
    for (const raw of [
      "not json",
      JSON.stringify({ savedAt: "x" }),
      JSON.stringify(null),
      JSON.stringify(stored({ draft: noCurve as unknown as CommanderDraft })),
      JSON.stringify(stored({ draft: { ...DRAFT, picks: [{ cardId: 1 }] } as unknown as CommanderDraft })),
      JSON.stringify(stored({ draft: { ...DRAFT, commander: null } as unknown as CommanderDraft })),
    ]) {
      const storage = memoryStorage({ [lastAiDraftKey("u1")]: raw });
      expect(readLastAiDraft("u1", context, storage)).toBeNull();
      expect(storage.map.size).toBe(0);
    }
  });

  it("never throws when storage does", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLastAiDraft("u1", context, broken)).toBeNull();
    expect(() => writeLastAiDraft("u1", stored(), broken)).not.toThrow();
    expect(() => clearLastAiDraft("u1", broken)).not.toThrow();
    expect(readLastAiDraft("u1", context, null)).toBeNull();
  });
});
