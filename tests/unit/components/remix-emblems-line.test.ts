import { afterEach, describe, expect, it, vi } from "vitest";
import { emblemsLeftOutLine, fetchRemixEstimate } from "@/components/decks/ai-deck-panel";

// Emblems are not remixed (owner 2026-10-13): the remix dialog says so in
// ONE line, from the estimate's `emblems` count — in the confirm and under
// the form — and says nothing for a deck without one.

afterEach(() => vi.unstubAllGlobals());

describe("the remix dialog's emblem line", () => {
  it("one short sentence, singular and plural; nothing without an emblem", () => {
    expect(emblemsLeftOutLine(0)).toBe("");
    expect(emblemsLeftOutLine(1)).toBe("1 emblem is left out: emblems are not remixed.");
    expect(emblemsLeftOutLine(3)).toBe("3 emblems are left out: emblems are not remixed.");
  });

  it("reads the count from the estimate route (an older answer without it is none)", async () => {
    const answer = (body: Record<string, unknown>) =>
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status: 200 }));
    answer({ ok: true, cards: 2, credits: 2, doubleFaced: 0, skipped: 0, emblems: 1 });
    expect(await fetchRemixEstimate("deck-1")).toEqual({ cards: 2, credits: 2, doubleFaced: 0, skipped: 0, emblems: 1 });
    answer({ ok: true, cards: 2, credits: 2, doubleFaced: 0, skipped: 0 });
    expect(await fetchRemixEstimate("deck-1")).toMatchObject({ emblems: 0 });
  });
});
