import { describe, expect, it } from "vitest";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { staleCountsByOwner } from "@/lib/cards/render-update-notify";

describe("staleCountsByOwner — who gets a render_update notification", () => {
  it("counts only published rows WITH a render baked by an older layout, per owner", () => {
    const png = "https://x/card.png";
    const counts = staleCountsByOwner([
      // Not baked yet (an AI card between publish and bake) — no newer look.
      { owner_id: "a", layout_version: null, rendered_image_url: null, frame_style: { template: "m15" } },
      { owner_id: "a", layout_version: CARD_LAYOUT_VERSION - 1, rendered_image_url: png, frame_style: { template: "m15" } },
      { owner_id: "a", layout_version: CARD_LAYOUT_VERSION, rendered_image_url: png, frame_style: { template: "m15" } },
      { owner_id: "b", layout_version: 3, rendered_image_url: png, frame_style: {} },
      // A bake that failed after publish stays quiet too.
      { owner_id: "c", layout_version: 3, rendered_image_url: null, frame_style: {} },
    ]);
    expect(counts.get("a")).toBe(1);
    expect(counts.get("b")).toBe(1);
    expect(counts.has("c")).toBe(false);
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
