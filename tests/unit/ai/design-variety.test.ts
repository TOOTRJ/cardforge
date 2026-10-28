import { describe, expect, it, vi } from "vitest";
import {
  DesignNotUsableError,
  VARIETY_AVOID_MAX,
  designFreshly,
  designVariety,
  repeatsRecentTitle,
  varietyPromptLines,
} from "@/lib/ai/design-variety";
import {
  AI_FAILURE_KINDS,
  AI_FAILURE_COPY,
  aiFailureMessage,
  classifyProviderError,
  creditOutcome,
  failedStepMessage,
  retryCreditNote,
} from "@/lib/ai/failure";
import { typesWithoutPublishedFrame } from "@/lib/creator/frame-random";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

describe("typesWithoutPublishedFrame", () => {
  const every = FRAME_TEMPLATE_VALUES.flatMap((template) =>
    ["w", "u", "b", "r", "g", "c", "m"].map((colour) => frameComboKey(template as FrameTemplate, colour)),
  );
  it("names a type with no published frame (battle today)", () => {
    expect(typesWithoutPublishedFrame(new Set(every.filter((key) => !key.startsWith("battle/"))))).toEqual(["battle"]);
    expect(typesWithoutPublishedFrame(new Set(every))).toEqual([]);
  });

  it("an empty (unreadable) frame list, or one that leaves no type, avoids nothing", () => {
    expect(typesWithoutPublishedFrame(new Set())).toEqual([]);
    expect(typesWithoutPublishedFrame(new Set(["no-such-frame/r"]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// lib/ai/design-variety.ts — two AI designs with the same options never
// send the same prompt (the owner's two identical cards, 2026-10-28), and
// lib/ai/failure.ts — what a failure tells the user.
// ---------------------------------------------------------------------------

describe("designVariety", () => {
  it("draws a different spark and nonce each time (real randomness)", () => {
    const blocks = Array.from({ length: 20 }, () => varietyPromptLines(designVariety()).join("\n"));
    expect(new Set(blocks).size).toBe(20);
  });

  it("names recent titles once each, folded (curly quotes, case, spacing), capped", () => {
    const variety = designVariety(
      ["Urza’s Lantern", "urza's  lantern", "", "  ", ...Array.from({ length: 30 }, (_, i) => `Card ${i}`)],
      () => 0,
    );
    expect(variety.avoidTitles[0]).toBe("Urza’s Lantern");
    expect(variety.avoidTitles.filter((t) => t.toLowerCase().includes("lantern"))).toHaveLength(1);
    expect(variety.avoidTitles).toHaveLength(VARIETY_AVOID_MAX);
    expect(varietyPromptLines(variety)[1]).toContain('"Urza’s Lantern"');
  });

  it("says the spark never outranks a pinned value or the theme", () => {
    expect(varietyPromptLines(designVariety([], () => 0.5))[0]).toContain(
      "inspiration only — every pinned value, requested type, colour, rarity and the theme above win over it",
    );
  });

  it("matches a repeat whatever the quotes or case", () => {
    expect(repeatsRecentTitle("URZA'S LANTERN", ["Urza’s Lantern"])).toBe(true);
    expect(repeatsRecentTitle("Urza's Beacon", ["Urza’s Lantern"])).toBe(false);
    expect(repeatsRecentTitle(null, ["x"])).toBe(false);
  });
});

describe("designFreshly", () => {
  it("keeps a fresh first design — one call", async () => {
    const design = vi.fn(async () => ({ title: "New One" }));
    await expect(designFreshly(["Old One"], design, (r) => r.title)).resolves.toEqual({ title: "New One" });
    expect(design).toHaveBeenCalledTimes(1);
  });

  it("designs again when the title repeats, with that title added to the avoid list", async () => {
    const design = vi
      .fn()
      .mockResolvedValueOnce({ title: "Old One" })
      .mockResolvedValueOnce({ title: "New One" });
    await expect(designFreshly(["Old One"], design, (r: { title: string }) => r.title)).resolves.toEqual({ title: "New One" });
    expect(design).toHaveBeenCalledTimes(2);
    const [first, second] = design.mock.calls.map((call) => call[0]);
    expect(first.nonce).not.toBe(second.nonce);
    expect(second.avoidTitles).toContain("Old One");
  });

  it("keeps a usable first answer when the second call fails, or when no time is left", async () => {
    const failing = vi.fn().mockResolvedValueOnce({ title: "Old One" }).mockRejectedValueOnce(new Error("busy"));
    await expect(designFreshly(["Old One"], failing, (r: { title: string }) => r.title)).resolves.toEqual({ title: "Old One" });
    const once = vi.fn(async () => ({ title: "Old One" }));
    await expect(designFreshly(["Old One"], once, (r) => r.title, { secondFits: () => false })).resolves.toEqual({ title: "Old One" });
    expect(once).toHaveBeenCalledTimes(1);
  });

  it("an answer the caller can't use, twice, is refused at plan time", async () => {
    const design = vi.fn(async () => ({ title: "X", type: "battle" }));
    await expect(
      designFreshly([], design, (r) => r.title, { acceptable: (r) => r.type !== "battle" }),
    ).rejects.toBeInstanceOf(DesignNotUsableError);
    expect(design).toHaveBeenCalledTimes(2);
  });
});

describe("failure copy", () => {
  it("every kind has one plain sentence, none naming keys, servers or providers", () => {
    for (const kind of AI_FAILURE_KINDS) {
      expect(AI_FAILURE_COPY[kind]).toMatch(/\.$/);
      expect(AI_FAILURE_COPY[kind]).not.toMatch(/key|server|gateway|flux|anthropic|gemini|quota/i);
    }
  });

  it("sorts raw provider errors", () => {
    expect(classifyProviderError("Request Moderated")).toBe("blocked");
    expect(classifyProviderError("The operation was aborted due to timeout")).toBe("timeout");
    expect(classifyProviderError("429 Too Many Requests")).toBe("busy");
    expect(classifyProviderError("Overloaded")).toBe("busy");
    expect(classifyProviderError("401 Unauthorized")).toBe("unavailable");
    expect(classifyProviderError("insufficient balance")).toBe("unavailable");
    expect(classifyProviderError("socket hang up")).toBe("failed");
  });

  it("the credit sentence is only ever what the record proves", () => {
    expect(creditOutcome(0)).toBe("No credits were used.");
    expect(creditOutcome(null)).toBe("No credits were used.");
    expect(creditOutcome(1)).toBe("Your credit was returned.");
    expect(creditOutcome(2)).toBe("Your 2 credits were returned.");
    expect(creditOutcome(0, true)).toContain("comes back to you automatically within the hour");
    expect(aiFailureMessage("design_busy")).toBe("The AI service is busy right now. Wait a minute, then try again. No credits were used.");
  });

  it("the deck runner's retry line says what the credit did, from the records", () => {
    expect(retryCreditNote([{ refunded: 1 }])).toBe("The failed attempt's credit was returned; retrying reserves it again.");
    expect(retryCreditNote([{ refunded: 0 }, { refunded: null }])).toBe(
      "The failed attempts used no credits; retrying reserves credits.",
    );
    expect(retryCreditNote([{ refunded: 1 }, { refund_pending: true }])).toContain("within the hour");
  });

  it("a failed step falls back to its own error (older steps, plan limits)", () => {
    expect(failedStepMessage({ error: "You're out of AI credits." })).toBe("You're out of AI credits. No credits were used.");
    expect(failedStepMessage({})).toBe(`${AI_FAILURE_COPY.step_failed} No credits were used.`);
    expect(failedStepMessage({ failure: "art_store", error: "raw storage text", refunded: 1 })).toBe(
      `${AI_FAILURE_COPY.art_store} Your credit was returned.`,
    );
  });
});
