import { describe, expect, it } from "vitest";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { notifyOwnersOfRenderUpdates, staleCountsByOwner } from "@/lib/cards/render-update-notify";
import { chainClient, called, payloadOf } from "@/tests/stubs/supabase-chain";
import { UNTOUCHED_SINCE_V22 } from "@/tests/stubs/layout-scope-cards";

// Cards no sweep since v22 changed (lotr, single-word): a v21 bake of one
// has only the v22 OPT-IN pending.
const lotr = UNTOUCHED_SINCE_V22;

describe("staleCountsByOwner — who gets a render_update notification", () => {
  it("counts only published, baked rows with a pending OPT-IN bump, per owner", () => {
    const png = "https://x/card.png";
    const counts = staleCountsByOwner([
      // Not baked yet (an AI card between publish and bake) — no newer look.
      { owner_id: "a", layout_version: null, rendered_image_url: null, frame_style: { template: "saga" } },
      // v21 → the v22 typography update (opt-in) is pending: counted.
      { ...lotr, owner_id: "a", layout_version: 21, rendered_image_url: png },
      // v22 common → only the v23 set-mark SWEEP is pending: the platform's job, not counted.
      { ...lotr, owner_id: "a", layout_version: 22, rendered_image_url: png, rarity: "common" },
      // v21 with a two-word name → the v29 word-spacing SWEEP is pending too:
      // the sweep re-bakes it, opt-in look included — not counted.
      { ...lotr, owner_id: "a", layout_version: 21, rendered_image_url: png, title: "Red Worm" },
      // A row that doesn't carry the v29 columns can't be judged → owes the
      // sweep (conservative) → not counted.
      { owner_id: "a", layout_version: 21, rendered_image_url: png, frame_style: { template: "lotr" }, rarity: "uncommon" },
      { owner_id: "a", layout_version: CARD_LAYOUT_VERSION, rendered_image_url: png, frame_style: { template: "saga" } },
      // A frame-geometry change (null stamp) is a platform re-bake, never a badge.
      { owner_id: "d", layout_version: null, rendered_image_url: png, frame_style: { template: "saga" } },
      // v3 also owes the v20/v21/v23 sweeps: the sweep re-bakes it (opt-in
      // look included), so the badge would offer a choice that doesn't exist.
      { owner_id: "b", layout_version: 3, rendered_image_url: png, frame_style: {} },
      // A bake that failed after publish stays quiet too.
      { owner_id: "c", layout_version: 3, rendered_image_url: null, frame_style: {} },
    ]);
    expect(counts.get("a")).toBe(1);
    expect(counts.has("b")).toBe(false);
    expect(counts.has("c")).toBe(false);
    expect(counts.has("d")).toBe(false);
    expect(counts.size).toBe(1);
  });

  it("is empty when nothing is stale", () => {
    expect(
      staleCountsByOwner([
        { owner_id: "a", layout_version: CARD_LAYOUT_VERSION, frame_style: { template: "saga" } },
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
            { ...lotr, owner_id: "a", layout_version: 21, rendered_image_url: png, visibility: "public" },
            { ...lotr, owner_id: "b", layout_version: 22, rendered_image_url: png, visibility: "public", rarity: "common" },
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

describe("notifyOwnersOfRenderUpdates — once per owner per opt-in version", () => {
  it("skips an owner who already has the v22 notification, looked up by that key", async () => {
    const stub = chainClient((table, calls) => {
      if (table === "cards") {
        return {
          data: [
            { ...lotr, owner_id: "a", layout_version: 21, rendered_image_url: "https://x/c.png", visibility: "public" },
          ],
        };
      }
      if (table === "notifications" && called(calls, "select")) return { data: [{ id: "n1" }] };
      return { error: null };
    });
    const result = await notifyOwnersOfRenderUpdates(stub.client as never);
    expect(result).toMatchObject({ owners: 1, notified: 0 });
    const lookups = stub.forTable("notifications");
    expect(lookups.some((e) => called(e.calls, "insert"))).toBe(false);
    const contains = lookups[0].calls.find((c) => c.method === "contains");
    expect(contains?.args).toEqual(["payload", { version: 22 }]);
  });
});
