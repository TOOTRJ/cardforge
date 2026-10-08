import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARD_LAYOUT_VERSION,
  isRenderStale,
  templateOfFrameStyle,
} from "@/lib/cards/layout-version";
import { getFrameProfile, sameRect, underFrameArtRect, underFrameArtSlot } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { UNTOUCHED_SINCE_V22 } from "@/tests/stubs/layout-scope-cards";

/** classifyForSweep as it answered at layout v`current` — the v25–v28 blocks
 *  pin what those bumps did; v29 (its own block) re-bakes most of their
 *  probe cards again. */
async function sweepAt(current: number) {
  const { classifyForSweep } = await import("@/lib/cards/layout-version");
  return (row: Parameters<typeof classifyForSweep>[0], target?: number) =>
    classifyForSweep(row, target, { current });
}

/** The policy as it answered at v30. v31 (the one corner radius) is an
 *  UNSCOPED sweep: at v31 every older bake owes a correction, so the
 *  opt-in-only and nothing-pending cases below are pinned at v30. */
const AT_V30 = { current: 30 } as const;
/** …and at v31, before v32 (the M15 family's sizes) made a v31 bake on the
 *  family stale again. */
const AT_V31 = { current: 31 } as const;
/** …and at v32, before v33 (the rules layout) made a v32 bake of any card
 *  that prints text stale again. */
const AT_V32 = { current: 32 } as const;
/** …and at v33, before v34 (the token release) made every bake on the token
 *  frames stale again, text or no text. */
const AT_V33 = { current: 33 } as const;
/** …and at v34, before v35 (the art-area corrections) made every bake on the
 *  CC M15 family, nyx and fullart stale again. */
const AT_V34 = { current: 34 } as const;
/** …and at v36, before v37 (nyx's darker type bar and text box) made every
 *  bake on nyx stale again. */
