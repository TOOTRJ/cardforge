import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// GET /api/tools/collection-builder/commander-scores — the free "Best
// supported" ranking: the tool's gate first (closed → 404, nothing read),
// then the caller's own commanders scored from their own cards; a failed
// read answers 503, never a ranking from half a collection.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({ access: vi.fn(), commanders: vi.fn(), cards: vi.fn() }));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access }));
vi.mock("@/lib/tools/collection/queries", () => ({
  listOwnedCommanders: m.commanders,
  listScoringCards: m.cards,
}));

import { GET } from "@/app/api/tools/collection-builder/commander-scores/route";

const KRENKO = {
  id: "k",
  name: "Krenko, Mob Boss",
  typeLine: "Legendary Creature — Goblin Warrior",
  oracleText: "{T}: Create X 1/1 red Goblin creature tokens.",
  colorIdentity: ["R"],
  commanderLegal: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.commanders.mockResolvedValue([KRENKO, { ...KRENKO, id: "banned", name: "Banned One", commanderLegal: false }]);
  m.cards.mockResolvedValue([
    { name: "Goblin Matron", typeLine: "Creature — Goblin", oracleText: "", colorIdentity: ["R"], commanderLegal: true },
  ]);
});

describe("commander scores route", () => {
  it("a closed tool answers 404 and reads nothing", async () => {
    m.access.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(404);
    expect(m.commanders).not.toHaveBeenCalled();
    expect(m.cards).not.toHaveBeenCalled();
  });

  it("scores the legal commanders, privately", async () => {
    m.access.mockResolvedValue({ userId: "u1", via: "grant" });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as { ok: boolean; scores: Record<string, { fit: number }> };
    expect(body.ok).toBe(true);
    expect(Object.keys(body.scores)).toEqual(["k"]);
    expect(body.scores.k.fit).toBe(1);
    // A failed commanders read must not answer "ranked over nothing".
    expect(m.commanders).toHaveBeenCalledWith({ throwOnError: true });
  });

  it("a failed read answers 503", async () => {
    m.access.mockResolvedValue({ userId: "u1", via: "grant" });
    m.cards.mockRejectedValue(new Error("scoring read failed"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(((await response.json()) as { ok: boolean }).ok).toBe(false);
  });
});
