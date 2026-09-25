import { describe, expect, it } from "vitest";
import {
  CARD_LAYOUT_VERSION,
  isRenderStale,
  templateOfFrameStyle,
} from "@/lib/cards/layout-version";

describe("isRenderStale — which stored renders a version bump invalidates", () => {
  it("treats unversioned or override-cleared renders as stale", () => {
    expect(isRenderStale(null, "m15")).toBe(true);
    expect(isRenderStale(undefined, "m15")).toBe(true);
  });

  it("treats the current (or a newer) version as current", () => {
    expect(isRenderStale(CARD_LAYOUT_VERSION, "m15")).toBe(false);
    expect(isRenderStale(CARD_LAYOUT_VERSION + 1, "m15")).toBe(false);
  });

  it("with no scoped bumps, every older version is stale", () => {
    expect(isRenderStale(CARD_LAYOUT_VERSION - 1, "m15", {})).toBe(true);
    expect(isRenderStale(1, "battle", {})).toBe(true);
  });

  it("a template-scoped bump leaves other templates current", () => {
    const scoped = { 20: ["m15", "m15land"], 21: ["battle"] };
    // Baked at 19, current 21: bumps 20 (m15 family) and 21 (battle).
    expect(isRenderStale(19, "m15", scoped, 21)).toBe(true);
    expect(isRenderStale(19, "battle", scoped, 21)).toBe(true);
    expect(isRenderStale(19, "saga", scoped, 21)).toBe(false);
    // Baked at 20: only bump 21 applies.
    expect(isRenderStale(20, "m15", scoped, 21)).toBe(false);
    expect(isRenderStale(20, "battle", scoped, 21)).toBe(true);
    // An unknown template is treated as touched.
    expect(isRenderStale(19, null, scoped, 21)).toBe(true);
    // One unscoped bump in the range touches everything.
    expect(isRenderStale(19, "saga", { 20: ["m15"] }, 21)).toBe(true);
  });

  it("reads the template out of the frame_style jsonb", () => {
    expect(templateOfFrameStyle({ template: "m15", finish: "foil" })).toBe("m15");
    expect(templateOfFrameStyle({})).toBeNull();
    expect(templateOfFrameStyle(null)).toBeNull();
    expect(templateOfFrameStyle("m15")).toBeNull();
  });
});

describe("hasNewerLook — only an owner opt-in bump is the owner's call (TODO 0.20)", () => {
  const base = {
    visibility: "public",
    rendered_image_url: "https://x/y.png",
    frame_style: { template: "m15" },
    rarity: "uncommon",
    set_icon_url: null,
    set_icon_code: null,
  };

  it("flags a published, baked card with a pending OPT-IN bump (v22 typography)", async () => {
    const { hasNewerLook } = await import("@/lib/cards/layout-version");
    expect(hasNewerLook({ ...base, layout_version: 21 })).toBe(true);
    // Private cards never carry a render; unbaked cards are "not baked".
    expect(hasNewerLook({ ...base, layout_version: 21, visibility: "private" })).toBe(false);
    expect(hasNewerLook({ ...base, layout_version: 21, rendered_image_url: null })).toBe(false);
  });

  it("never flags a SWEEP-only pending bump — the platform re-bakes those", async () => {
    const { hasNewerLook, CARD_LAYOUT_VERSION } = await import("@/lib/cards/layout-version");
    // v22 → v23 is the sweep-policy set-mark fix for commons.
    expect(hasNewerLook({ ...base, layout_version: 22, rarity: "common" })).toBe(false);
    expect(hasNewerLook({ ...base, layout_version: CARD_LAYOUT_VERSION })).toBe(false);
    // A made-up future: v24 sweep only.
    expect(
      hasNewerLook(
        { ...base, layout_version: 23 },
        { current: 24, rollout: { 22: "opt-in", 23: "sweep", 24: "sweep" } },
      ),
    ).toBe(false);
    expect(
      hasNewerLook(
        { ...base, layout_version: 23 },
        { current: 24, rollout: { 22: "opt-in", 23: "sweep", 24: "opt-in" } },
      ),
    ).toBe(true);
  });

  it("never flags a null stamp — a frame-geometry change marked it for a platform re-bake", async () => {
    const { hasNewerLook } = await import("@/lib/cards/layout-version");
    // 2026-09-25: one override save badged 176 of the dev DB's 189 cards.
    expect(hasNewerLook({ ...base, layout_version: null })).toBe(false);
  });
});

describe("latestOptInVersion — what owner notifications are keyed on", () => {
  it("is the newest opt-in version at or below current, or null", async () => {
    const { latestOptInVersion } = await import("@/lib/cards/layout-version");
    expect(latestOptInVersion()).toBe(22);
    expect(latestOptInVersion({ 22: "opt-in", 30: "opt-in" }, 29)).toBe(22);
    expect(latestOptInVersion({ 22: "opt-in", 30: "opt-in" }, 30)).toBe(30);
    expect(latestOptInVersion({ 20: "sweep" }, 25)).toBeNull();
  });
});