const AT_V36 = { current: 36 } as const;

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
  // A card no sweep since v22 changed (UNTOUCHED_SINCE_V22): a v21 bake of
  // it has only the v22 opt-in pending.
  const base = {
    ...UNTOUCHED_SINCE_V22,
    visibility: "public",
    rendered_image_url: "https://x/y.png",
  };

  it("flags a published, baked card with a pending OPT-IN bump (v22 typography)", async () => {
    const { hasNewerLook } = await import("@/lib/cards/layout-version");
    expect(hasNewerLook({ ...base, layout_version: 21 }, AT_V30)).toBe(true);
    // Private cards never carry a render; unbaked cards are "not baked".
    expect(hasNewerLook({ ...base, layout_version: 21, visibility: "private" }, AT_V30)).toBe(false);
    expect(hasNewerLook({ ...base, layout_version: 21, rendered_image_url: null }, AT_V30)).toBe(false);
    // At v31 the same card also owes the corner sweep: no badge.
    expect(hasNewerLook({ ...base, layout_version: 21 })).toBe(false);
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

describe("latestSweepVersion — the automatic re-bake's cheap pending count", () => {
  it("is the newest sweep version at or below current (unlisted versions count as sweep)", async () => {
    const { latestSweepVersion, CARD_LAYOUT_VERSION } = await import("@/lib/cards/layout-version");
    // Today's newest bump (v32) is a sweep.
    expect(latestSweepVersion()).toBe(CARD_LAYOUT_VERSION);
    // An opt-in bump on top: cards stamped at the last sweep owe nothing.
    expect(latestSweepVersion({ 32: "sweep", 33: "opt-in" }, 33)).toBe(32);
    expect(latestSweepVersion({ 22: "opt-in" }, 22)).toBe(21);
    expect(latestSweepVersion({ 1: "opt-in" }, 1)).toBe(0);
  });

  it("a card stamped at or above it never has a pending sweep bump", async () => {
    const { latestSweepVersion, hasPendingCorrection } = await import("@/lib/cards/layout-version");
    const rollout = { 22: "opt-in", 33: "opt-in", 34: "opt-in" } as const;
    const sweep = latestSweepVersion(rollout, 34);
    expect(sweep).toBe(32);
    for (let stamp = 1; stamp <= 34; stamp += 1) {
      const owed = hasPendingCorrection(
        { ...UNTOUCHED_SINCE_V22, layout_version: stamp, frame_style: { template: "m15" } },
        { rollout, current: 34 },
      );
      if (stamp >= sweep) expect(owed, `v${stamp}`).toBe(false);
    }
  });
});

describe("hasPendingCorrection — when the platform still owes a card a re-bake", () => {
  it("is true for a null stamp or a pending SWEEP bump, false for opt-in-only", async () => {
    const { hasPendingCorrection, CARD_LAYOUT_VERSION } = await import("@/lib/cards/layout-version");
    const card = UNTOUCHED_SINCE_V22;
    expect(hasPendingCorrection({ ...card, layout_version: null })).toBe(true);
    // v22 common → v23 set-mark sweep pending.
    expect(hasPendingCorrection({ ...card, layout_version: 22, rarity: "common" })).toBe(true);
    // v22 uncommon → v23 didn't change it → nothing owed (up to v30).
    expect(hasPendingCorrection({ ...card, layout_version: 22 }, AT_V30)).toBe(false);
    // v21 uncommon → only the v22 opt-in is pending: the owner's call, not a correction.
    expect(hasPendingCorrection({ ...card, layout_version: 21 }, AT_V30)).toBe(false);
    expect(hasPendingCorrection({ ...card, layout_version: CARD_LAYOUT_VERSION })).toBe(false);
    // v31's corner cut is owed by every older bake.
    expect(hasPendingCorrection({ ...card, layout_version: 22 })).toBe(true);
    expect(hasPendingCorrection({ ...card, layout_version: 21 })).toBe(true);
    // Very old bakes owe the v20/v21 watermark sweeps.
    expect(hasPendingCorrection({ ...card, layout_version: 19 })).toBe(true);
    // v20 bakes may be clean — v21's sweep is still owed.
    expect(hasPendingCorrection({ ...card, layout_version: 20 })).toBe(true);
  });
});

describe("downloadDiffersFromGallery — the download modal's note, per viewer", () => {
  it("paid: whenever the stored look is older; free: only while a correction is pending", async () => {
    const { downloadDiffersFromGallery, CARD_LAYOUT_VERSION } = await import("@/lib/cards/layout-version");
    const card = { ...UNTOUCHED_SINCE_V22, rendered_image_url: "https://x/y.png" };
    // Opt-in pending (v21 uncommon, at v30): paid renders live → differs; free serves the bake → same.
    expect(downloadDiffersFromGallery({ ...card, layout_version: 21 }, true, AT_V30)).toBe(true);
    expect(downloadDiffersFromGallery({ ...card, layout_version: 21 }, false, AT_V30)).toBe(false);
    // At v31 the corner sweep is pending too: a free download renders live as well.
    expect(downloadDiffersFromGallery({ ...card, layout_version: 21 }, false)).toBe(true);
    // Marked by a layout change: both render live.
    expect(downloadDiffersFromGallery({ ...card, layout_version: null }, false)).toBe(true);
    expect(downloadDiffersFromGallery({ ...card, layout_version: CARD_LAYOUT_VERSION }, true)).toBe(false);
    expect(downloadDiffersFromGallery({ ...card, rendered_image_url: null, layout_version: null }, false)).toBe(false);
  });
});

describe("storedLookIsOlder — the download modal's clean-download note", () => {
  it("is true whenever a stored image predates the current renderer", async () => {
    const { storedLookIsOlder, CARD_LAYOUT_VERSION } = await import("@/lib/cards/layout-version");
    const card = { ...UNTOUCHED_SINCE_V22, rendered_image_url: "https://x/y.png" };
    expect(storedLookIsOlder({ ...card, layout_version: 21 })).toBe(true);
    expect(storedLookIsOlder({ ...card, layout_version: null })).toBe(true);
    expect(storedLookIsOlder({ ...card, layout_version: CARD_LAYOUT_VERSION })).toBe(false);
    expect(storedLookIsOlder({ ...card, layout_version: 21, rendered_image_url: null })).toBe(false);
    // v23 is card-scoped: an uncommon's v22 bake is what the v30 renderer
    // draws; a common's is not.
    expect(storedLookIsOlder({ ...card, layout_version: 22 }, AT_V30)).toBe(false);
    expect(storedLookIsOlder({ ...card, rarity: "common", layout_version: 22 }, AT_V30)).toBe(true);
    // v31 is unscoped: every older bake is older.
    expect(storedLookIsOlder({ ...card, layout_version: 22 })).toBe(true);
    expect(storedLookIsOlder({ ...card, layout_version: 30 })).toBe(true);
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
    const classifyForSweep = await sweepAt(28);
    for (const t of [
      "agclassic", "alphaland", "retro", "retroland", "modern", "modernland", "extendedart",
      "battle", "split", "tarkirdragon",
    ]) {
      expect(classifyForSweep(row(t)), t).toBe("rebake");
    }
    // (tarkirghostfire moved to v27, and v27 also lowers the m15pw pips —
    // see the v27 / v28 block; targeted, v25 leaves m15pw alone.)
    for (const t of ["m15", "m15land", "saga", "lotr", "avatar", "tarkirdraconic"]) {
      expect(classifyForSweep(row(t)), t).toBe("stamp");
    }
    expect(classifyForSweep(row("m15pw"), 25)).toBe("opt-in");
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
    const { isRenderStale } = await import("@/lib/cards/layout-version");
    const classifyForSweep = await sweepAt(28);
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

  it("v27 re-bakes only Alpha, Dragon Wing, Ghostfire and planeswalkers; v28 only foil cards, on any template", async () => {
    const classifyForSweep = await sweepAt(28);
    for (const t of ["agclassic", "alphaland", "tarkirdragon", "tarkirghostfire", "m15pw"]) {
      expect(classifyForSweep(row({ template: t, finish: "regular" })), t).toBe("rebake");
    }
    for (const t of ["m15", "modern", "retro", "saga", "tarkirdraconic", "bloomanime"]) {
      expect(classifyForSweep(row({ template: t, finish: "regular" })), t).toBe("stamp");
    }
    expect(classifyForSweep(row({ template: "m15", finish: "foil" }))).toBe("rebake");
    expect(classifyForSweep(row({ template: "m15pw", finish: "foil" }))).toBe("rebake");
    expect(classifyForSweep(row({ template: "m15", finish: "etched" }))).toBe("stamp");
    // Round 4 lowered the planeswalker pips on every finish (v27, not v28).
    expect(classifyForSweep(row({ template: "m15pw", finish: "etched" }))).toBe("rebake");
    expect(classifyForSweep(row({ template: "m15pw", finish: "regular" }), 27)).toBe("rebake");
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

/** Templates added after v29 (frames plan 4.32 / 4.39): no card was ever
 *  baked on them before v30, so v29's frozen lists never name them. */
const POST_V29_TEMPLATES: readonly string[] = [
  "m15borderless", "m15borderlessartifact", "m15fullartland",
  // TODO 4.49 (b)'s text-box tokens.
  "m15tokentext", "m15tokenartifacttext",
  // TODO 4.34's borderless land.
  "m15borderlessland",
  // TODO 4.52's emblem.
  "emblem",
  // TODO 4.48 / 4.50's full-art tokens.
  "m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall",
  // TODO 4.33's borderless planeswalkers.
  "m15borderlesspw", "m15borderlesspwtall",
  // TODO 5.1a's transform bodies and 5.1b's modal bodies.
  ...["m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandfront", "m15dfclandback"],
  ...["m15mdfcfront", "m15mdfcback", "m15mdfclandfront", "m15mdfclandback"],
];
/** Templates added after v36 (TODO 5.1a's transform bodies, 5.1b's modal
 *  bodies): no card was ever baked on them before v37, so v36's frozen
 *  lists never name them. */
const POST_V36_TEMPLATES: readonly string[] = [
  "m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandfront", "m15dfclandback",
  "m15mdfcfront", "m15mdfcback", "m15mdfclandfront", "m15mdfclandback",
];

describe("v29 — the round-5 leftovers, one sweep (2026-09-25)", () => {
  const png = "https://x/y.png";
  /** A v28 bake. Its columns default to a card v29 left alone
   *  (UNTOUCHED_SINCE_V22: a single-word lotr sorcery). */
  const at = (template: string, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: 28,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });
  const creature = (power: string, toughness: string) => ({ card_type: "creature", power, toughness });

  it("is a sweep keyed on one card predicate, with no template list to AND it with", async () => {
    const { CARD_LAYOUT_VERSION, VERSION_SCOPES, rolloutPolicy, latestOptInVersion, isRenderStale } = await import(
      "@/lib/cards/layout-version"
    );
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(29);
    expect(rolloutPolicy(29)).toBe("sweep");
    expect(latestOptInVersion()).toBe(22);
    expect(typeof VERSION_SCOPES[29]).toBe("function");
    // The default maps: a flip card (a template no bump before v29 listed)
    // is stale exactly when the predicate says so — no template list gates it.
    expect(isRenderStale(28, "flip", undefined, 29, at("flip", { title: "Two Words" }))).toBe(true);
    expect(isRenderStale(28, "flip", undefined, 29, at("flip"))).toBe(false);
  });

  // Templates that gained a display footer AFTER v29 (flip and aftermath:
  // the artist credit, layout v38 / TODO 4.21a; battle and split: the same
  // credit turned down their left border, layout v43 / TODO 4.21b): v29's
  // frozen list never held them, so its word-spacing track judges them as
  // "other" templates.
  const FOOTER_SINCE_V29 = ["flip", "aftermath", "battle", "split"];
  // The 1997 pair's footer was a display-face "ART: …" line at v29 and is in
  // v29's frozen list; since TODO 4.10a (layout v46) it is the prints'
  // `Illus.` line in MPlantin.
  // (The 1993 pair's likewise since TODO 4.10c, layout v48.)
  const BODY_FOOTER_SINCE_V46 = ["retro", "retroland", "agclassic", "alphaland"];

  it("word spacing: every card on the 24 display-footer templates (25 with the retired Alpha token)", async () => {
    const classifyForSweep = await sweepAt(29);
    const displayFooter = FRAME_TEMPLATE_VALUES.filter(
      (t) =>
        (getFrameProfile(t).footer?.font === "display" || BODY_FOOTER_SINCE_V46.includes(t)) &&
        !POST_V29_TEMPLATES.includes(t) &&
        !FOOTER_SINCE_V29.includes(t),
    );
    // The frozen v29 list is these 24 (their footer prints "ART: …") and
    // the since-retired alphatoken (TODO 4.54), inert there.
    expect(displayFooter).toHaveLength(24);
    for (const t of displayFooter) {
      // Even a one-word name and type line: the footer's T + colon kerns.
      expect(classifyForSweep(at(t)), t).toBe("rebake");
    }
    // A plain M15 creature, and a card with no template (it draws m15).
    expect(classifyForSweep(at("m15", { title: "Grizzly Bears", subtypes: ["Bear"], ...creature("2", "2") }))).toBe(
      "rebake",
    );
    expect(classifyForSweep(at("m15", { frame_style: {} }))).toBe("rebake");
    // modernland (hideCost: the pw-rows track leaves it byte-identical) is a
    // display-footer template, so word spacing still re-bakes it.
    expect(classifyForSweep(at("modernland", { title: "Island", card_type: "land", supertype: "Basic" }))).toBe(
      "rebake",
    );
  });

  it("word spacing on the other 12 templates: only a name or type line with a space in it", async () => {
    const classifyForSweep = await sweepAt(29);
    const others = FRAME_TEMPLATE_VALUES.filter(
      (t) =>
        (getFrameProfile(t).footer?.font !== "display" || FOOTER_SINCE_V29.includes(t)) &&
        !BODY_FOOTER_SINCE_V46.includes(t) &&
        !POST_V29_TEMPLATES.includes(t),
    );
    expect([...others].sort()).toEqual(
      ["aftermath", "avatar", "battle", "bloomanime", "bloomburrow", "flip", "lotr", "lotrscroll", "split",
        "tarkirdraconic", "tarkirdragon", "tarkirghostfire"].sort(),
    );
    for (const t of others.filter((x) => x !== "aftermath")) {
      expect(classifyForSweep(at(t)), t).toBe("stamp");
      expect(classifyForSweep(at(t, { title: "Red Worm" })), t).toBe("rebake");
    }
    // The type line as the bake builds it: supertype, type, " — " subtypes.
    expect(classifyForSweep(at("lotr", { supertype: "Legendary" }))).toBe("rebake");
    expect(classifyForSweep(at("lotr", { card_type: "creature", subtypes: ["Wurm"] }))).toBe("rebake");
    // An empty name prints the two-word placeholder "Untitled Card".
    expect(classifyForSweep(at("lotr", { title: "  " }))).toBe("rebake");
    // Production's two one-word Dragon Wing cards (Bar, Worm) bake byte-identical.
    expect(classifyForSweep(at("tarkirdragon", { title: "Worm", ...creature("1", "1") }))).toBe("stamp");
    // A flip / split BACK face's name and type line are display lines too…
    const back = { title: "Side", card_type: "sorcery" };
    for (const t of ["flip", "split"]) {
      expect(classifyForSweep(at(t, { back_face: back })), t).toBe("stamp");
      expect(classifyForSweep(at(t, { back_face: { ...back, title: "Other Side" } })), t).toBe("rebake");
      expect(classifyForSweep(at(t, { back_face: { ...back, supertype: "Legendary" } })), t).toBe("rebake");
    }
    // …but a template without a second face never draws one.
    expect(classifyForSweep(at("lotr", { back_face: { ...back, title: "Other Side" } }))).toBe("stamp");
  });

  it("planeswalker rows + names, Alpha ink: inside the display-footer templates, every card", async () => {
    const classifyForSweep = await sweepAt(29);
    const walker = { card_type: "planeswalker", loyalty: "4", title: "Kikyo Zoldyck" };
    expect(classifyForSweep(at("m15pw", walker))).toBe("rebake");
    expect(classifyForSweep(at("m15pw", { ...walker, frame_style: { template: "m15pw", finish: "etched" } }))).toBe(
      "rebake",
    );
    expect(classifyForSweep(at("modern", { title: "Miner the Miner, Damned Delver" }))).toBe("rebake");
    // agclassic: the Alpha track's own scope is the black frame (key b) and
    // colourless ARTIFACTS; word spacing takes every other agclassic card.
    const agclassic = (over: Record<string, unknown>) => at("agclassic", over);
    expect(classifyForSweep(agclassic({ color_identity: ["black"], title: "Sengir Vampire" }))).toBe("rebake");
    expect(classifyForSweep(agclassic({ color_identity: [], card_type: "artifact", title: "Jester's Mask" }))).toBe(
      "rebake",
    );
    // A white creature and a colourless creature (Dawn Treader): not the
    // Alpha track's, still word spacing's.
    expect(classifyForSweep(agclassic({ color_identity: ["white"], ...creature("2", "2") }))).toBe("rebake");
    expect(classifyForSweep(agclassic({ color_identity: [], title: "Dawn Treader", ...creature("3", "3") }))).toBe(
      "rebake",
    );
  });

  it("stat values: statLayoutChanged on any template (a Draconic P/T, a value that no longer fits)", async () => {
    const classifyForSweep = await sweepAt(29);
    // Draconic's new plate: any card that prints a P/T.
    expect(classifyForSweep(at("tarkirdraconic", creature("3", "3")))).toBe("rebake");
    expect(classifyForSweep(at("tarkirdraconic"))).toBe("stamp");
    // Dragon Wing: 20/20 reaches the plate's outline and shrinks; 1/1 fits.
    expect(classifyForSweep(at("tarkirdragon", creature("20", "20")))).toBe("rebake");
    expect(classifyForSweep(at("tarkirdragon", creature("1", "1")))).toBe("stamp");
    // A battle's defense, and a flip card's back-face P/T (drawn upside down).
    expect(classifyForSweep(at("battle", { card_type: "battle", defense: "1000" }))).toBe("rebake");
    expect(classifyForSweep(at("battle", { card_type: "battle", defense: "5" }))).toBe("stamp");
    const back = { title: "Side", card_type: "creature" };
    expect(classifyForSweep(at("flip", { back_face: { ...back, power: "100", toughness: "100" } }))).toBe("rebake");
    expect(classifyForSweep(at("flip", { back_face: { ...back, power: "2", toughness: "2" } }))).toBe("stamp");
  });

  it("foil through rules backdrops: foil cards on the six backdrop templates", async () => {
    const classifyForSweep = await sweepAt(29);
    const foil = (t: string) => at(t, { frame_style: { template: t, finish: "foil" } });
    // bloomanime is the one backdrop template outside the display-footer list.
    expect(classifyForSweep(foil("bloomanime"))).toBe("rebake");
    expect(classifyForSweep(at("bloomanime"))).toBe("stamp");
    for (const t of ["m15pw", "m15token", "m15tokenartifact", "expeditionland"]) {
      expect(classifyForSweep(foil(t)), t).toBe("rebake");
    }
    // A foil card on a template with no backdrop change.
    expect(classifyForSweep(foil("avatar"))).toBe("stamp");
  });

  it("aftermath: every card on the template", async () => {
    const classifyForSweep = await sweepAt(29);
    expect(classifyForSweep(at("aftermath"))).toBe("rebake");
    expect(classifyForSweep(at("aftermath", { back_face: { title: "Ribbons", card_type: "sorcery" } }))).toBe("rebake");
    expect(classifyForSweep(at("aftermath", { frame_style: { template: "aftermath", finish: "foil" } }))).toBe(
      "rebake",
    );
  });

  it("a row missing a column the predicate needs is judged affected", async () => {
    const { isRenderStale, VERSION_SCOPES } = await import("@/lib/cards/layout-version");
    const scopes = { 29: VERSION_SCOPES[29] };
    const lotr = at("lotr");
    expect(isRenderStale(28, "lotr", {}, 29, lotr, scopes)).toBe(false);
    // No frame_style, no card at all, or a missing stat / type-line column.
    const noFrameStyle: Record<string, unknown> = { ...lotr };
    delete noFrameStyle.frame_style;
    expect(isRenderStale(28, "lotr", {}, 29, noFrameStyle, scopes)).toBe(true);
    expect(isRenderStale(28, "lotr", {}, 29, undefined, scopes)).toBe(true);
    for (const column of ["title", "supertype", "card_type", "subtypes", "power", "toughness", "loyalty", "defense", "back_face"]) {
      const partial: Record<string, unknown> = { ...lotr };
      delete partial[column];
      expect(isRenderStale(28, "lotr", {}, 29, partial, scopes), column).toBe(true);
    }
    // frame-verification-state passes only the combo's frame_style: stale
    // (conservative) on every template.
    expect(isRenderStale(28, "lotr", undefined, 29, { frame_style: { template: "lotr", finish: "regular" } })).toBe(true);
  });

  it("owners: never a badge — and a card that owes it keeps no pending opt-in badge either", async () => {
    const { hasNewerLook, hasPendingCorrection } = await import("@/lib/cards/layout-version");
    const classifyForSweep = await sweepAt(29);
    expect(hasNewerLook({ ...at("m15pw"), visibility: "public" })).toBe(false);
    expect(hasPendingCorrection(at("m15pw"))).toBe(true);
    expect(hasPendingCorrection(at("lotr"), AT_V30)).toBe(false);
    // A v21 card v29 left alone keeps its v22 opt-in badge (until v31's
    // unscoped sweep); one v29 changed gets the sweep's re-bake (opt-in look
    // included) instead.
    expect(hasNewerLook({ ...at("lotr"), layout_version: 21, visibility: "public" }, AT_V30)).toBe(true);
    expect(hasNewerLook({ ...at("lotr", { title: "Red Worm" }), layout_version: 21, visibility: "public" })).toBe(false);
    // Targeting v29 alone: in scope → re-bake, out of scope → stamped.
    expect(classifyForSweep(at("saga"), 29)).toBe("rebake");
    expect(classifyForSweep(at("lotr"), 29)).toBe("stamp");
    // A v27 foil m15 card owes v28 and v29; a v28-only sweep still takes it.
    expect(classifyForSweep(at("m15", { layout_version: 27, frame_style: { template: "m15", finish: "foil" } }), 28)).toBe(
      "rebake",
    );
  });
});

describe("v30 — fullartland re-sourced from Card Conjurer (frames plan 4.39)", () => {
  const png = "https://x/y.png";
  /** A v29 bake (every production card is stamped 29). */
  const at = (template: string, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: 29,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });

  it("is a template-scoped sweep: only fullartland is stale, and never an owner badge", async () => {
    const { rolloutPolicy, latestOptInVersion, hasNewerLook, hasPendingCorrection } = await import(
      "@/lib/cards/layout-version"
    );
    const classifyForSweep = await sweepAt(30);
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(30);
    expect(rolloutPolicy(30)).toBe("sweep");
    expect(latestOptInVersion()).toBe(22);
    expect(classifyForSweep(at("fullartland"))).toBe("rebake");
    expect(classifyForSweep(at("fullartland", { frame_style: { template: "fullartland", finish: "foil" } }))).toBe(
      "rebake",
    );
    expect(hasNewerLook({ ...at("fullartland"), visibility: "public" }, AT_V30)).toBe(false);
    expect(hasPendingCorrection(at("fullartland"), AT_V30)).toBe(true);
    // Every other template — including the full-art frames that share its
    // profile family and the default m15 a {} frame_style draws — keeps its
    // v29 bake: the sweep stamps it without a render.
    for (const t of FRAME_TEMPLATE_VALUES.filter((v) => v !== "fullartland")) {
      expect(isRenderStale(29, t, undefined, 30), t).toBe(false);
      expect(classifyForSweep(at(t)), t).toBe("stamp");
    }
    expect(classifyForSweep({ ...at("m15"), frame_style: {} })).toBe("stamp");
  });
});

describe("v31 — one corner radius (TODO 3.26)", () => {
  const png = "https://x/y.png";
  /** A bake at `version` of a card no scoped bump since v22 touched. */
  const at = (template: string, version: number, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: version,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });

  it("is an unscoped sweep: every v30 / v29 bake on every template is stale, a correction, never a badge", async () => {
    const {
      CARD_LAYOUT_VERSION,
      VERSION_SCOPES,
      classifyForSweep,
      hasNewerLook,
      hasPendingCorrection,
      latestOptInVersion,
      rolloutPolicy,
    } = await import("@/lib/cards/layout-version");
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(31);
    expect(rolloutPolicy(31)).toBe("sweep");
    expect(VERSION_SCOPES[31]).toBeUndefined();
    expect(latestOptInVersion()).toBe(22);
    for (const version of [30, 29]) {
      for (const t of [...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES]) {
        const row = at(t, version);
        expect(isRenderStale(version, t), `${t}@${version}`).toBe(true);
        expect(isRenderStale(version, t, undefined, 31, row), `${t}@${version}`).toBe(true);
        expect(hasPendingCorrection(row), `${t}@${version}`).toBe(true);
        expect(hasNewerLook({ ...row, visibility: "public" }), `${t}@${version}`).toBe(false);
        expect(classifyForSweep(row), `${t}@${version}`).toBe("rebake");
        expect(classifyForSweep(row, 31), `${t}@${version}`).toBe("rebake");
      }
    }
    // The default frame a {} frame_style draws, and a foil card, too.
    expect(isRenderStale(30, null, undefined, 31, { frame_style: {} })).toBe(true);
    expect(classifyForSweep({ ...at("m15", 30), frame_style: {} }, 31)).toBe("rebake");
    expect(classifyForSweep(at("modern", 30, { frame_style: { template: "modern", finish: "foil" } }), 31)).toBe("rebake");
    // A v31 bake was current at v31 (v32 re-bakes the M15 family's).
    expect(classifyForSweep(at("m15", 31), undefined, AT_V31)).toBe("current");
    expect(hasPendingCorrection(at("m15", 31), AT_V31)).toBe(false);
  });

  it("takes an opt-in-only card along: a v21 bake owes v31, so the sweep re-bakes it (v22 rides along)", async () => {
    const { classifyForSweep, hasNewerLook } = await import("@/lib/cards/layout-version");
    // At v30 this card had only the v22 opt-in pending and kept its badge.
    expect(hasNewerLook({ ...at("lotr", 21), visibility: "public" }, AT_V30)).toBe(true);
    expect(classifyForSweep(at("lotr", 21), undefined, AT_V30)).toBe("opt-in");
    // At v31 the corner sweep takes it: no badge, re-baked.
    expect(hasNewerLook({ ...at("lotr", 21), visibility: "public" })).toBe(false);
    expect(classifyForSweep(at("lotr", 21), 31)).toBe("rebake");
  });

  it("is verification-neutral: a frame_reviews tick from v29 / v30 stays fresh", async () => {
    const { VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    expect(VERIFICATION_NEUTRAL_VERSIONS).toContain(31);
    expect(VERIFICATION_SCOPED_VERSIONS[31]).toEqual([]);
    // Every other bump keeps its real template scope.
    expect(VERIFICATION_SCOPED_VERSIONS[30]).toEqual(["fullartland"]);
    expect(VERIFICATION_SCOPED_VERSIONS[24]).toContain("m15");
    expect(VERIFICATION_SCOPED_VERSIONS[29]).toBeUndefined();
    for (const t of [...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES]) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(30, t, VERIFICATION_SCOPED_VERSIONS, 31, regular), t).toBe(false);
    }
    // …while the stored bakes still owe it.
    expect(isRenderStale(30, "m15", undefined, 31, { frame_style: { template: "m15", finish: "regular" } })).toBe(true);
  });
});

describe("v32 — one M15-era title / type size (TODO 4.20)", () => {
  const png = "https://x/y.png";
  /** A bake at `version` of a card no scoped bump since v22 touched. */
  const at = (template: string, version: number, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: version,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });

  it("freezes its scope as a literal: the M15 family as it stood at v32, split and battle left out (the battle joined with v43)", async () => {
    const { V32_M15_FAMILY_TEMPLATES } = await import("@/lib/cards/layout-version");
    const { M15_FAMILY_TEMPLATES } = await import("@/lib/cards/m15-family");
    // The family changed? Don't edit the frozen v32 list: ship the change in
    // its own bump, and record it here (the family = v32's list ± it).
    // + 4.49 (b)'s text-box tokens, 4.34's borderless land, 4.48 / 4.50's
    // full-art tokens, 4.33's borderless planeswalkers and 4.52's emblem: NEW
    // templates, no card ever baked on them before, so they joined without a
    // bump.
    const joinedLater = [
      "m15tokentext", "m15tokenartifacttext",
      "m15borderlessland",
      "m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall",
      "m15borderlesspw", "m15borderlesspwtall",
      "emblem",
      // …and 5.1a's transform bodies and 5.1b's modal bodies, the same way.
      "m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandfront", "m15dfclandback",
      "m15mdfcfront", "m15mdfcback", "m15mdfclandfront", "m15mdfclandback",
    ];
    // An EXISTING template that joined brought its own bump: the battle
    // (TODO 4.21b), with layout v43 — its Card Conjurer master and the
    // family's sizes; a v31 battle bake never owed v32.
    const joinedWithBump: Record<string, number> = { battle: 43 };
    expect([...V32_M15_FAMILY_TEMPLATES, ...joinedLater, ...Object.keys(joinedWithBump)].sort()).toEqual(
      [...M15_FAMILY_TEMPLATES].sort(),
    );
    for (const t of [...joinedLater, ...Object.keys(joinedWithBump)]) expect(V32_M15_FAMILY_TEMPLATES, t).not.toContain(t);
    const { V43_LANDSCAPE_LAYOUT_TEMPLATES } = await import("@/lib/cards/layout-version");
    for (const [t, version] of Object.entries(joinedWithBump)) {
      expect(version).toBe(43);
      expect(V43_LANDSCAPE_LAYOUT_TEMPLATES, t).toContain(t);
    }
    expect(new Set(V32_M15_FAMILY_TEMPLATES).size).toBe(V32_M15_FAMILY_TEMPLATES.length);
    expect(V32_M15_FAMILY_TEMPLATES).toHaveLength(23);
    for (const t of V32_M15_FAMILY_TEMPLATES) expect(FRAME_TEMPLATE_VALUES, t).toContain(t);
    // Their slots sat off the MSE masters' bars at v32: their sizes shipped
    // with 4.21b (v43) — the battle joining the family, split keeping the
    // prints' own smaller sizes outside it.
    expect(V32_M15_FAMILY_TEMPLATES).not.toContain("split");
    expect(V32_M15_FAMILY_TEMPLATES).not.toContain("battle");
    expect(M15_FAMILY_TEMPLATES).not.toContain("split");
  });

  it("is a template-scoped sweep: every v31 bake on the family re-bakes, every other template's is stamped", async () => {
    const {
      CARD_LAYOUT_VERSION,
      V32_M15_FAMILY_TEMPLATES,
      VERSION_SCOPES,
      classifyForSweep,
      hasNewerLook,
      hasPendingCorrection,
      latestOptInVersion,
      rolloutPolicy,
    } = await import("@/lib/cards/layout-version");
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(32);
    expect(rolloutPolicy(32)).toBe("sweep");
    // Every name on the family grows: no card predicate narrows it.
    expect(VERSION_SCOPES[32]).toBeUndefined();
    expect(latestOptInVersion()).toBe(22);
    // Pinned at v32: v33 (the rules layout) re-bakes these text cards again.
    const classifyAtV32 = await sweepAt(32);
    for (const t of FRAME_TEMPLATE_VALUES) {
      const row = at(t, 31);
      const family = V32_M15_FAMILY_TEMPLATES.includes(t);
      expect(isRenderStale(31, t, undefined, 32), t).toBe(family);
      expect(isRenderStale(31, t, undefined, 32, row), t).toBe(family);
      expect(hasPendingCorrection(row, AT_V32), t).toBe(family);
      expect(hasNewerLook({ ...row, visibility: "public" }), t).toBe(false);
      expect(classifyAtV32(row), t).toBe(family ? "rebake" : "stamp");
      expect(classifyAtV32(row, 32), t).toBe(family ? "rebake" : "stamp");
    }
    expect(classifyAtV32(at("split", 31))).toBe("stamp");
    expect(classifyAtV32(at("battle", 31))).toBe("stamp");
    // The default frame a {} frame_style draws is m15: re-baked.
    expect(isRenderStale(31, null, undefined, 32, { frame_style: {} })).toBe(true);
    expect(classifyForSweep({ ...at("m15", 31), frame_style: {} }, 32)).toBe("rebake");
    // Whatever the card: a finish, a rarity, a Keyrune or an uploaded set
    // icon, a full-art basic on a Keyrune glyph (no predicate spares it).
    for (const row of [
      at("m15", 31, { frame_style: { template: "m15", finish: "foil" } }),
      at("m15pw", 31, { rarity: "mythic", set_icon_code: "dom" }),
      at("saga", 31, { set_icon_url: "https://x/icon.png" }),
      at("fullartland", 31, { title: "Mountain", supertype: "Basic Snow", card_type: "land", set_icon_code: "khm" }),
      at("m15fullartland", 31, { title: "Plains", supertype: "Basic", card_type: "land", set_icon_code: "one" }),
    ]) {
      expect(classifyForSweep(row, 32), JSON.stringify(row.frame_style)).toBe("rebake");
    }
    // A v32 bake was current at v32.
    expect(classifyAtV32(at("m15", 32))).toBe("current");
    expect(hasPendingCorrection(at("m15", 32), AT_V32)).toBe(false);
  });

  it("is verification-neutral: a v31 / v30 frame_reviews tick on the family stays fresh", async () => {
    const { V32_M15_FAMILY_TEMPLATES, VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import(
      "@/lib/cards/layout-version"
    );
    expect(VERIFICATION_NEUTRAL_VERSIONS).toContain(32);
    expect(VERIFICATION_SCOPED_VERSIONS[32]).toEqual([]);
    for (const t of V32_M15_FAMILY_TEMPLATES) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(31, t, VERIFICATION_SCOPED_VERSIONS, 32, regular), t).toBe(false);
      expect(isRenderStale(30, t, VERIFICATION_SCOPED_VERSIONS, 32, regular), t).toBe(false);
      // …while the stored bakes still owe it.
      expect(isRenderStale(31, t, undefined, 32, regular), t).toBe(true);
    }
  });
});

describe("v33 — rules text laid out by its real lines (TODO 3.29)", () => {
  const png = "https://x/y.png";
  /** A v32 bake of a card that prints no text (UNTOUCHED_SINCE_V22 has none). */
  const at = (template: string, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: 32,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });
  const scope = async () => (await import("@/lib/cards/layout-version")).VERSION_SCOPES[33];

  it("is an unscoped-by-template sweep narrowed by what the card prints — never a badge", async () => {
    const { CARD_LAYOUT_VERSION, VERSION_SCOPES, hasNewerLook, hasPendingCorrection, latestOptInVersion, rolloutPolicy } =
      await import("@/lib/cards/layout-version");
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(33);
    expect(rolloutPolicy(33)).toBe("sweep");
    expect(latestOptInVersion()).toBe(22);
    expect(VERSION_SCOPES[33]).toBeTypeOf("function");
    // Pinned at v33: v34 (the token release) re-bakes every card on the token
    // frames again, text or no text.
    const classifyForSweep = await sweepAt(33);
    for (const t of [...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES]) {
      // No card to judge by → every template is touched (no template list).
      expect(isRenderStale(32, t), t).toBe(true);
      // Every frame prints text at v33 — the "M15 Textless" ones on the art.
      const printed = at(t, { rules_text: "Flying" });
      expect(isRenderStale(32, t, undefined, 33, printed), t).toBe(true);
      expect(classifyForSweep(printed), t).toBe("rebake");
      expect(classifyForSweep(printed, 33), t).toBe("rebake");
      expect(hasPendingCorrection(printed, AT_V33), t).toBe(true);
      expect(hasNewerLook({ ...printed, visibility: "public" }), t).toBe(false);
      // A card that prints no text bakes as before: stamped, never re-rendered.
      expect(classifyForSweep(at(t)), t).toBe("stamp");
      expect(hasPendingCorrection(at(t), AT_V33), t).toBe(false);
    }
    // A v33 bake is current; the default frame a {} frame_style draws is m15.
    expect(classifyForSweep(at("m15", { layout_version: 33, rules_text: "Flying" }))).toBe("current");
    expect(classifyForSweep(at("m15", { frame_style: {}, flavor_text: "Hm." }), 33)).toBe("rebake");
    // An older bake owes v33 along with what it owed before.
    expect(classifyForSweep(at("lotr", { layout_version: 31, rules_text: "Flying" }))).toBe("rebake");
    expect(classifyForSweep(at("m15", { layout_version: 31 }))).toBe("rebake"); // v32, the family's sizes
    expect(classifyForSweep(at("lotr", { layout_version: 31 }))).toBe("stamp");
  });

  it("covers every text the bake prints: rules, flavor, loyalty rows, saga chapters and intro, a back face", async () => {
    const v33 = await scope();
    const card = (over: Record<string, unknown>, template = "m15") => ({ ...at(template), ...over });
    expect(v33(card({ rules_text: "Flying" }))).toBe(true);
    expect(v33(card({ flavor_text: "“Hm.”\n—Someone" }))).toBe(true);
    // Whitespace prints nothing.
    expect(v33(card({ rules_text: "  \n ", flavor_text: "" }))).toBe(false);
    // A walker's structured rows — even a row with only a cost: its badge and
    // row are sized by the rules text size.
    const walker = { card_type: "planeswalker" };
    expect(v33(card({ ...walker, face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: "Scry 1." }] } } }, "m15pw"))).toBe(true);
    expect(v33(card({ ...walker, face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: "" }] } } }, "m15pw"))).toBe(true);
    expect(v33(card({ ...walker, face_content: { v: 1, loyalty: { abilities: [] } } }, "m15pw"))).toBe(false);
    // A saga's chapters and its intro; a chapter with no text keeps today's row.
    const saga = (s: Record<string, unknown>) => card({ face_content: { v: 1, saga: s } }, "saga");
    expect(v33(saga({ chapters: [{ numerals: [1], text: "Draw a card." }] }))).toBe(true);
    expect(v33(saga({ intro: "(As this Saga enters…)", chapters: [] }))).toBe(true);
    expect(v33(saga({ intro: null, chapters: [{ numerals: [1], text: " " }] }))).toBe(false);
    // A back face's text: the adventure page, a flip / split / aftermath half.
    expect(v33(card({ back_face: { title: "Tale", rules_text: "Draw two cards." } }, "adventure"))).toBe(true);
    expect(v33(card({ back_face: { title: "Tale", flavor_text: "Once." } }, "flip"))).toBe(true);
    expect(v33(card({ back_face: { title: "Tale" } }, "split"))).toBe(false);
  });

  it("leaves out what prints no text: a basic land (no frame prints no text box at v33)", async () => {
    const v33 = await scope();
    const { V33_SCOPE_TEMPLATES } = await import("@/lib/cards/layout-version");
    const card = (over: Record<string, unknown>, template = "m15") => ({ ...at(template), ...over });
    // FrameProfile.textless is set on no profile yet: the "M15 Textless"
    // frames print their text straight on the art, so their cards re-bake.
    expect(V33_SCOPE_TEMPLATES.textless).toEqual([]);
    for (const t of ["m15textless", "m15textlessland"]) {
      expect(getFrameProfile(t).textless, t).toBeUndefined();
      expect(v33(card({ rules_text: "Flying", flavor_text: "Hm." }, t)), t).toBe(true);
    }
    const forest = { title: "Forest", card_type: "land", supertype: "Basic", subtypes: ["Forest"] };
    expect(v33(card({ ...forest, flavor_text: "Deep roots." }, "fullartland"))).toBe(false);
    expect(v33(card({ ...forest, rules_text: "({T}: Add {G}.)" }, "m15land"))).toBe(false);
    // The legacy shape: one basic land type, no supertype, no rules text.
    expect(v33(card({ title: "Island", card_type: "land", supertype: null, subtypes: ["Island"], flavor_text: "Wet." }, "m15land"))).toBe(false);
    // A nonbasic land prints its text…
    expect(v33(card({ title: "Temple", card_type: "land", subtypes: ["Forest", "Island"], rules_text: "Scry 1." }, "m15land"))).toBe(true);
    // …and a saga's chapter rail draws whatever the card is.
    expect(v33(card({ ...forest, rules_text: "I — Draw a card." }, "saga"))).toBe(true);
  });

  it("answers conservatively (affected) for a row missing a column it reads", async () => {
    const v33 = await scope();
    expect(v33({ ...at("m15"), frame_style: undefined })).toBe(true);
    for (const column of ["rules_text", "flavor_text", "face_content", "back_face"]) {
      expect(v33({ ...at("m15"), [column]: undefined }), column).toBe(true);
    }
    // The basic-land test needs the type columns once there is text.
    for (const column of ["card_type", "supertype", "subtypes", "title"]) {
      expect(v33({ ...at("m15"), rules_text: "Flying", [column]: undefined }), column).toBe(true);
    }
  });

  it("freezes its template lists as literals, pinned to the profiles as they stand at v33", async () => {
    const { V33_SCOPE_TEMPLATES } = await import("@/lib/cards/layout-version");
    const all = [...FRAME_TEMPLATE_VALUES];
    // A template that becomes textless or gains a chapter rail later brings
    // its own bump: record it here, never in the frozen lists. A NEW
    // textless template no card was ever baked on needs none: 4.48's
    // full-art token's textless height (and its artifact template).
    const newTextless = ["m20token", "m20tokenartifact"];
    expect([...V33_SCOPE_TEMPLATES.textless, ...newTextless].sort()).toEqual(all.filter((t) => getFrameProfile(t).textless).sort());
    for (const t of newTextless) expect(V33_SCOPE_TEMPLATES.textless, t).not.toContain(t);
    expect([...V33_SCOPE_TEMPLATES.chapters].sort()).toEqual(all.filter((t) => getFrameProfile(t).chapters).sort());
  });

  it("is verification-neutral: a v32 / v31 / v30 frame_reviews tick stays fresh on every template", async () => {
    const { VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    expect(VERIFICATION_NEUTRAL_VERSIONS).toEqual(expect.arrayContaining([31, 32, 33]));
    expect(VERIFICATION_SCOPED_VERSIONS[33]).toEqual([]);
    for (const t of [...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES]) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(32, t, VERIFICATION_SCOPED_VERSIONS, 33, regular), t).toBe(false);
      // …while a stored bake of a card that prints text still owes it.
      expect(isRenderStale(32, t, undefined, 33, { ...at(t), ...regular, rules_text: "Flying" }), t).toBe(true);
    }
  });
});

