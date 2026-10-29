import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// recentAiTitles — the "do not reuse" list. A card of two named parts is
// labelled "Front // Back" (a split, a double-faced fill): each name is a
// title of its own (review of #639: the front's name was never matched).
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
const s = vi.hoisted(() => ({ jobs: [] as unknown[], ideas: [] as unknown[] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: async () => ({ data: table === "ai_generation_jobs" ? s.jobs : s.ideas, error: null }),
      };
      return chain;
    },
  }),
}));

import { recentAiTitles } from "@/lib/ai/recent-designs";

describe("recentAiTitles", () => {
  it("splits a two-part label into its names; one-part labels and placeholders as before", async () => {
    s.jobs = [
      { steps: [{ label: "Hollow Village Smith // Moonlit Ravager" }, { label: "Moonlit Ravager" }] },
      { steps: [{ label: "Emberlash // Frostbind" }] },
      { steps: [{ label: "Lone Title" }, { label: "Your card" }] },
    ];
    s.ideas = [{ ideas: [{ title: "Idea One" }] }];
    expect(await recentAiTitles("user-1")).toEqual([
      "Hollow Village Smith",
      "Moonlit Ravager",
      "Moonlit Ravager",
      "Emberlash",
      "Frostbind",
      "Lone Title",
      "Idea One",
    ]);
  });
});
