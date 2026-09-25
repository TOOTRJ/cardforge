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
    // No template and no card to read it from = can't tell → touched
    // (lib/render/stored-render.ts: "without it every bump counts").
    expect(isRenderStale(19, null, scoped, 21)).toBe(true);
    expect(isRenderStale(20, null, scoped, 21)).toBe(true);
    // A frame_style that WAS read ({} or a retired value) draws the default
    // (m15): bump 20 touched it, 21 didn't.
    expect(isRenderStale(20, null, scoped, 21, { frame_style: {} })).toBe(false);
    expect(isRenderStale(19, null, scoped, 21, { frame_style: {} })).toBe(true);
    expect(isRenderStale(20, "regular", scoped, 21)).toBe(false);
    expect(isRenderStale(20, "regular", scoped, 21, { frame_style: { template: "regular" } })).toBe(false);
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
    frame_style: { template: "saga" },
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

  it("never flags a card that also owes a correction — the sweep will override the choice", async () => {
    const { hasNewerLook } = await import("@/lib/cards/layout-version");
    // v21 COMMON: v22 (opt-in) and the v23 set-mark sweep are both pending.
    expect(hasNewerLook({ ...base, rarity: "common", layout_version: 21 })).toBe(false);
  });

  it("never flags a SWEEP-only pending bump — the platform re-bakes those", async () => {
    const { hasNewerLook, CARD_LAYOUT_VERSION } = await import("@/lib/cards/layout-version");
    // v22 → v23 is the sweep-policy set-mark fix for commons.
    expect(hasNewerLook({ ...base, layout_version: 22, rarity: "common" })).toBe(false);
    expect(hasNewerLook({ ...base, layout_version: CARD_LAYOUT_VERSION })).toBe(false);
    // A made-up future: v30, unscoped, sweep only vs opt-in.
    expect(
      hasNewerLook(
        { ...base, layout_version: 29 },
        { current: 30, scoped: {}, rollout: { 22: "opt-in", 30: "sweep" } },
      ),
    ).toBe(false);
    expect(
      hasNewerLook(
        { ...base, layout_version: 29 },
        { current: 30, scoped: {}, rollout: { 22: "opt-in", 30: "opt-in" } },
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
    const card = { frame_style: { template: "saga" }, rarity: "uncommon", set_icon_url: null, set_icon_code: null };
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
    // v20 bakes may be clean — v21's sweep is still owed.
    expect(hasPendingCorrection({ ...card, layout_version: 20 })).toBe(true);
  });
});

describe("downloadDiffersFromGallery — the download modal's note, per viewer", () => {
  it("paid: whenever the stored look is older; free: only while a correction is pending", async () => {
    const { downloadDiffersFromGallery, CARD_LAYOUT_VERSION } = await import("@/lib/cards/layout-version");
    const card = { rendered_image_url: "https://x/y.png", frame_style: { template: "saga" }, rarity: "uncommon" };
    // Opt-in pending (v21 uncommon): paid renders live → differs; free serves the bake → same.
    expect(downloadDiffersFromGallery({ ...card, layout_version: 21 }, true)).toBe(true);
    expect(downloadDiffersFromGallery({ ...card, layout_version: 21 }, false)).toBe(false);
    // Marked by a layout change: both render live.
    expect(downloadDiffersFromGallery({ ...card, layout_version: null }, false)).toBe(true);
    expect(downloadDiffersFromGallery({ ...card, layout_version: CARD_LAYOUT_VERSION }, true)).toBe(false);
    expect(downloadDiffersFromGallery({ ...card, rendered_image_url: null, layout_version: null }, false)).toBe(false);
  });
});