describe("v34 — the token release: 4.49's token frame + 3b.15's wording (one bump)", () => {
  const png = "https://x/y.png";
  /** A v33 bake. Its columns default to UNTOUCHED_SINCE_V22 (a one-word
   *  sorcery that prints no text) with the text it prints, so only v34 can be
   *  pending on it. */
  const at = (template: string, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: 33,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    rules_text: "Flying",
    ...over,
  });
  const token = (over: Record<string, unknown> = {}) => ({ card_type: "token", title: "Soldier", ...over });
  const ALL = [...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES];

  it("is a sweep, never a badge, with the token frames frozen as a literal", async () => {
    const { CARD_LAYOUT_VERSION, V34_TOKEN_FRAME_TEMPLATES, VERSION_SCOPES, latestOptInVersion, latestSweepVersion, rolloutPolicy } =
      await import("@/lib/cards/layout-version");
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(34);
    expect(rolloutPolicy(34)).toBe("sweep");
    expect(latestSweepVersion(undefined, 34)).toBe(34);
    expect(latestOptInVersion()).toBe(22);
    expect(VERSION_SCOPES[34]).toBeTypeOf("function");
    expect(V34_TOKEN_FRAME_TEMPLATES).toEqual(["m15token", "m15tokenartifact"]);
    // The two frames 4.49 re-measured: the type band from 8.54 %W, the set
    // symbol in its own box, the P/T on an M15 plate.
    for (const t of V34_TOKEN_FRAME_TEMPLATES) {
      const profile = getFrameProfile(t);
      expect(profile.type.rect.leftPct, t).toBe(8.54);
      expect(profile.symbolRect, t).toEqual({ topPct: 82.34 + (8 / 2100) * 100, leftPct: 80.13, widthPct: 12, heightPct: 4.1 });
      expect(profile.pt?.plateAssetPathTemplate, t).toMatch(/^\/frames\/m15(artifact)?\/pt\/\{color\}\.png$/);
    }
  });

  it("re-bakes EVERY card on the two token frames, and no non-token card on any other template", async () => {
    // Pinned at v34: v35 (the art-area corrections) re-bakes the CC M15
    // family, nyx and fullart again.
    const { V34_TOKEN_FRAME_TEMPLATES, hasNewerLook, hasPendingCorrection: pending } = await import("@/lib/cards/layout-version");
    const classifyForSweep = await sweepAt(34);
    const hasPendingCorrection = (row: Parameters<typeof pending>[0]) => pending(row, AT_V34);
    for (const t of ALL) {
      const frame = V34_TOKEN_FRAME_TEMPLATES.includes(t);
      // Whatever the card prints: text or none, a non-token or a bare token.
      for (const row of [at(t), at(t, { rules_text: null }), at(t, token()), at(t, { ...token(), rules_text: null })]) {
        const label = `${t} ${row.card_type} ${row.rules_text}`;
        expect(isRenderStale(33, t, undefined, 34, row), label).toBe(frame);
        expect(classifyForSweep(row), label).toBe(frame ? "rebake" : "stamp");
        expect(classifyForSweep(row, 34), label).toBe(frame ? "rebake" : "stamp");
        expect(hasPendingCorrection(row), label).toBe(frame);
        expect(hasNewerLook({ ...row, visibility: "public" }), label).toBe(false);
      }
      // A creature with a P/T, a Vehicle, a legendary artifact: untouched off the token frames.
      for (const over of [
        { card_type: "creature", power: "2", toughness: "2" },
        { card_type: "artifact", subtypes: ["Vehicle"], power: "3", toughness: "3" },
        { card_type: "artifact", supertype: "Legendary" },
      ]) {
        expect(classifyForSweep(at(t, over)), `${t} ${JSON.stringify(over)}`).toBe(frame ? "rebake" : "stamp");
      }
    }
    // A {} frame_style draws m15: stamped.
    expect(classifyForSweep(at("m15", { frame_style: {} }))).toBe("stamp");
    // A v34 bake is current.
    expect(classifyForSweep(at("m15token", { layout_version: 34 }))).toBe("current");
  });

  it("re-bakes a token whose printed line changes on ANY template (a showcase, flip's Roles)", async () => {
    const classifyForSweep = await sweepAt(34);
    for (const t of ALL) {
      // "Basic Token — Wastes" → "Token Basic — Wastes".
      expect(classifyForSweep(at(t, token({ supertype: "Basic", subtypes: ["Wastes"] }))), t).toBe("rebake");
      // "Token — Soldier" + 1/1 → "Token Creature — Soldier" (0128's word), before and after the migration.
      expect(classifyForSweep(at(t, token({ subtypes: ["Soldier"], power: "1", toughness: "1" }))), t).toBe("rebake");
      expect(classifyForSweep(at(t, token({ supertype: "Creature", subtypes: ["Soldier"], power: "1", toughness: "1" }))), t).toBe("rebake");
      // A Treasure loses its stray P/T and prints "Token Artifact — Treasure".
      expect(classifyForSweep(at(t, token({ supertype: "Artifact", subtypes: ["Treasure"], power: "1", toughness: "1" }))), t).toBe("rebake");
      // A back face typed as a token with a word.
      expect(classifyForSweep(at(t, { back_face: { card_type: "token", supertype: "Enchantment", subtypes: ["Aura", "Role"] } })), t).toBe(
        "rebake",
      );
    }
  });

  it("answers conservatively (affected) for a row missing a column it reads", async () => {
    const { VERSION_SCOPES } = await import("@/lib/cards/layout-version");
    const v34 = VERSION_SCOPES[34];
    expect(v34({ ...at("m15"), frame_style: undefined })).toBe(true);
    for (const column of ["card_type", "supertype", "power", "toughness", "back_face"]) {
      expect(v34({ ...at("m15"), [column]: undefined }), column).toBe(true);
    }
    // On the token frames it needs nothing but the template.
    expect(v34({ frame_style: { template: "m15tokenartifact" } })).toBe(true);
  });

  it("is NOT verification-neutral: it stales the token frames' ticks and no other template's", async () => {
    const { V34_TOKEN_FRAME_TEMPLATES, VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import(
      "@/lib/cards/layout-version"
    );
    expect(VERIFICATION_NEUTRAL_VERSIONS).not.toContain(34);
    expect(VERIFICATION_SCOPED_VERSIONS[34]).toEqual(V34_TOKEN_FRAME_TEMPLATES);
    for (const t of ALL) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(33, t, VERIFICATION_SCOPED_VERSIONS, 34, regular), t).toBe(V34_TOKEN_FRAME_TEMPLATES.includes(t));
    }
  });
});