describe("hasPendingCorrection — when the platform still owes a card a re-bake", () => {
  it("is true for a null stamp or a pending SWEEP bump, false for opt-in-only", async () => {
    const { hasPendingCorrection, CARD_LAYOUT_VERSION } = await import("@/lib/cards/layout-version");
    const card = { frame_style: { template: "m15" }, rarity: "uncommon", set_icon_url: null, set_icon_code: null };
    expect(hasPendingCorrection({ ...card, layout_version: null })).toBe(true);
    // v22 common → v23 set-mark sweep pending.
    expect(hasPendingCorrection({ ...card, layout_version: 22, rarity: "common" })).toBe(true);
    // v22 uncommon → v23 didn't change it → nothing owed.
    expect(hasPendingCorrection({ ...card, layout_version: 22 })).toBe(false);
    // v21 uncommon → only the v22 opt-in is pending: the owner's call, not a correction.
    expect(hasPendingCorrection({ ...card, layout_version: 21 })).toBe(false);
    expect(hasPendingCorrection({ ...card, layout_version: CARD_LAYOUT_VERSION })).toBe(false);
    // Very old bakes owe the v20/v21 watermark sweeps.
    expect(hasPendingCorrection({ ...card, layout_version: 19 })).toBe(true);
  });
});

describe("storedLookIsOlder — the download modal's clean-download note", () => {
  it("is true whenever a stored image predates the current renderer", async () => {
    const { storedLookIsOlder, CARD_LAYOUT_VERSION } = await import("@/lib/cards/layout-version");
    const card = { rendered_image_url: "https://x/y.png", frame_style: { template: "m15" }, rarity: "uncommon" };
    expect(storedLookIsOlder({ ...card, layout_version: 21 })).toBe(true);
    expect(storedLookIsOlder({ ...card, layout_version: null })).toBe(true);
    expect(storedLookIsOlder({ ...card, layout_version: CARD_LAYOUT_VERSION })).toBe(false);
    expect(storedLookIsOlder({ ...card, layout_version: 21, rendered_image_url: null })).toBe(false);
  });
});

describe("card-scoped bumps (VERSION_SCOPES)", () => {
  it("v23 only touches commons on the default mark; everything else is stamped current", async () => {
    const { isRenderStale, VERSION_SCOPES } = await import("@/lib/cards/layout-version");
    const scopes = { 23: VERSION_SCOPES[23] };
    const common = { rarity: "common", set_icon_url: null, set_icon_code: null };
    expect(isRenderStale(22, "m15", {}, 23, common, scopes)).toBe(true);
    expect(isRenderStale(22, "m15", {}, 23, { ...common, rarity: "uncommon" }, scopes)).toBe(false);
    expect(isRenderStale(22, "m15", {}, 23, { ...common, set_icon_code: "dom" }, scopes)).toBe(false);
    expect(isRenderStale(22, "m15", {}, 23, { ...common, set_icon_url: "https://x/icon.png" }, scopes)).toBe(false);
    // No card, or a row without rarity → conservative.
    expect(isRenderStale(22, "m15", {}, 23, undefined, scopes)).toBe(true);
    expect(isRenderStale(22, "m15", {}, 23, { set_icon_url: null, set_icon_code: null }, scopes)).toBe(true);
    // An older bake still crosses an unscoped version on the way up.
    expect(isRenderStale(21, "m15", {}, 23, { ...common, rarity: "rare" }, scopes)).toBe(true);
  });
});

describe("rollout policy + sweep classification", () => {
  it("v22 is owner opt-in; unlisted versions default to sweep", async () => {
    const { rolloutPolicy } = await import("@/lib/cards/layout-version");
    expect(rolloutPolicy(22)).toBe("opt-in");
    expect(rolloutPolicy(23)).toBe("sweep");
    expect(rolloutPolicy(7)).toBe("sweep");
  });

  it("classifies what a sweep may do to a card", async () => {
    const { classifyForSweep } = await import("@/lib/cards/layout-version");
    const rollout = { 22: "opt-in" as const, 23: "sweep" as const };
    const scopes = { 23: (c: { rarity?: string | null; set_icon_url?: string | null; set_icon_code?: string | null }) => !c.set_icon_url && !c.set_icon_code && c.rarity === "common" };
    const opts = { rollout, scopes, scoped: {}, current: 23 };
    const png = "https://x/y.png";
    const row = (over: Record<string, unknown>) => ({ layout_version: 22, rendered_image_url: png, frame_style: { template: "m15" }, rarity: "uncommon", set_icon_url: null, set_icon_code: null, ...over });

    // v22 → v23: an uncommon's bake didn't change → stamp, no render.
    expect(classifyForSweep(row({}), undefined, opts)).toBe("stamp");
    // A common on the default mark changed → re-bake.
    expect(classifyForSweep(row({ rarity: "common" }), undefined, opts)).toBe("rebake");
    expect(classifyForSweep(row({ rarity: "common" }), 23, opts)).toBe("rebake");
    // Still on v21: only the opt-in v22 is pending for an uncommon → leave it.
    expect(classifyForSweep(row({ layout_version: 21 }), undefined, opts)).toBe("opt-in");
    expect(classifyForSweep(row({ layout_version: 21 }), 23, opts)).toBe("opt-in");
    // A common on v21 has v22 (opt-in) AND v23 (sweep) pending → the v23
    // sweep re-bakes it (v22 rides along — unavoidable, documented).
    expect(classifyForSweep(row({ layout_version: 21, rarity: "common" }), 23, opts)).toBe("rebake");
    // Never baked → rebake; already current → current.
    expect(classifyForSweep(row({ rendered_image_url: null }), 23, opts)).toBe("rebake");
    expect(classifyForSweep(row({ layout_version: 23 }), 23, opts)).toBe("current");
  });
});
