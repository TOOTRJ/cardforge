import { describe, expect, it } from "vitest";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { staleCountsByOwner } from "@/lib/cards/render-update-notify";

describe("staleCountsByOwner — who gets a render_update notification", () => {
  it("counts only stale published rows, per owner", () => {
    const counts = staleCountsByOwner([
      { owner_id: "a", layout_version: null, frame_style: { template: "m15" } },
      { owner_id: "a", layout_version: CARD_LAYOUT_VERSION - 1, frame_style: { template: "m15" } },
      { owner_id: "a", layout_version: CARD_LAYOUT_VERSION, frame_style: { template: "m15" } },
      { owner_id: "b", layout_version: 3, frame_style: {} },
    ]);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.size).toBe(2);
  });

  it("is empty when nothing is stale", () => {
    expect(
      staleCountsByOwner([
        { owner_id: "a", layout_version: CARD_LAYOUT_VERSION, frame_style: { template: "m15" } },
      ]).size,
    ).toBe(0);
  });
});