describe("v35 — the art-area corrections: CC M15 art slot, under-frame art, nyx / fullart / m15pw-c (one bump)", () => {
  const png = "https://x/y.png";
  const art = "https://x/art.png";
  /** A v34 bake. Its columns default to UNTOUCHED_SINCE_V22 (a blue one-word
   *  sorcery with no art), so only v35 can be pending on it. */
  const at = (template: string, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: 34,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });
  const ALL = [...new Set([...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES])];
  /** The sweep / badge rules as they stood at v35 (v36 moves the walkers
   *  on its own). */
  const AT_V35 = { current: 35 } as const;
  const UNDER = { topPct: 2.7, leftPct: 3.7, widthPct: 92.6, heightPct: 93.3 };

  it("is a sweep, never a badge, with its template lists frozen as literals and pinned to the profiles", async () => {
    const { CARD_LAYOUT_VERSION, V35_ART_SLOT_TEMPLATES, V35_SEE_THROUGH_C_TEMPLATES, VERSION_SCOPES, latestOptInVersion, latestSweepVersion, rolloutPolicy } =
      await import("@/lib/cards/layout-version");
    expect(CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(35);
    expect(rolloutPolicy(35)).toBe("sweep");
    expect(latestSweepVersion(undefined, 35)).toBe(35);
    expect(latestOptInVersion()).toBe(22);
    expect(VERSION_SCOPES[35]).toBeTypeOf("function");
    expect(V35_ART_SLOT_TEMPLATES).toEqual(["m15", "m15artifact", "m15land", "m15snow", "m15snowland", "m15devoid", "nyx", "fullart"]);
    expect(V35_SEE_THROUGH_C_TEMPLATES).toEqual(["m15token", "m15tokentext", "m15pw"]);
    // What moved: the CC M15 family's slot (4.4 (2)) …
    const cc = { topPct: 11.25, leftPct: 7.67, widthPct: 84.76, heightPct: 44.33 };
    for (const t of ["m15", "m15artifact", "m15land", "m15snow", "m15snowland", "m15devoid"]) expect(getFrameProfile(t).artSlot, t).toEqual(cc);
    // … nyx and fullart's slots, now to 93 % under the whole text box (4.17b) …
    expect(getFrameProfile("nyx").artSlot).toEqual({ topPct: 11.2, leftPct: 6, widthPct: 88, heightPct: 81.8 });
    // (fullart's also out to whole pixels past its hedron ring's rim.)
    expect(getFrameProfile("fullart").artSlot).toEqual({ topPct: 2.7, leftPct: 3.8, widthPct: 92.4, heightPct: 90.3 });
    // … and the under-frame art, from the border's inner edge (4.17a), on every
    // see-through master — m15pw's colourless one new (4.17b).
    for (const t of ["m15", "m15token", "m15tokentext", "m15pw"]) {
      expect(underFrameArtRect(getFrameProfile(t), "c"), t).toEqual(UNDER);
      expect(underFrameArtRect(getFrameProfile(t), "w"), t).toBeNull();
    }
    for (const key of ["w", "u", "b", "r", "g", "c", "m"]) expect(underFrameArtRect(getFrameProfile("m15devoid"), key), key).toEqual(UNDER);
    // m15pw/c draws ONE picture — its window in the under-frame rect too
    // (only under art, like the layer: the scope's "colourless with art");
    // no other see-through master has its own window slot.
    expect(underFrameArtSlot(getFrameProfile("m15pw"), "c")).toEqual(UNDER);
    for (const t of ["m15", "m15devoid", "m15token", "m15tokentext"]) expect(underFrameArtSlot(getFrameProfile(t), "c"), t).toBeNull();
    // Every template that draws v35's under-frame rect is in the scope (one
    // with a rect of its own — an emblem's — is not v35's business), and the
    // three see-through-c templates paint the colour key itself (the
    // scope's pickFrameColorKey).
    // (flip/c took the rect with its own bump, layout v38 — TODO 4.21a's
    // see-through Card Conjurer master: not v35's business either.)
    const SEE_THROUGH_SINCE_V35 = ["flip"];
    for (const t of ALL) {
      const u = getFrameProfile(t).underFrameArt;
      if (u && (sameRect(u.rect, UNDER) || (u.artSlot && sameRect(u.artSlot, UNDER)))) {
        expect(["m15", "m15devoid", ...V35_SEE_THROUGH_C_TEMPLATES, ...SEE_THROUGH_SINCE_V35], t).toContain(t);
      }
    }
    for (const t of V35_SEE_THROUGH_C_TEMPLATES) {
      expect(getFrameProfile(t).artifactMasterKeys, t).toBeUndefined();
      expect(getFrameProfile(t).twoColorSplit, t).toBeUndefined();
    }
    // Adventure was not in the bump (then MSE-framed, on M15's slot); its
    // own slot came with layout v38 (4.21a, pinned — the v38 block).
    expect(V35_ART_SLOT_TEMPLATES).not.toContain("adventure");
  });

  it("re-bakes EVERY card on the art-slot templates, with or without art, and nothing on the templates it didn't touch", async () => {
    const { V35_ART_SLOT_TEMPLATES, V35_SEE_THROUGH_C_TEMPLATES, classifyForSweep, hasNewerLook, hasPendingCorrection } = await import(
      "@/lib/cards/layout-version"
    );
    for (const t of ALL) {
      const whole = V35_ART_SLOT_TEMPLATES.includes(t);
      const seeThrough = V35_SEE_THROUGH_C_TEMPLATES.includes(t);
      for (const row of [
        at(t),
        at(t, { art_url: art }),
        at(t, { color_identity: ["colorless"] }),
        at(t, { color_identity: ["white", "blue"], art_url: art }),
      ]) {
        const label = `${t} ${JSON.stringify(row.color_identity)} ${row.art_url}`;
        expect(isRenderStale(34, t, undefined, 35, row), label).toBe(whole);
        // (Pinned at v35: v36 moves the walkers on its own.)
        expect(classifyForSweep(row, undefined, AT_V35), label).toBe(whole ? "rebake" : "stamp");
        expect(classifyForSweep(row, 35, AT_V35), label).toBe(whole ? "rebake" : "stamp");
        expect(hasPendingCorrection(row, AT_V35), label).toBe(whole);
        expect(hasNewerLook({ ...row, visibility: "public" }, AT_V35), label).toBe(false);
      }
      // A colourless card with art: the see-through master's under-frame art.
      const c = at(t, { color_identity: ["colorless"], art_url: art });
      expect(classifyForSweep(c, undefined, AT_V35), `${t} colourless + art`).toBe(whole || seeThrough ? "rebake" : "stamp");
    }
    // A {} frame_style (and a retired template) draws m15: every card re-bakes.
    expect(classifyForSweep(at("m15", { frame_style: {} }), undefined, AT_V35)).toBe("rebake");
    expect(classifyForSweep(at("regular"), undefined, AT_V35)).toBe("rebake");
    // A v35 bake is current (at v35).
    expect(classifyForSweep(at("m15", { layout_version: 35 }), undefined, AT_V35)).toBe("current");
  });

  it("on m15token / m15tokentext / m15pw re-bakes exactly the colourless cards with art (the see-through master's under-frame art)", async () => {
    const { V35_SEE_THROUGH_C_TEMPLATES, classifyForSweep } = await import("@/lib/cards/layout-version");
    for (const t of V35_SEE_THROUGH_C_TEMPLATES) {
      // The bake's pick: no identity, "colorless", or only unknown values paint "c".
      for (const colours of [[], ["colorless"], ["purple"], null]) {
        expect(classifyForSweep(at(t, { color_identity: colours, art_url: art }), undefined, AT_V35), `${t} ${JSON.stringify(colours)}`).toBe("rebake");
        expect(classifyForSweep(at(t, { color_identity: colours, art_url: null }), undefined, AT_V35), `${t} ${JSON.stringify(colours)} no art`).toBe("stamp");
        expect(classifyForSweep(at(t, { color_identity: colours, art_url: "" }), undefined, AT_V35), `${t} ${JSON.stringify(colours)} empty art`).toBe("stamp");
      }
      // A coloured or gold card paints an opaque master: stamped.
      for (const colours of [["blue"], ["white", "blue"], ["multicolor"], ["colorless", "red"]]) {
        expect(classifyForSweep(at(t, { color_identity: colours, art_url: art }), undefined, AT_V35), `${t} ${JSON.stringify(colours)}`).toBe("stamp");
      }
    }
  });

  it("answers conservatively (affected) for a row missing a column it reads", async () => {
    const { VERSION_SCOPES } = await import("@/lib/cards/layout-version");
    const v35 = VERSION_SCOPES[35];
    expect(v35({ ...at("lotr"), frame_style: undefined })).toBe(true);
    for (const column of ["color_identity", "art_url"]) {
      expect(v35({ ...at("m15token"), [column]: undefined }), column).toBe(true);
      // Off the see-through-c templates it needs nothing but the template.
      expect(v35({ ...at("lotr"), [column]: undefined }), column).toBe(false);
    }
    expect(v35({ frame_style: { template: "nyx" } })).toBe(true);
  });

  it("is verification-neutral: a v34 frame_reviews tick stays fresh on every template", async () => {
    const { VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    expect(VERIFICATION_NEUTRAL_VERSIONS).toContain(35);
    expect(VERIFICATION_SCOPED_VERSIONS[35]).toEqual([]);
    for (const t of ALL) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(34, t, VERIFICATION_SCOPED_VERSIONS, 35, regular), t).toBe(false);
    }
  });

  it("takes the frame colour pick from the leaf module, not the frame layer (API routes import this file)", () => {
    const src = readFileSync(join(process.cwd(), "lib/cards/layout-version.ts"), "utf8");
    expect(src).not.toMatch(/from "@\/components\//);
    expect(src).toContain('import { pickFrameColorKey } from "@/lib/cards/frame-color-key";');
  });
});

