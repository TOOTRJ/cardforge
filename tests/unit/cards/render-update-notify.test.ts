import { describe, expect, it } from "vitest";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { notifyOwnersOfRenderUpdates, staleCountsByOwner } from "@/lib/cards/render-update-notify";
import { chainClient, called, payloadOf } from "@/tests/stubs/supabase-chain";

describe("staleCountsByOwner — who gets a render_update notification", () => {
  it("counts only published, baked rows with a pending OPT-IN bump, per owner", () => {
    const png = "https://x/card.png";
    const counts = staleCountsByOwner([
      // Not baked yet (an AI card between publish and bake) — no newer look.
      { owner_id: "a", layout_version: null, rendered_image_url: null, frame_style: { template: "m15" } },
      // v21 → the v22 typography update (opt-in) is pending: counted.
      { owner_id: "a", layout_version: 21, rendered_image_url: png, frame_style: { template: "m15" }, rarity: "uncommon" },
      // v22 common → only the v23 set-mark SWEEP is pending: the platform's job, not counted.
      { owner_id: "a", layout_version: 22, rendered_image_url: png, frame_style: { template: "m15" }, rarity: "common" },
      { owner_id: "a", layout_version: CARD_LAYOUT_VERSION, rendered_image_url: png, frame_style: { template: "m15" } },
      // A frame-geometry change (null stamp) is a platform re-bake, never a badge.
      { owner_id: "d", layout_version: null, rendered_image_url: png, frame_style: { template: "m15" } },
      { owner_id: "b", layout_version: 3, rendered_image_url: png, frame_style: {} },
      // A bake that failed after publish stays quiet too.
      { owner_id: "c", layout_version: 3, rendered_image_url: null, frame_style: {} },
    ]);
    expect(counts.get("a")).toBe(1);
    expect(counts.get("b")).toBe(1);
    expect(counts.has("c")).toBe(false);
    expect(counts.has("d")).toBe(false);
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

describe("notifyOwnersOfRenderUpdates — keyed on the newest OPT-IN version", () => {
  it("notifies an owner with a pending opt-in bump once, with payload version 22, never for sweep-only cards", async () => {
    const png = "https://x/card.png";
    const stub = chainClient((table, calls) => {
      if (table === "cards") {
        return {
          data: [
            { owner_id: "a", layout_version: 21, rendered_image_url: png, frame_style: { template: "m15" }, visibility: "public", rarity: "uncommon" },
            { owner_id: "b", layout_version: 22, rendered_image_url: png, frame_style: { template: "m15" }, visibility: "public", rarity: "common" },
          ],
        };
      }
      if (table === "notifications" && called(calls, "select")) return { data: [] };
      return { error: null };
    });
    const result = await notifyOwnersOfRenderUpdates(stub.client as never);
    expect(result).toMatchObject({ owners: 1, notified: 1 });
    const scan = stub.forTable("cards")[0].calls;
    expect(called(scan, "lt", "layout_version")).toBe(true);
    const inserts = stub.forTable("notifications").filter((e) => called(e.calls, "insert"));
    expect(inserts).toHaveLength(1);
    expect(payloadOf(inserts[0].calls, "insert")).toMatchObject({
      recipient_id: "a",
      type: "render_update",
      payload: { version: 22, count: 1 },
    });
  });
});
