import { describe, expect, it } from "vitest";
import { DESIGN_CHUNK_SIZE, splitDesignSlots } from "@/lib/ai/card-design";

describe("splitDesignSlots — parallel design chunks for big batches", () => {
  it("keeps small batches as one call", () => {
    const slots = Array.from({ length: DESIGN_CHUNK_SIZE }, (_, i) => i);
    expect(splitDesignSlots(slots)).toEqual([slots]);
    expect(splitDesignSlots([1])).toEqual([[1]]);
  });

  it("splits a 100-card Commander deck into four even chunks, in order", () => {
    const slots = Array.from({ length: 100 }, (_, i) => i);
    const chunks = splitDesignSlots(slots);
    expect(chunks.map((c) => c.length)).toEqual([25, 25, 25, 25]);
    expect(chunks.flat()).toEqual(slots);
  });

  it("balances uneven sizes instead of leaving a tiny tail", () => {
    const chunks = splitDesignSlots(Array.from({ length: 60 }, (_, i) => i));
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 20]);
    const twentySix = splitDesignSlots(Array.from({ length: 26 }, (_, i) => i));
    expect(twentySix.map((c) => c.length)).toEqual([13, 13]);
    expect(twentySix.every((c) => c.length <= DESIGN_CHUNK_SIZE)).toBe(true);
  });
});