describe("v36 — the second correction round: inline pips, printed set symbols, the walker symbol (one bump)", () => {
  const png = "https://x/y.png";
  /** A v35 bake. Its columns default to UNTOUCHED_SINCE_V22 (a blue one-word
   *  sorcery with no text, set icon or code), so only v36 can be pending. */
  const at = (template: string, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: 35,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });
  const ALL = [...new Set([...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES])];

  it("is a sweep, never a badge, with its lists frozen as literals and pinned to the profiles and the table", async () => {
    const lv = await import("@/lib/cards/layout-version");
    const { SET_SYMBOL_PRINTED_PX } = await import("@/lib/cards/set-symbol-prints");
    expect(lv.CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(36);
    expect(lv.rolloutPolicy(36)).toBe("sweep");
    expect(lv.latestSweepVersion(undefined, 36)).toBe(36);
    expect(lv.latestOptInVersion()).toBe(22);
    expect(lv.VERSION_SCOPES[36]).toBeTypeOf("function");
    // Every template that draws ability rows (the walkers) — and nothing
    // else: v36 changes no frame master (nyx's darker bar and box are v37's).
    const rows = ALL.filter((t) => getFrameProfile(t).loyaltyRows);
    expect(lv.V36_EVERY_CARD_TEMPLATES).toEqual(rows);
    expect(lv.V36_EVERY_CARD_TEMPLATES).not.toContain("nyx");
    // The printed-size templates: the profiles with setSymbolFit "ink" — as
    // they stood at v36. The battle took the family's ink fit with its own
    // bump (layout v43, TODO 4.21b), which re-bakes every battle card: v36's
    // frozen list never names it.
    const INK_FIT_SINCE_V36 = ["battle"];
    expect(getFrameProfile("battle").setSymbolFit).toBe("ink");
    expect(lv.V36_PRINTED_SYMBOL_TEMPLATES).not.toContain("battle");
    expect([...lv.V36_PRINTED_SYMBOL_TEMPLATES].sort()).toEqual(
      ALL.filter(
        (t) => getFrameProfile(t).setSymbolFit === "ink" && !POST_V36_TEMPLATES.includes(t) && !INK_FIT_SINCE_V36.includes(t),
      ).sort(),
    );
    expect(lv.V36_PRINTED_SYMBOL_SETS).toEqual(Object.keys(SET_SYMBOL_PRINTED_PX).sort());
    // The codes: exactly those whose glyph (as the renderers look it up) the
    // table sizes — the sets and the aliases keyrune draws with their glyphs.
    const { KEYRUNE_CODEPOINTS } = await import("@/lib/cards/keyrune-metrics");
    const { keyruneCodepointFor } = await import("@/lib/cards/set-symbol-size");
    const { printedSetSymbolPx } = await import("@/lib/cards/set-symbol-prints");
    const sized = Object.keys(KEYRUNE_CODEPOINTS)
      .filter((code) => printedSetSymbolPx(keyruneCodepointFor(code)) !== null)
      .sort();
    expect(lv.V36_PRINTED_SYMBOL_CODES).toEqual(sized);
    for (const code of Object.keys(KEYRUNE_CODEPOINTS)) {
      expect(lv.v36PrintedSymbolCode(code), code).toBe(sized.includes(code));
      expect(lv.v36PrintedSymbolCode(`SS-${code.toUpperCase()}`), code).toBe(sized.includes(code));
    }
    // An unknown code draws the default glyph, which the table doesn't size.
    expect(printedSetSymbolPx(keyruneCodepointFor("zzz9"))).toBeNull();
    expect(lv.v36PrintedSymbolCode("zzz9")).toBe(false);
    expect(lv.V36_TEXTLESS_TEMPLATES).toEqual(ALL.filter((t) => getFrameProfile(t).textless));
    expect(lv.V36_BACK_FACE_TEXT_TEMPLATES).toEqual(
      ALL.filter((t) => getFrameProfile(t).adventure || getFrameProfile(t).secondFace),
    );
    // What moved on the walkers (4.47): the symbolRect, onto M15's right edge.
    for (const t of rows) expect(getFrameProfile(t).symbolRect?.leftPct, t).toBe(80.2);
  });

  it("re-bakes every walker card, and a text-free card nowhere else", async () => {
    const { V36_EVERY_CARD_TEMPLATES, hasNewerLook, hasPendingCorrection } = await import(
      "@/lib/cards/layout-version"
    );
    // (Pinned at v36: v37 re-bakes every nyx card on its own.)
    const classifyForSweep = await sweepAt(36);
    for (const t of ALL) {
      const whole = V36_EVERY_CARD_TEMPLATES.includes(t);
      const row = at(t);
      expect(classifyForSweep(row), t).toBe(whole ? "rebake" : "stamp");
      expect(hasPendingCorrection(row, AT_V36), t).toBe(whole);
      expect(hasNewerLook({ ...row, visibility: "public" }, AT_V36), t).toBe(false);
    }
    expect(classifyForSweep(at("m15", { layout_version: 36 }))).toBe("current");
  });

  it("treats nyx like any other printed-size template: a pip or a listed set's glyph, nothing else", async () => {
    const { classifyForSweep } = await import("@/lib/cards/layout-version");
    // (Pinned at v36: v37 re-bakes every nyx card on its own.)
    expect(classifyForSweep(at("nyx"), undefined, AT_V36)).toBe("stamp");
    expect(classifyForSweep(at("nyx", { art_url: "https://x/a.png", rules_text: "Flying" }), undefined, AT_V36)).toBe("stamp");
    expect(classifyForSweep(at("nyx", { rules_text: "{T}: Add {G}." }), undefined, AT_V36)).toBe("rebake");
    expect(classifyForSweep(at("nyx", { set_icon_code: "thb" }), undefined, AT_V36)).toBe("rebake");
    expect(classifyForSweep(at("nyx", { set_icon_code: "war" }), undefined, AT_V36)).toBe("stamp");
  });

  it("re-bakes a card whose printed text draws an inline pip (3.31), on any template that prints it", async () => {
    // (Pinned at v36: v37 re-bakes every nyx card on its own.)
    const classifyForSweep = await sweepAt(36);
    const pip = "{T}: Add {G}.";
    for (const t of ["m15", "lotr", "retro", "adventure", "flip", "m15tokentext", "emblem", "saga", "battle"]) {
      expect(classifyForSweep(at(t, { rules_text: pip })), t).toBe("rebake");
      expect(classifyForSweep(at(t, { rules_text: "Flying" })), `${t} no pip`).toBe("stamp");
    }
    // A {} frame_style draws m15.
    expect(classifyForSweep(at("m15", { frame_style: {}, rules_text: pip }))).toBe("rebake");
    // In reminder text too; "{ }" draws nothing; flavor draws no pips.
    expect(classifyForSweep(at("m15", { rules_text: "Mana (({T}: Add {C}.))" }))).toBe("rebake");
    expect(classifyForSweep(at("m15", { rules_text: "Odd { } braces" }))).toBe("stamp");
    expect(classifyForSweep(at("m15", { flavor_text: "{T}", rules_text: null }))).toBe("stamp");
    // A basic land's text is never drawn; the full-art token's textless
    // height prints no text.
    expect(classifyForSweep(at("m15land", { card_type: "land", supertype: "Basic", subtypes: ["Forest"], title: "Forest", rules_text: pip }))).toBe("stamp");
    expect(classifyForSweep(at("m15land", { card_type: "land", title: "Grove", rules_text: pip }))).toBe("rebake");
    for (const t of ["m20token", "m20tokenartifact"]) expect(classifyForSweep(at(t, { rules_text: pip })), t).toBe("stamp");
    // A back face's text only where the adventure page or a second face draws it.
    const back = { title: "B", rules_text: "{1}: Scry 1." };
    expect(classifyForSweep(at("adventure", { back_face: back }))).toBe("rebake");
    expect(classifyForSweep(at("split", { back_face: back }))).toBe("rebake");
    expect(classifyForSweep(at("m15", { back_face: back }))).toBe("stamp");
    // A saga's chapters (face_content) on the saga rail only.
    const saga = { saga: { chapters: [{ text: "Add {R}." }] } };
    expect(classifyForSweep(at("saga", { face_content: saga }))).toBe("rebake");
    expect(classifyForSweep(at("m15", { face_content: saga }))).toBe("stamp");
  });

  it("re-bakes a listed set's Keyrune glyph on a printed-size template (4.46), and nothing else of the symbol", async () => {
    const { V36_PRINTED_SYMBOL_TEMPLATES } = await import("@/lib/cards/layout-version");
    // (Pinned at v36: v37 re-bakes every nyx card on its own.)
    const classifyForSweep = await sweepAt(36);
    for (const t of ALL) {
      const printed = V36_PRINTED_SYMBOL_TEMPLATES.includes(t);
      const whole = ["m15pw", "m15borderlesspw", "m15borderlesspwtall"].includes(t);
      expect(classifyForSweep(at(t, { set_icon_code: "neo" })), `${t} neo`).toBe(printed || whole ? "rebake" : "stamp");
      // Case and the "ss-" prefix resolve as the renderers do.
      expect(classifyForSweep(at(t, { set_icon_code: "SS-DOM" })), `${t} dom`).toBe(printed || whole ? "rebake" : "stamp");
      // WAR / ZNR / BFZ stay on v32's fit (their print's size is its px).
      for (const code of ["war", "znr", "bfz", "xln", "zzz9"]) {
        expect(classifyForSweep(at(t, { set_icon_code: code })), `${t} ${code}`).toBe(whole ? "rebake" : "stamp");
      }
      // An alias keyrune draws with a listed set's glyph (GK1 = GRN's).
      expect(classifyForSweep(at(t, { set_icon_code: "gk1" })), `${t} gk1`).toBe(printed || whole ? "rebake" : "stamp");
      // An uploaded icon never rules the code's glyph out: the renderers drop
      // an icon they may not draw (an outside host here) and draw the glyph.
      expect(classifyForSweep(at(t, { set_icon_code: "neo", set_icon_url: "https://x/i.png" })), `${t} icon`).toBe(
        printed || whole ? "rebake" : "stamp",
      );
      // …and a drawable one (it wins; the re-bake draws the same pixels) is
      // judged the same way — which host is drawable is the deployment's.
      const stored = "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/set-covers/00000000-0000-4000-8000-000000000000/icon.png";
      expect(classifyForSweep(at(t, { set_icon_code: "neo", set_icon_url: stored })), `${t} stored icon`).toBe(
        printed || whole ? "rebake" : "stamp",
      );
      // An icon with an unlisted code, or none, draws no listed glyph.
      expect(classifyForSweep(at(t, { set_icon_code: "war", set_icon_url: stored })), `${t} icon war`).toBe(
        whole ? "rebake" : "stamp",
      );
      expect(classifyForSweep(at(t, { set_icon_code: null, set_icon_url: stored })), `${t} icon only`).toBe(
        whole ? "rebake" : "stamp",
      );
    }
    // The full-art basics keep 4.39's glyph size.
    for (const t of ["m15fullartland", "fullartland"]) expect(V36_PRINTED_SYMBOL_TEMPLATES).not.toContain(t);
  });

  it("answers conservatively (affected) for a row missing a column it reads", async () => {
    const { VERSION_SCOPES } = await import("@/lib/cards/layout-version");
    const v36 = VERSION_SCOPES[36];
    expect(v36({ ...at("lotr"), frame_style: undefined })).toBe(true);
    for (const column of ["set_icon_code", "rules_text", "face_content", "back_face"]) {
      expect(v36({ ...at("lotr"), [column]: undefined }), column).toBe(true);
    }
    // The icon column is never read (an icon never rules the glyph out).
    expect(v36({ ...at("lotr"), set_icon_url: undefined })).toBe(false);
    for (const column of ["card_type", "supertype", "subtypes", "title"]) {
      expect(v36({ ...at("m15", { rules_text: "{T}: Draw." }), [column]: undefined }), column).toBe(true);
      expect(v36({ ...at("m15"), [column]: undefined }), `${column} no pip`).toBe(false);
    }
    expect(v36({ frame_style: { template: "m15pw" } })).toBe(true);
  });

  it("keeps the keyrune tables out of the module (client code imports it)", () => {
    const source = readFileSync(join(process.cwd(), "lib/cards/layout-version.ts"), "utf8");
    expect(source).not.toMatch(/from "@\/lib\/cards\/(set-symbol-size|set-symbol-prints|keyrune-metrics)"/);
  });

  it("finds a pip exactly where the rules tokenizer draws one", async () => {
    const { v36HasPip } = await import("@/lib/cards/layout-version");
    const { tokenizeRulesText } = await import("@/lib/cards/rules-text");
    const texts = [
      "{T}: Add {G}.",
      "Flying",
      "Kicker {2}{R}",
      "Equip {1}",
      "({T}: Add {C}.)",
      "Odd { } braces",
      "{",
      "}{",
      "{W/U}",
      "{2/B} and {G/P}",
      "{E}{E}",
      "{Q}, untap",
      "{x}",
      "Landfall — {T}: Draw.",
      "no {braces here",
      "",
      "{ T }",
    ];
    for (const text of texts) {
      const drawn = tokenizeRulesText(text).some((p) => p.some((item) => item.t === "m"));
      expect(v36HasPip(text), text).toBe(drawn);
    }
    expect(v36HasPip(null)).toBe(false);
  });

  it("is verification-neutral: no frame tick goes stale, the walkers' included (owner round 18)", async () => {
    const { VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    // The owner signed 4.47's walker symbolRect move off on the round-18
    // sheet, as v32's m15pw costRect move: no re-tick.
    expect(VERIFICATION_NEUTRAL_VERSIONS).toContain(36);
    expect(VERIFICATION_SCOPED_VERSIONS[36]).toEqual([]);
    for (const t of ALL) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(35, t, VERIFICATION_SCOPED_VERSIONS, 36, regular), t).toBe(false);
    }
    // …while every walker card still owes the bake (the sweep).
    const classifyForSweep = await sweepAt(36);
    for (const t of ["m15pw", "m15borderlesspw", "m15borderlesspwtall"]) {
      expect(classifyForSweep(at(t)), t).toBe("rebake");
    }
  });
});