describe("storedLookIsOlder — the download modal's clean-download note", () => {
  it("is true whenever a stored image predates the current renderer", async () => {
    const { storedLookIsOlder, CARD_LAYOUT_VERSION } = await import("@/lib/cards/layout-version");
    const card = { rendered_image_url: "https://x/y.png", frame_style: { template: "saga" }, rarity: "uncommon" };
    expect(storedLookIsOlder({ ...card, layout_version: 21 })).toBe(true);
    expect(storedLookIsOlder({ ...card, layout_version: null })).toBe(true);
    expect(storedLookIsOlder({ ...card, layout_version: CARD_LAYOUT_VERSION })).toBe(false);
    expect(storedLookIsOlder({ ...card, layout_version: 21, rendered_image_url: null })).toBe(false);
    // v23 is card-scoped: an uncommon's v22 bake is what the renderer draws;
    // a common's is not.
    expect(storedLookIsOlder({ ...card, layout_version: 22 })).toBe(false);
    expect(storedLookIsOlder({ ...card, rarity: "common", layout_version: 22 })).toBe(true);
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
    const row = (over: Record<string, unknown>) => ({ layout_version: 22, rendered_image_url: png, frame_style: { template: "saga" }, rarity: "uncommon", set_icon_url: null, set_icon_code: null, ...over });

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

describe("v25 / v26 — the frame-review follow-ups (2026-09-25)", () => {
  const png = "https://x/y.png";
  const row = (template: string | undefined, over: Record<string, unknown> = {}) => ({
    layout_version: 24,
    rendered_image_url: png,
    frame_style: template === undefined ? {} : { template, finish: "regular" },
    rarity: "uncommon",
    set_icon_url: null,
    set_icon_code: null,
    ...over,
  });

  it("v25 re-bakes only the follow-up templates; v26 only etched cards, on any template", async () => {
    const { classifyForSweep } = await import("@/lib/cards/layout-version");
    for (const t of [
      "agclassic", "alphaland", "alphatoken", "retro", "retroland", "modern", "modernland", "extendedart",
      "battle", "split", "tarkirdragon",
    ]) {
      expect(classifyForSweep(row(t)), t).toBe("rebake");
    }
    // (tarkirghostfire moved to v27 — see the v27 / v28 block.)
    for (const t of ["m15", "m15land", "m15pw", "saga", "lotr", "avatar", "tarkirdraconic"]) {
      expect(classifyForSweep(row(t)), t).toBe("stamp");
    }
    // Etched: any template, and only etched.
    expect(classifyForSweep(row(undefined, { frame_style: { template: "m15", finish: "etched" } }))).toBe("rebake");
    expect(classifyForSweep(row(undefined, { frame_style: { template: "saga", finish: "etched" } }))).toBe("rebake");
    // A foil card isn't owed anything by v25/v26 (its own sweep is v28).
    expect(classifyForSweep(row(undefined, { frame_style: { template: "m15", finish: "foil" } }), 26)).toBe("opt-in");
    // Targeted: v25 leaves an etched m15 card alone, v26 takes it.
    const etchedM15 = row(undefined, { frame_style: { template: "m15", finish: "etched" } });
    expect(classifyForSweep(etchedM15, 25)).toBe("opt-in");
    expect(classifyForSweep(etchedM15, 26)).toBe("rebake");
  });

  it("a card with NO template is judged as the default (m15) frame it renders on", async () => {
    const { classifyForSweep, isRenderStale } = await import("@/lib/cards/layout-version");
    // 272 production cards carry frame_style = {} — v25 doesn't touch m15.
    expect(classifyForSweep(row(undefined))).toBe("stamp");
    expect(classifyForSweep(row(undefined, { frame_style: { template: "regular" } }))).toBe("stamp");
    // …but v24 (the M15 swap) does.
    expect(classifyForSweep(row(undefined, { layout_version: 23 }))).toBe("rebake");
    expect(isRenderStale(20, null, { 20: ["m15"], 21: ["battle"] }, 21, { frame_style: {} })).toBe(false);
    expect(isRenderStale(20, null, { 20: ["m15"], 21: ["m15"] }, 21, { frame_style: {} })).toBe(true);
    // Retired template strings draw m15 too (the v24 gap this closes).
    expect(isRenderStale(20, "regular", { 21: ["m15"] }, 21, { frame_style: { template: "regular" } })).toBe(true);
  });

  it("a row without frame_style can't be judged by the etched scope → conservative", async () => {
    const { isRenderStale, VERSION_SCOPES } = await import("@/lib/cards/layout-version");
    const scopes = { 26: VERSION_SCOPES[26] };
    expect(isRenderStale(25, "m15", {}, 26, { rarity: "rare" }, scopes)).toBe(true);
    expect(isRenderStale(25, "m15", {}, 26, { rarity: "rare", frame_style: {} }, scopes)).toBe(false);
    expect(isRenderStale(25, "m15", {}, 26, { rarity: "rare", frame_style: null }, scopes)).toBe(false);
    expect(isRenderStale(25, "m15", {}, 26, { frame_style: { finish: "etched" } }, scopes)).toBe(true);
  });

  it("both are sweeps: never an owner badge", async () => {
    const { rolloutPolicy, hasNewerLook, latestOptInVersion } = await import("@/lib/cards/layout-version");
    expect(rolloutPolicy(25)).toBe("sweep");
    expect(rolloutPolicy(26)).toBe("sweep");
    expect(latestOptInVersion()).toBe(22);
    expect(hasNewerLook({ ...row("modern"), visibility: "public" })).toBe(false);
  });
});

describe("v27 / v28 — the owner's follow-up decisions (2026-09-25)", () => {
  const png = "https://x/y.png";
  const row = (frameStyle: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    layout_version: 26,
    rendered_image_url: png,
    frame_style: frameStyle,
    rarity: "uncommon",
    set_icon_url: null,
    set_icon_code: null,
    ...over,
  });

  it("v27 re-bakes only Alpha, Dragon Wing and Ghostfire; v28 only foil cards, on any template", async () => {
    const { classifyForSweep } = await import("@/lib/cards/layout-version");
    for (const t of ["agclassic", "alphaland", "tarkirdragon", "tarkirghostfire"]) {
      expect(classifyForSweep(row({ template: t, finish: "regular" })), t).toBe("rebake");
    }
    for (const t of ["alphatoken", "m15", "modern", "retro", "saga", "tarkirdraconic", "bloomanime"]) {
      expect(classifyForSweep(row({ template: t, finish: "regular" })), t).toBe("stamp");
    }
    expect(classifyForSweep(row({ template: "m15", finish: "foil" }))).toBe("rebake");
    expect(classifyForSweep(row({ template: "m15pw", finish: "foil" }))).toBe("rebake");
    expect(classifyForSweep(row({ template: "m15", finish: "etched" }))).toBe("stamp");
    // Targeted: v27 leaves a foil m15 card alone, v28 takes it.
    expect(classifyForSweep(row({ template: "m15", finish: "foil" }), 27)).toBe("opt-in");
    expect(classifyForSweep(row({ template: "m15", finish: "foil" }), 28)).toBe("rebake");
  });

  it("a row without frame_style can't be judged by the foil scope → conservative", async () => {
    const { isRenderStale, VERSION_SCOPES } = await import("@/lib/cards/layout-version");
    const scopes = { 28: VERSION_SCOPES[28] };
    expect(isRenderStale(27, "m15", {}, 28, { rarity: "rare" }, scopes)).toBe(true);
    expect(isRenderStale(27, "m15", {}, 28, { frame_style: { finish: "regular" } }, scopes)).toBe(false);
    expect(isRenderStale(27, "m15", {}, 28, { frame_style: { finish: "foil" } }, scopes)).toBe(true);
  });

  it("both are sweeps: never an owner badge", async () => {
    const { rolloutPolicy, hasNewerLook, latestOptInVersion } = await import("@/lib/cards/layout-version");
    expect(rolloutPolicy(27)).toBe("sweep");
    expect(rolloutPolicy(28)).toBe("sweep");
    expect(latestOptInVersion()).toBe(22);
    expect(hasNewerLook({ ...row({ template: "agclassic", finish: "foil" }), visibility: "public" })).toBe(false);
  });
});
