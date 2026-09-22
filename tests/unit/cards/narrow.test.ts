import { describe, expect, it } from "vitest";
import { narrowCard } from "@/lib/cards/narrow";
import type { Card as CardRow } from "@/types/supabase";

function row(overrides: Record<string, unknown>): CardRow {
  return {
    visibility: "public",
    rarity: "rare",
    card_type: "creature",
    color_identity: ["blue"],
    face_content: null,
    watermark: null,
    ...overrides,
  } as unknown as CardRow;
}

describe("narrowCard", () => {
  it("passes valid enum values through", () => {
    expect(narrowCard(row({}))).toMatchObject({
      visibility: "public",
      rarity: "rare",
      card_type: "creature",
      color_identity: ["blue"],
    });
  });
  it("falls back safely on unknown text — private, null, and only the known colors", () => {
    expect(
      narrowCard(
        row({
          visibility: "weird",
          rarity: "legendary",
          card_type: "dragon",
          color_identity: ["red", "chartreuse"],
        }),
      ),
    ).toMatchObject({
      visibility: "private",
      rarity: null,
      card_type: null,
      color_identity: ["red"],
    });
  });
  it("keeps the jsonb columns as-is (validated on write)", () => {
    const face = { kind: "planeswalker", loyalty_abilities: [] };
    expect(narrowCard(row({ face_content: face })).face_content).toBe(face);
  });
});