describe("v37 — nyx's darker type bar and text box (TODO 4.17e)", () => {
  const png = "https://x/y.png";
  /** A v36 bake. Its columns default to UNTOUCHED_SINCE_V22 (a blue one-word
   *  sorcery with no text, set icon or code), so only v37 can be pending. */
  const at = (template: string, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: 36,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });
  const ALL = [...new Set([...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES])];
  const AT_V37 = { current: 37 } as const;

  it("is a sweep, never a badge, scoped to the nyx template", async () => {
    const lv = await import("@/lib/cards/layout-version");
    expect(lv.CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(37);
    expect(lv.rolloutPolicy(37)).toBe("sweep");
    expect(lv.latestSweepVersion(undefined, 37)).toBe(37);
    expect(lv.latestOptInVersion()).toBe(22);
    // A master replacement: template-scoped (as v30's fullartland), no card
    // predicate — a template-only caller gets the same answer.
    expect(lv.VERSION_SCOPES[37]).toBeUndefined();
    expect(ALL).toContain("nyx");
    for (const t of ALL) expect(isRenderStale(36, t, undefined, 37), t).toBe(t === "nyx");
  });

  it("re-bakes every nyx card — art or none, any finish, any text — and stamps every other template", async () => {
    const { hasNewerLook, hasPendingCorrection } = await import("@/lib/cards/layout-version");
    const classifyForSweep = await sweepAt(37);
    for (const t of ALL) {
      const nyx = t === "nyx";
      const row = at(t);
      expect(classifyForSweep(row), t).toBe(nyx ? "rebake" : "stamp");
      expect(hasPendingCorrection(row, AT_V37), t).toBe(nyx);
      expect(hasNewerLook({ ...row, visibility: "public" }, AT_V37), t).toBe(false);
    }
    // The bar and box draw over the ground too, so a card without art re-bakes.
    for (const over of [
      { art_url: null },
      { art_url: "https://x/a.png", rules_text: "Flying" },
      { frame_style: { template: "nyx", finish: "foil" } },
      { set_icon_code: "war" },
    ]) {
      expect(classifyForSweep(at("nyx", over)), JSON.stringify(over)).toBe("rebake");
    }
    // A {} frame_style draws m15, which v37 leaves alone.
    expect(classifyForSweep({ ...at("m15"), frame_style: {} })).toBe("stamp");
    expect(classifyForSweep(at("nyx", { layout_version: 37 }))).toBe("current");
  });

  it("is verification-neutral: nyx's black moves no slot, and no tick goes stale", async () => {
    const { VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    expect(VERIFICATION_NEUTRAL_VERSIONS).toContain(37);
    expect(VERIFICATION_SCOPED_VERSIONS[37]).toEqual([]);
    for (const t of ALL) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(36, t, VERIFICATION_SCOPED_VERSIONS, 37, regular), t).toBe(false);
    }
    // The profile is v35's: only the masters changed.
    expect(getFrameProfile("nyx").artSlot).toEqual({ topPct: 11.2, leftPct: 6, widthPct: 88, heightPct: 81.8 });
  });
});

describe("v38 — the portrait layouts re-sourced from Card Conjurer (TODO 4.21a)", () => {
  const png = "https://x/y.png";
  /** A v37 bake. Its columns default to UNTOUCHED_SINCE_V22 (a blue one-word
   *  sorcery with no text, set icon or code), so only v38 can be pending. */
  const at = (template: string, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: 37,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });
  const ALL = [...new Set([...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES])];
  const AT_V38 = { current: 38 } as const;
  const TRIO = ["adventure", "aftermath", "flip"];

  it("is a sweep, never a badge, scoped to adventure, aftermath and flip — frozen as a literal", async () => {
    const lv = await import("@/lib/cards/layout-version");
    expect(lv.CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(38);
    expect(lv.rolloutPolicy(38)).toBe("sweep");
    expect(lv.latestSweepVersion(undefined, 38)).toBe(38);
    expect(lv.latestOptInVersion()).toBe(22);
    expect([...lv.V38_PORTRAIT_LAYOUT_TEMPLATES].sort()).toEqual(TRIO);
    // A master and slot replacement: template-scoped (as v30's fullartland
    // and v37's nyx), no card predicate — a template-only caller gets the
    // same answer.
    expect(lv.VERSION_SCOPES[38]).toBeUndefined();
    for (const t of TRIO) expect(ALL).toContain(t);
    for (const t of ALL) expect(isRenderStale(37, t, undefined, 38), t).toBe(TRIO.includes(t));
  });

  it("re-bakes every card on the three — art or none, any finish, a half with or without a P/T — and stamps every other template", async () => {
    const { hasNewerLook, hasPendingCorrection } = await import("@/lib/cards/layout-version");
    const classifyForSweep = await sweepAt(38);
    for (const t of ALL) {
      const trio = TRIO.includes(t);
      const row = at(t);
      expect(classifyForSweep(row), t).toBe(trio ? "rebake" : "stamp");
      expect(hasPendingCorrection(row, AT_V38), t).toBe(trio);
      expect(hasNewerLook({ ...row, visibility: "public" }, AT_V38), t).toBe(false);
    }
    // The masters and every slot move, so a card without art re-bakes, and
    // so does one whose halves print no P/T.
    for (const [t, over] of [
      ["flip", { art_url: null }],
      ["flip", { back_face: { title: "Dokai", card_type: "creature", power: "3", toughness: "3" } }],
      ["flip", { back_face: { title: "Essence", card_type: "enchantment" } }],
      ["adventure", { art_url: "https://x/a.png", back_face: { title: "Stomp", card_type: "instant", rules_text: "Stomp deals 2 damage to any target." } }],
      ["aftermath", { frame_style: { template: "aftermath", finish: "foil" } }],
      ["adventure", { set_icon_code: "eld" }],
    ] as const) {
      expect(classifyForSweep(at(t, over)), `${t} ${JSON.stringify(over)}`).toBe("rebake");
    }
    // A {} frame_style draws m15, which v38 leaves alone; 4.21b / 4.21c's
    // templates (split, battle, saga) wait for their own bumps.
    expect(classifyForSweep({ ...at("m15"), frame_style: {} })).toBe("stamp");
    for (const t of ["split", "battle", "saga"]) expect(classifyForSweep(at(t)), t).toBe("stamp");
    expect(classifyForSweep(at("flip", { layout_version: 38 }))).toBe("current");
  });

  it("is NOT verification-neutral: the three templates' slots move (no tick exists to stale today), every other template's ticks stay fresh", async () => {
    const { VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    expect(VERIFICATION_NEUTRAL_VERSIONS).not.toContain(38);
    expect([...VERIFICATION_SCOPED_VERSIONS[38]].sort()).toEqual(TRIO);
    for (const t of ALL) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(37, t, VERIFICATION_SCOPED_VERSIONS, 38, regular), t).toBe(TRIO.includes(t));
    }
    // The profiles moved onto Card Conjurer's packs: flip's art slot is
    // packFlip.js's window + 0.1 % (its bottom 7 px higher since v39's
    // re-cut: 33.25 → 32.91 %H), adventure's pinned (design D4),
    // aftermath's windows + 0.1 %.
    expect(getFrameProfile("flip").artSlot).toEqual({ topPct: 29.57, leftPct: 7.57, widthPct: 84.87, heightPct: 32.91 });
    expect(getFrameProfile("adventure").artSlot).toEqual({ topPct: 11.19, leftPct: 7.57, widthPct: 84.87, heightPct: 44.44 });
    expect(getFrameProfile("aftermath").artSlot).toEqual({ topPct: 11.19, leftPct: 7.57, widthPct: 84.87, heightPct: 22.44 });
    expect(getFrameProfile("aftermath").secondFace?.artSlot).toEqual({ topPct: 63.62, leftPct: 44.63, widthPct: 49.41, heightPct: 20.33 });
  });
});

// TODO 3.26 review: the share composite keeps its old clip over a bake from
// before v31 (a square bake with the frame's own corner) until the sweep.
describe("isRoundBake", () => {
  it("is true from v31 on; an older or a null stamp may be a square bake", async () => {
    const { ROUND_BAKE_LAYOUT_VERSION, isRoundBake } = await import("@/lib/cards/layout-version");
    expect(ROUND_BAKE_LAYOUT_VERSION).toBe(31);
    expect(isRoundBake(31)).toBe(true);
    expect(isRoundBake(32)).toBe(true);
    expect(isRoundBake(30)).toBe(false);
    expect(isRoundBake(null)).toBe(false);
    expect(isRoundBake(undefined)).toBe(false);
  });
});

describe("v39 — flip's lower half and aftermath's cost onto the prints (TODO 4.21a follow-up)", () => {
  const png = "https://x/y.png";
  /** A v38 bake. Its columns default to UNTOUCHED_SINCE_V22, so only v39 can
   *  be pending. */
  const at = (template: string, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: 38,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });
  const ALL = [...new Set([...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES])];
  const AT_V39 = { current: 39 } as const;
  const PAIR = ["aftermath", "flip"];

  it("is a sweep, never a badge, scoped to aftermath and flip — frozen as a literal", async () => {
    const lv = await import("@/lib/cards/layout-version");
    expect(lv.CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(39);
    expect(lv.VERSION_ROLLOUT[39]).toBe("sweep");
    expect(lv.rolloutPolicy(39)).toBe("sweep");
    expect(lv.latestSweepVersion(undefined, 39)).toBe(39);
    expect(lv.latestOptInVersion()).toBe(22);
    expect([...lv.V39_FLIP_AFTERMATH_TEMPLATES].sort()).toEqual(PAIR);
    // A master re-cut and a slot move: template-scoped, no card predicate.
    expect(lv.VERSION_SCOPES[39]).toBeUndefined();
    for (const t of ALL) expect(isRenderStale(38, t, undefined, 39), t).toBe(PAIR.includes(t));
    // Adventure (v38's third) is untouched: its cards stamp, never re-bake.
    expect(isRenderStale(38, "adventure", undefined, 39)).toBe(false);
  });

  it("re-bakes every card on the two — art or none, any finish, a half with or without a P/T — and stamps every other template", async () => {
    const { hasNewerLook, hasPendingCorrection } = await import("@/lib/cards/layout-version");
    const classifyForSweep = await sweepAt(39);
    for (const t of ALL) {
      const pair = PAIR.includes(t);
      const row = at(t);
      expect(classifyForSweep(row), t).toBe(pair ? "rebake" : "stamp");
      expect(hasPendingCorrection(row, AT_V39), t).toBe(pair);
      expect(hasNewerLook({ ...row, visibility: "public" }, AT_V39), t).toBe(false);
    }
    for (const [t, over] of [
      ["flip", { art_url: null }],
      ["flip", { back_face: { title: "Dokai", card_type: "creature", power: "3", toughness: "3" } }],
      ["flip", { back_face: { title: "Essence", card_type: "enchantment" } }],
      ["flip", { frame_style: { template: "flip", finish: "foil" } }],
      ["aftermath", { cost: "" }],
      ["aftermath", { frame_style: { template: "aftermath", finish: "etched" } }],
    ] as const) {
      expect(classifyForSweep(at(t, over)), `${t} ${JSON.stringify(over)}`).toBe("rebake");
    }
    expect(classifyForSweep(at("adventure"))).toBe("stamp");
    expect(classifyForSweep(at("flip", { layout_version: 39 }))).toBe("current");
  });

  it("is NOT verification-neutral (a master and slots move); no tick exists on either to stale, every other template's ticks stay fresh", async () => {
    const { VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    expect(VERIFICATION_NEUTRAL_VERSIONS).not.toContain(39);
    expect([...VERIFICATION_SCOPED_VERSIONS[39]].sort()).toEqual(PAIR);
    for (const t of ALL) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(38, t, VERIFICATION_SCOPED_VERSIONS, 39, regular), t).toBe(PAIR.includes(t));
    }
    // What moved: flip's art slot ends at the re-cut window (1312.1 px) and
    // its upside-down rules rect follows the text box's top edge; aftermath's
    // cost runs to 92.3 %W, 8.6 px higher. Adventure's profile is v38's.
    expect(getFrameProfile("flip").artSlot).toEqual({ topPct: 29.57, leftPct: 7.57, widthPct: 84.87, heightPct: 32.91 });
    expect(getFrameProfile("flip").secondFace?.rules.rect).toEqual({ topPct: 69.86, leftPct: 8.6, widthPct: 82.8, heightPct: 12.24 });
    expect(getFrameProfile("aftermath").title.rect).toEqual({ topPct: 5.7, leftPct: 8.5, widthPct: 83.8, heightPct: 4.4 });
    expect(getFrameProfile("aftermath").costDy).toBeCloseTo(-8.6 / 1500, 9);
    expect(getFrameProfile("adventure").artSlot).toEqual({ topPct: 11.19, leftPct: 7.57, widthPct: 84.87, heightPct: 44.44 });
  });
});

describe("v40 — the modal backs' flipside strip toned onto the prints (TODO 5.1d)", () => {
  const png = "https://x/y.png";
  /** A v39 bake. Its columns default to UNTOUCHED_SINCE_V22, so only v40 can
   *  be pending. */
  const at = (template: string, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: 39,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });
  const ALL = [...new Set([...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES])];
  const AT_V40 = { current: 40 } as const;
  /** The four modal faces (the toned strips) and the two transform FRONT
   *  bodies with the reverse-P/T tab (its digits a rules float since 5.1d). */
  const FACES = ["m15dfcfront", "m15dfclandfront", "m15mdfcback", "m15mdfcfront", "m15mdfclandback", "m15mdfclandfront"];
  /** …of which the two modal BACK bodies' masters and the two transform
   *  fronts' rules layout change (a tick there would stale). */
  const VERIFIED = ["m15dfcfront", "m15dfclandfront", "m15mdfcback", "m15mdfclandback"];

  it("is a sweep, never a badge, scoped to the four modal faces and the two transform fronts — frozen as a literal", async () => {
    const lv = await import("@/lib/cards/layout-version");
    expect(lv.CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(40);
    expect(lv.VERSION_ROLLOUT[40]).toBe("sweep");
    expect(lv.rolloutPolicy(40)).toBe("sweep");
    expect(lv.latestSweepVersion(undefined, 40)).toBe(40);
    expect(lv.latestOptInVersion()).toBe(22);
    expect([...lv.V40_TEMPLATES].sort()).toEqual(FACES);
    expect([...lv.V40_VERIFICATION_TEMPLATES].sort()).toEqual(VERIFIED);
    // A master re-cut (the strip's tone) and a layout correction (the
    // float): template-scoped, no card predicate.
    expect(lv.VERSION_SCOPES[40]).toBeUndefined();
    for (const t of ALL) expect(isRenderStale(39, t, undefined, 40), t).toBe(FACES.includes(t));
    // The transform BACK bodies and v39's pair are untouched: their cards stamp.
    for (const t of ["m15dfcback", "m15dfcbackleft", "m15dfclandback", "flip", "aftermath", "m15"]) expect(isRenderStale(39, t, undefined, 40), t).toBe(false);
  });

  it("re-bakes every card on the modal faces and the transform fronts — art or none, any finish, a back with or without a cost — and stamps every other template", async () => {
    const { hasNewerLook, hasPendingCorrection } = await import("@/lib/cards/layout-version");
    const classifyForSweep = await sweepAt(40);
    for (const t of ALL) {
      const face = FACES.includes(t);
      const row = at(t);
      expect(classifyForSweep(row), t).toBe(face ? "rebake" : "stamp");
      expect(hasPendingCorrection(row, AT_V40), t).toBe(face);
      expect(hasNewerLook({ ...row, visibility: "public" }, AT_V40), t).toBe(false);
    }
    for (const [t, over] of [
      ["m15mdfcfront", { art_url: null }],
      ["m15mdfcfront", { back_face: { title: "Echoing Equation", cost: "{3}{U}{U}", card_type: "sorcery", frame_style: { template: "m15mdfcback" }, color_identity: ["blue"] } }],
      ["m15mdfclandfront", { back_face: { title: "Grimclimb Pathway", card_type: "land", frame_style: { template: "m15mdfclandback" }, color_identity: ["black"] } }],
      ["m15mdfcfront", { frame_style: { template: "m15mdfcfront", finish: "foil" } }],
    ] as const) {
      expect(classifyForSweep(at(t, over)), `${t} ${JSON.stringify(over)}`).toBe("rebake");
    }
    expect(classifyForSweep(at("m15dfcback"))).toBe("stamp");
    expect(classifyForSweep(at("m15dfcfront", { back_face: { title: "Ormendahl", card_type: "creature", power: "9", toughness: "7", frame_style: { template: "m15dfcback" }, color_identity: ["black"] } }))).toBe("rebake");
    expect(classifyForSweep(at("m15mdfcfront", { layout_version: 40 }))).toBe("current");
  });

  it("is NOT verification-neutral on the two modal back bodies (their masters change) and the two transform fronts (their rules layout does); the modal fronts' ticks and every other template's stay fresh", async () => {
    const { VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    expect(VERIFICATION_NEUTRAL_VERSIONS).not.toContain(40);
    expect([...VERIFICATION_SCOPED_VERSIONS[40]].sort()).toEqual(VERIFIED);
    for (const t of ALL) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(39, t, VERIFICATION_SCOPED_VERSIONS, 40, regular), t).toBe(VERIFIED.includes(t));
    }
    // No slot moves: the modal profiles' strip slots are 5.1b's.
    expect(getFrameProfile("m15mdfcback").flipside?.word.rect).toEqual({ leftPct: 6.8, topPct: 89.2, widthPct: 36.4, heightPct: 3.91 });
    expect(getFrameProfile("m15mdfcback").flipside?.keepOut).toEqual({ leftPct: 3.0, topPct: 88.67, widthPct: 43.8, heightPct: 4.43 });
  });
});

describe("v41 — the modal flipside strip rider (TODO 5.1c)", () => {
  const png = "https://x/y.png";
  /** A v40 bake: only v41 can be pending. */
  const at = (template: string, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: 40,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });
  const ALL = [...new Set([...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES])];
  const AT_V41 = { current: 41 } as const;
  /** The four modal faces: the rider is declared on them alone. */
  const FACES = ["m15mdfcback", "m15mdfcfront", "m15mdfclandback", "m15mdfclandfront"];

  it("is a sweep, never a badge, scoped to the four modal faces — frozen as a literal; every other v40 card stamps", async () => {
    const lv = await import("@/lib/cards/layout-version");
    expect(lv.CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(41);
    expect(lv.VERSION_ROLLOUT[41]).toBe("sweep");
    expect(lv.rolloutPolicy(41)).toBe("sweep");
    expect(lv.latestSweepVersion(undefined, 41)).toBe(41);
    expect(lv.latestOptInVersion()).toBe(22);
    expect([...lv.V41_TEMPLATES].sort()).toEqual(FACES);
    expect(lv.VERSION_SCOPES[41]).toBeUndefined();
    for (const t of ALL) expect(isRenderStale(40, t, undefined, 41), t).toBe(FACES.includes(t));
    const { hasNewerLook, hasPendingCorrection } = lv;
    const classifyForSweep = await sweepAt(41);
    for (const t of ALL) {
      const face = FACES.includes(t);
      const row = at(t);
      expect(classifyForSweep(row), t).toBe(face ? "rebake" : "stamp");
      expect(hasPendingCorrection(row, AT_V41), t).toBe(face);
      expect(hasNewerLook({ ...row, visibility: "public" }, AT_V41), t).toBe(false);
    }
    expect(classifyForSweep(at("m15mdfcfront", { layout_version: 41 }))).toBe("current");
  });

  it("is NOT verification-neutral: every one of the four faces has references whose compare render gains the rider (the spell backs' STX cards, the land fronts' pathways, the front's MH3 `m`, the land back's pathway alternates), so a tick made on a modal face before v41 is kept but stale; every other template's stays fresh", async () => {
    const { VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    const { verificationState } = await import("@/lib/cards/frame-verification-state");
    expect(VERIFICATION_NEUTRAL_VERSIONS).not.toContain(41);
    expect([...VERIFICATION_SCOPED_VERSIONS[41]].sort()).toEqual(FACES);
    for (const t of ALL) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(40, t, VERIFICATION_SCOPED_VERSIONS, 41, regular), t).toBe(FACES.includes(t));
    }
    const tick = { verified: true, verifiedLayoutVersion: 40, verifiedOverrideHash: "h" } as const;
    expect(verificationState(tick, "m15mdfcback", "h", 41).stale).toBe(true);
    expect(verificationState(tick, "m15mdfclandfront", "h", 41).stale).toBe(true);
    expect(verificationState(tick, "m15", "h", 41).stale).toBe(false);
    expect(verificationState(tick, "m15dfcfront", "h", 41).stale).toBe(false);
    expect(verificationState({ ...tick, verifiedLayoutVersion: 41 }, "m15mdfcback", "h", 41).stale).toBe(false);
    // Flagged, never dropped: the row stays verified (what the creator's
    // picker reads), with the reason the checklist prints.
    const stale = verificationState(tick, "m15mdfcfront", "h", 41);
    expect(stale).toMatchObject({ verified: true, stale: true, legacy: false });
    expect(stale.reasons).toEqual(["the renderer changed since layout v40 (now v41)"]);
    expect(verificationState(tick, "m15mdfclandback", "h", 41)).toMatchObject({ verified: true, stale: true });
    // No slot moves: the modal profiles' strip slots are 5.1b's; the rider's
    // slot is the piece's box, inside the painted strip's keep-out.
    expect(getFrameProfile("m15mdfcback").flipside?.keepOut).toEqual({ leftPct: 3.0, topPct: 88.67, widthPct: 43.8, heightPct: 4.43 });
    expect(getFrameProfile("m15mdfcback").overlays?.find((o) => o.anatomy === "mdfcStrip")?.rect).toEqual({ leftPct: 44 / 15, topPct: 1866 / 21, widthPct: 658 / 15, heightPct: 90 / 21 });
  });
});

// The saga's bump is addressed by its constant, never by its number: it was
// built as 42 beside 4.21b's split and battle, and whichever merges second
// takes the next number (lib/cards/layout-version.ts SAGA_RAIL_LAYOUT_VERSION).
describe("the saga rebuilt from Card Conjurer (TODO 4.21c) — its bump", () => {
  const png = "https://x/y.png";
  const ALL = [...new Set([...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES])];

  it("is ONE version in one constant: a sweep, never a badge, scoped to `saga` alone — every other card stamps", async () => {
    const lv = await import("@/lib/cards/layout-version");
    const V = lv.SAGA_RAIL_LAYOUT_VERSION;
    expect(Number.isInteger(V)).toBe(true);
    expect(V).toBeGreaterThan(41);
    expect(lv.CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(V);
    expect(lv.VERSION_ROLLOUT[V]).toBe("sweep");
    expect(lv.rolloutPolicy(V)).toBe("sweep");
    expect(lv.latestSweepVersion(undefined, V)).toBe(V);
    expect(lv.latestOptInVersion()).toBe(22);
    // Frozen as a literal, and nothing but the template list scopes it: a
    // saga with no art, no text or no chapters re-bakes too (its master and
    // its type line change).
    expect([...lv.SAGA_RAIL_TEMPLATES]).toEqual(["saga"]);
    expect(lv.VERSION_SCOPES[V]).toBeUndefined();
    for (const t of ALL) expect(isRenderStale(V - 1, t, undefined, V), t).toBe(t === "saga");

    /** A bake stamped just before the bump: only it can be pending. */
    const at = (template: string, over: Record<string, unknown> = {}) => ({
      ...UNTOUCHED_SINCE_V22,
      layout_version: V - 1,
      rendered_image_url: png,
      frame_style: { template, finish: "regular" },
      ...over,
    });
    const classifyForSweep = await sweepAt(V);
    for (const t of ALL) {
      const row = at(t);
      expect(classifyForSweep(row), t).toBe(t === "saga" ? "rebake" : "stamp");
      expect(lv.hasPendingCorrection(row, { current: V }), t).toBe(t === "saga");
      // Never a badge: no owner is asked to accept a correction.
      expect(lv.hasNewerLook({ ...row, visibility: "public" }, { current: V }), t).toBe(false);
    }
    // Every stored saga owes it, whatever it holds: production's four (no
    // reminder, gold and blue), one with no art, one with no text, a foil.
    for (const over of [
      { art_url: null },
      { rules_text: null, face_content: null },
      { face_content: { saga: { intro: null, chapters: [{ marker: "I", text: "Draw a card." }] } } },
      { frame_style: { template: "saga", finish: "foil" } },
      { color_identity: ["blue"] },
    ]) {
      expect(classifyForSweep(at("saga", over)), JSON.stringify(over)).toBe("rebake");
    }
    expect(classifyForSweep(at("saga", { layout_version: V }))).toBe("current");
    // A saga baked at production's v41 owes it as well.
    expect(classifyForSweep(at("saga", { layout_version: 41 }))).toBe("rebake");
    expect(classifyForSweep(at("m15pw", { layout_version: 41 }))).not.toBe("rebake");
  });

  it("is NOT verification-neutral: the masters, the art slot, the type line and the rail move — a saga tick made before it is kept and flagged, every other template's stays fresh", async () => {
    const { SAGA_RAIL_LAYOUT_VERSION: V, VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    const { verificationState } = await import("@/lib/cards/frame-verification-state");
    expect(VERIFICATION_NEUTRAL_VERSIONS).not.toContain(V);
    expect([...VERIFICATION_SCOPED_VERSIONS[V]]).toEqual(["saga"]);
    for (const t of ALL) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(V - 1, t, VERIFICATION_SCOPED_VERSIONS, V, regular), t).toBe(t === "saga");
    }
    // Production's seven saga ticks were made at v33–v41.
    const tick = { verified: true, verifiedLayoutVersion: 41, verifiedOverrideHash: "h" } as const;
    const stale = verificationState(tick, "saga", "h", V);
    // Flagged, never dropped: the row stays verified (what the creator's
    // picker reads), with the reason the checklist prints.
    expect(stale).toMatchObject({ verified: true, stale: true, legacy: false });
    expect(stale.reasons).toEqual([`the renderer changed since layout v41 (now v${V})`]);
    expect(verificationState({ ...tick, verifiedLayoutVersion: V }, "saga", "h", V).stale).toBe(false);
    for (const t of ["m15", "m15pw", "adventure", "flip", "aftermath", "m15mdfcback"]) {
      expect(verificationState(tick, t, "h", V).stale, t).toBe(false);
    }
    // What moved, on the profile: the art slot onto the CC masters' window,
    // the type line's left edge, the rail's column.
    const saga = getFrameProfile("saga");
    expect(saga.artSlot).toEqual({ topPct: 11.19, leftPct: 50.03, widthPct: 42.4, heightPct: 72.68 });
    expect(saga.type.rect.leftPct).toBe(8.5);
    expect(saga.chapters?.rect).toEqual({ topPct: 11.29, leftPct: 13.53, widthPct: 35, heightPct: 72.47 });
    expect(saga.chapters?.rowsTopPct).toBe(29.57);
  });
});

describe("v43 — the landscape layouts re-sourced from Card Conjurer (TODO 4.21b)", () => {
  const png = "https://x/y.png";
  /** A v42 bake: only v43 can be pending. */
  const at = (template: string, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: 42,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });
  const ALL = [...new Set([...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES])];
  const AT_V43 = { current: 43 } as const;
  const PAIR = ["battle", "split"];

  it("is a sweep, never a badge, scoped to battle and split — frozen as a literal", async () => {
    const lv = await import("@/lib/cards/layout-version");
    expect(lv.CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(43);
    expect(lv.VERSION_ROLLOUT[43]).toBe("sweep");
    expect(lv.rolloutPolicy(43)).toBe("sweep");
    expect(lv.latestSweepVersion(undefined, 43)).toBe(43);
    expect(lv.latestOptInVersion()).toBe(22);
    expect([...lv.V43_LANDSCAPE_LAYOUT_TEMPLATES].sort()).toEqual(PAIR);
    // New masters, art slots and text slots: template-scoped, no card
    // predicate — a battle with no defense and a split with no second half
    // change too.
    expect(lv.VERSION_SCOPES[43]).toBeUndefined();
    for (const t of ALL) expect(isRenderStale(42, t, undefined, 43), t).toBe(PAIR.includes(t));
    // The saga (4.21c) and the portrait layouts (v38 / v39) are untouched.
    for (const t of ["saga", "adventure", "aftermath", "flip", "m15"]) expect(isRenderStale(42, t, undefined, 43), t).toBe(false);
  });

  it("re-bakes every card on the two — art or none, any finish, a defense or none, a right half or none — and stamps every other template", async () => {
    const { hasNewerLook, hasPendingCorrection } = await import("@/lib/cards/layout-version");
    const classifyForSweep = await sweepAt(43);
    for (const t of ALL) {
      const pair = PAIR.includes(t);
      const row = at(t);
      expect(classifyForSweep(row), t).toBe(pair ? "rebake" : "stamp");
      expect(hasPendingCorrection(row, AT_V43), t).toBe(pair);
      // A correction: an owner never sees a badge for it.
      expect(hasNewerLook({ ...row, visibility: "public" }, AT_V43), t).toBe(false);
    }
    for (const [t, over] of [
      ["battle", { art_url: null }],
      ["battle", { card_type: "battle", defense: "5" }],
      ["battle", { card_type: "battle", defense: null }],
      ["battle", { frame_style: { template: "battle", finish: "foil" } }],
      ["battle", { color_identity: [] }],
      ["split", { art_url: null }],
      ["split", { back_face: { title: "Furious", card_type: "sorcery", cost: "{3}{R}{R}" } }],
      ["split", { back_face: null }],
      ["split", { frame_style: { template: "split", finish: "etched" } }],
    ] as const) {
      expect(classifyForSweep(at(t, over)), `${t} ${JSON.stringify(over)}`).toBe("rebake");
    }
    expect(classifyForSweep(at("saga"))).toBe("stamp");
    expect(classifyForSweep(at("battle", { layout_version: 43 }))).toBe("current");
    expect(classifyForSweep(at("split", { layout_version: 43 }))).toBe("current");
  });

  it("is NOT verification-neutral (masters and every slot move); neither template has a tick to stale, every other template's ticks stay fresh", async () => {
    const { VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    const { verificationState } = await import("@/lib/cards/frame-verification-state");
    expect(VERIFICATION_NEUTRAL_VERSIONS).not.toContain(43);
    expect([...VERIFICATION_SCOPED_VERSIONS[43]].sort()).toEqual(PAIR);
    for (const t of ALL) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(42, t, VERIFICATION_SCOPED_VERSIONS, 43, regular), t).toBe(PAIR.includes(t));
    }
    // A tick made on either before v43 (production has none: 0 of 7 each)
    // would be kept and flagged; one made on another template stays fresh.
    const tick = { verified: true, verifiedLayoutVersion: 42, verifiedOverrideHash: "h" } as const;
    expect(verificationState(tick, "battle", "h", 43).stale).toBe(true);
    expect(verificationState(tick, "split", "h", 43).stale).toBe(true);
    expect(verificationState(tick, "m15", "h", 43).stale).toBe(false);
    expect(verificationState(tick, "saga", "h", 43).stale).toBe(false);
    expect(verificationState(tick, "flip", "h", 43).stale).toBe(false);
    expect(verificationState({ ...tick, verifiedLayoutVersion: 43 }, "battle", "h", 43).stale).toBe(false);
    // What moved, in HD px of the 2100 × 1500 card. The battle's name starts
    // right of its icon (the MSE rect began 269 px in, under it — TODO 3.28)…
    const battle = getFrameProfile("battle");
    expect(battle.title.rect.leftPct * 21).toBeCloseTo(388, 9); // v43's 392, 4 px left onto the prints with the re-cut (TODO 4.21d)
    // (Its top rides the top block 2 px up since TODO 4.21d; the rest is v43's.)
    expect(battle.artSlot).toMatchObject({ leftPct: 7.85, widthPct: 89.4 });
    expect(battle.artSlot.topPct + battle.artSlot.heightPct).toBeCloseTo(3.88 + 91.91, 9);
    // …its defense is the value alone in the shield the master paints…
    expect(battle.defense?.paintedRect).toBeDefined();
    expect(battle.defense).not.toHaveProperty("badgeColorHex");
    expect(battle.defense?.shadowCss).toBeUndefined();
    // …and both carry the artist credit turned down the left border.
    for (const t of PAIR) {
      const p = getFrameProfile(t);
      expect(p.footerTurn, t).toBe(90);
      expect(p.footer?.rect.leftPct, t).toBeLessThan(6);
      expect(p.footer!.rect.heightPct, t).toBeGreaterThan(p.footer!.rect.widthPct * 10);
    }
    // Split's two windows are the masters' own, one half apart.
    const split = getFrameProfile("split");
    expect((split.secondFace!.artSlot!.leftPct - split.artSlot.leftPct) * 21).toBeCloseTo(967, 9);
    expect(split.artSlot.topPct).toBe(split.secondFace!.artSlot!.topPct);
  });
});

describe("v44 — the 2003 frame's artist line in the prints' ink (TODO 4.23a)", () => {
  const png = "https://x/y.png";
  /** A v43 bake: only v44 can be pending. */
  const at = (template: string, over: Record<string, unknown> = {}) => ({
    ...UNTOUCHED_SINCE_V22,
    layout_version: 43,
    rendered_image_url: png,
    frame_style: { template, finish: "regular" },
    ...over,
  });
  const ALL = [...new Set([...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES])];
  const AT_V44 = { current: 44 } as const;
  const PAIR = ["modern", "modernland"];
  /** One identity list per frame colour key. */
  const IDENTITY: Record<string, string[]> = {
    w: ["white"],
    u: ["blue"],
    b: ["black"],
    r: ["red"],
    g: ["green"],
    c: ["colorless"],
    m: ["white", "blue"],
  };

  it("is a sweep, never a badge, scoped to the 2003 pair — frozen as a literal — with a card predicate", async () => {
    const lv = await import("@/lib/cards/layout-version");
    expect(lv.CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(44);
    expect(lv.VERSION_ROLLOUT[44]).toBe("sweep");
    expect(lv.rolloutPolicy(44)).toBe("sweep");
    expect(lv.latestSweepVersion(undefined, 44)).toBe(44);
    expect(lv.latestOptInVersion()).toBe(22);
    expect([...lv.V44_FOOTER_INK_TEMPLATES].sort()).toEqual(PAIR);
    expect(lv.VERSION_SCOPES[44]).toBeTypeOf("function");
    // Without a card to judge by: conservative on the pair, nothing elsewhere.
    for (const t of ALL) expect(isRenderStale(43, t, undefined, 44), t).toBe(PAIR.includes(t));
  });

  it("re-bakes a `modern` card on the black master and every `modernland` card; every other card is stamped", async () => {
    const { hasNewerLook, hasPendingCorrection } = await import("@/lib/cards/layout-version");
    const classifyForSweep = await sweepAt(44);
    for (const [key, color_identity] of Object.entries(IDENTITY)) {
      const modern = at("modern", { color_identity });
      expect(classifyForSweep(modern), `modern ${key}`).toBe(key === "b" ? "rebake" : "stamp");
      expect(hasPendingCorrection(modern, AT_V44), `modern ${key}`).toBe(key === "b");
      expect(isRenderStale(43, "modern", undefined, 44, modern), `modern ${key}`).toBe(key === "b");
      const land = at("modernland", { color_identity, card_type: "land" });
      expect(classifyForSweep(land), `modernland ${key}`).toBe("rebake");
      expect(hasPendingCorrection(land, AT_V44), `modernland ${key}`).toBe(true);
      // A correction: an owner never sees a badge for it.
      for (const row of [modern, land]) expect(hasNewerLook({ ...row, visibility: "public" }, AT_V44)).toBe(false);
    }
    // Production's stored 2003 cards (2026-10-07: gold ×4, the artifact `c`
    // ×2, green ×1) are stamped, never re-baked — with art or none, any finish.
    for (const over of [
      { color_identity: ["white", "blue"] },
      { color_identity: ["black", "red"] },
      { color_identity: ["colorless"], supertype: "Artifact" },
      { color_identity: [] },
      { color_identity: ["green"], art_url: null },
      { color_identity: ["green"], frame_style: { template: "modern", finish: "foil" } },
    ]) {
      expect(classifyForSweep(at("modern", over)), JSON.stringify(over)).toBe("stamp");
    }
    // A black card on any finish is in scope; a row that can't be judged is too.
    expect(classifyForSweep(at("modern", { color_identity: ["black"], frame_style: { template: "modern", finish: "etched" } }))).toBe("rebake");
    expect(classifyForSweep(at("modern", { color_identity: undefined }))).toBe("rebake");
    expect(classifyForSweep(at("modern", { color_identity: ["black"], frame_style: undefined }))).toBe("rebake");
    // Every other template is stamped, black cards included.
    for (const t of ALL.filter((t) => !PAIR.includes(t))) {
      expect(classifyForSweep(at(t, { color_identity: ["black"] })), t).toBe("stamp");
    }
    expect(classifyForSweep(at("modern", { color_identity: ["black"], layout_version: 44 }))).toBe("current");
    expect(classifyForSweep(at("modernland", { layout_version: 44 }))).toBe("current");
  });

  it("is verification-neutral: no slot moves, so the fourteen 2003 ticks stay fresh", async () => {
    const { VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    const { verificationState } = await import("@/lib/cards/frame-verification-state");
    expect(VERIFICATION_NEUTRAL_VERSIONS).toContain(44);
    expect(VERIFICATION_SCOPED_VERSIONS[44]).toEqual([]);
    for (const t of ALL) {
      const black = { frame_style: { template: t, finish: "regular" }, color_identity: ["black"] };
      expect(isRenderStale(43, t, VERIFICATION_SCOPED_VERSIONS, 44, black), t).toBe(false);
    }
    // Production's 2003 ticks: `modern`/w is a legacy tick, the rest were
    // made at v33–v43.
    for (const t of PAIR) {
      for (const verifiedLayoutVersion of [33, 41, 43]) {
        const tick = { verified: true, verifiedLayoutVersion, verifiedOverrideHash: "h" } as const;
        expect(verificationState(tick, t, "h", 44), `${t} v${verifiedLayoutVersion}`).toMatchObject({ verified: true, stale: false });
      }
      // The legacy tick itself (no stamp, no hash: judged at v33).
      const legacy = { verified: true, verifiedLayoutVersion: null, verifiedOverrideHash: null } as const;
      expect(verificationState(legacy, t, "h", 44), `${t} legacy`).toMatchObject({ verified: true, stale: false, legacy: true });
    }
    // Only the footer's ink map is new on the two profiles: every rect and
    // size is where it was (the fixture test holds the rest).
    const modern = getFrameProfile("modern");
    const land = getFrameProfile("modernland");
    expect(land.footer!.rect).toEqual(modern.footer!.rect);
    expect(land.footer!.sizePct).toBe(modern.footer!.sizePct);
    expect(Object.keys(modern.footer!.inkByColorKey ?? {})).toEqual(["b"]);
    expect(Object.keys(land.footer!.inkByColorKey ?? {}).sort()).toEqual(["b", "c", "g", "m", "r", "u", "w"]);
  });
});

// The battle's re-cut is addressed by its constant, never by its number: it
// was built as 44 beside another bump (the 2003 footer ink, which merged
// first) and took the next number, 45, by changing its constant
// (lib/cards/layout-version.ts BATTLE_RECUT_LAYOUT_VERSION).
describe("the battle re-cut onto the prints (TODO 4.21d) — its bump", () => {
  const png = "https://x/y.png";
  const ALL = [...new Set([...FRAME_TEMPLATE_VALUES, ...POST_V29_TEMPLATES])];

  it("is ONE version in one constant: a sweep, never a badge, scoped to `battle` alone — every other card stamps", async () => {
    const lv = await import("@/lib/cards/layout-version");
    const V = lv.BATTLE_RECUT_LAYOUT_VERSION;
    expect(Number.isInteger(V)).toBe(true);
    expect(V).toBeGreaterThan(43);
    expect(lv.CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(V);
    expect(lv.VERSION_ROLLOUT[V]).toBe("sweep");
    expect(lv.rolloutPolicy(V)).toBe("sweep");
    expect(lv.latestSweepVersion(undefined, V)).toBe(V);
    expect(lv.latestOptInVersion()).toBe(22);
    expect([...lv.BATTLE_RECUT_TEMPLATES]).toEqual(["battle"]);
    // Nothing but the template list scopes it: a battle with no art, no
    // text or no defense re-bakes too (its master changes).
    expect(lv.VERSION_SCOPES[V]).toBeUndefined();
    for (const t of ALL) expect(isRenderStale(V - 1, t, undefined, V), t).toBe(t === "battle");

    /** A bake stamped just before the bump: only it can be pending. */
    const at = (template: string, over: Record<string, unknown> = {}) => ({
      ...UNTOUCHED_SINCE_V22,
      layout_version: V - 1,
      rendered_image_url: png,
      frame_style: { template, finish: "regular" },
      ...over,
    });
    const classifyForSweep = await sweepAt(V);
    for (const t of ALL) {
      const row = at(t);
      expect(classifyForSweep(row), t).toBe(t === "battle" ? "rebake" : "stamp");
      expect(lv.hasPendingCorrection(row, { current: V }), t).toBe(t === "battle");
      // Never a badge: no owner is asked to accept a correction.
      expect(lv.hasNewerLook({ ...row, visibility: "public" }, { current: V }), t).toBe(false);
    }
    for (const over of [
      { art_url: null },
      { card_type: "battle", defense: "5" },
      { card_type: "battle", defense: null },
      { rules_text: null },
      { frame_style: { template: "battle", finish: "foil" } },
      { color_identity: [] },
    ]) {
      expect(classifyForSweep(at("battle", over)), JSON.stringify(over)).toBe("rebake");
    }
    expect(classifyForSweep(at("battle", { layout_version: V }))).toBe("current");
    // Split shared v43 with the battle; this bump is not its.
    expect(classifyForSweep(at("split"))).toBe("stamp");
    expect(classifyForSweep(at("saga"))).toBe("stamp");
  });

  it("is NOT verification-neutral: the masters and every slot on the right move — a battle tick made before it would be kept and flagged, every other template's stays fresh", async () => {
    const { BATTLE_RECUT_LAYOUT_VERSION: V, VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    const { verificationState } = await import("@/lib/cards/frame-verification-state");
    expect(VERIFICATION_NEUTRAL_VERSIONS).not.toContain(V);
    expect([...VERIFICATION_SCOPED_VERSIONS[V]]).toEqual(["battle"]);
    for (const t of ALL) {
      const regular = { frame_style: { template: t, finish: "regular" } };
      expect(isRenderStale(V - 1, t, VERIFICATION_SCOPED_VERSIONS, V, regular), t).toBe(t === "battle");
    }
    // Production has no battle tick (0 of 7: the first ticks waited for this
    // bump); one made at v43 would be kept and flagged.
    const tick = { verified: true, verifiedLayoutVersion: V - 1, verifiedOverrideHash: "h" } as const;
    const stale = verificationState(tick, "battle", "h", V);
    expect(stale).toMatchObject({ verified: true, stale: true });
    expect(stale.reasons).toEqual([`the renderer changed since layout v${V - 1} (now v${V})`]);
    expect(verificationState({ ...tick, verifiedLayoutVersion: V }, "battle", "h", V).stale).toBe(false);
    for (const t of ["split", "saga", "m15", "m15pw", "flip", "aftermath"]) expect(verificationState(tick, t, "h", V).stale, t).toBe(false);
    // What moved on the profile, HD px of the 2100 × 1500 card: the name 2 px
    // up and its cost's end 10 px right, the type line's rect and the
    // symbol 8 px right, the shield and its value 12 px right, the art
    // rect's top 2 px up.
    const battle = getFrameProfile("battle");
    expect(battle.title.rect.topPct * 15).toBeCloseTo(74, 9);
    expect((battle.title.rect.leftPct + battle.title.rect.widthPct) * 21).toBeCloseTo(1952.3, 9);
    expect((battle.type.rect.leftPct + battle.type.rect.widthPct) * 21).toBeCloseTo(1943, 9);
    expect((battle.symbolRect!.leftPct + battle.symbolRect!.widthPct) * 21).toBeCloseTo(1950, 9);
    // (The rules box keeps the pack's column.)
    expect((battle.rules.rect.leftPct + battle.rules.rect.widthPct) * 21).toBeCloseTo(1933, 9);
    expect(battle.defense!.paintedRect!.leftPct * 21).toBeCloseTo(1893, 9);
    expect(battle.artSlot.topPct * 15).toBeCloseTo(56.2, 9);
  });
});
