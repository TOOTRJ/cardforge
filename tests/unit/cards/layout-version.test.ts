import { describe, expect, it } from "vitest";
import {
  CARD_LAYOUT_VERSION,
  isRenderStale,
  templateOfFrameStyle,
} from "@/lib/cards/layout-version";
import { getFrameProfile } from "@/lib/cards/template-layout";
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
      "agclassic", "alphaland", "alphatoken", "retro", "retroland", "modern", "modernland", "extendedart",
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
    for (const t of ["alphatoken", "m15", "modern", "retro", "saga", "tarkirdraconic", "bloomanime"]) {
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
const POST_V29_TEMPLATES: readonly string[] = ["m15borderless", "m15borderlessartifact", "m15fullartland"];

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

  it("word spacing: every card on the 25 display-footer templates", async () => {
    const classifyForSweep = await sweepAt(29);
    const displayFooter = FRAME_TEMPLATE_VALUES.filter(
      (t) => getFrameProfile(t).footer?.font === "display" && !POST_V29_TEMPLATES.includes(t),
    );
    // The frozen v29 list is these 25 (their footer prints "ART: …").
    expect(displayFooter).toHaveLength(25);
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
      (t) => getFrameProfile(t).footer?.font !== "display" && !POST_V29_TEMPLATES.includes(t),
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
    for (const t of ["m15pw", "m15token", "m15tokenartifact", "alphatoken", "expeditionland"]) {
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

  it("freezes its scope as a literal: the M15 family as it stood at v32, split and battle left out", async () => {
    const { V32_M15_FAMILY_TEMPLATES } = await import("@/lib/cards/layout-version");
    const { M15_FAMILY_TEMPLATES } = await import("@/lib/cards/m15-family");
    // The family changed? Don't edit the frozen v32 list: ship the change in
    // its own bump, and record it here (the family = v32's list ± it).
    expect([...V32_M15_FAMILY_TEMPLATES].sort()).toEqual([...M15_FAMILY_TEMPLATES].sort());
    expect(new Set(V32_M15_FAMILY_TEMPLATES).size).toBe(V32_M15_FAMILY_TEMPLATES.length);
    expect(V32_M15_FAMILY_TEMPLATES).toHaveLength(23);
    for (const t of V32_M15_FAMILY_TEMPLATES) expect(FRAME_TEMPLATE_VALUES, t).toContain(t);
    // Their slots sit off the MSE masters' bars: their sizes ship with 4.21.
    expect(V32_M15_FAMILY_TEMPLATES).not.toContain("split");
    expect(V32_M15_FAMILY_TEMPLATES).not.toContain("battle");
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
    // its own bump: record it here, never in the frozen lists.
    expect([...V33_SCOPE_TEMPLATES.textless].sort()).toEqual(all.filter((t) => getFrameProfile(t).textless).sort());
    expect([...V33_SCOPE_TEMPLATES.chapters].sort()).toEqual(all.filter((t) => getFrameProfile(t).chapters).sort());
  });

  it("is verification-neutral: a v32 / v31 / v30 frame_reviews tick stays fresh on every template", async () => {
    const { VERIFICATION_NEUTRAL_VERSIONS, VERIFICATION_SCOPED_VERSIONS } = await import("@/lib/cards/layout-version");
    expect(VERIFICATION_NEUTRAL_VERSIONS).toEqual([31, 32, 33]);
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
    expect(CARD_LAYOUT_VERSION).toBe(34);
    expect(rolloutPolicy(34)).toBe("sweep");
    expect(latestSweepVersion()).toBe(34);
    expect(latestOptInVersion()).toBe(22);
    expect(VERSION_SCOPES[34]).toBeTypeOf("function");
    expect(V34_TOKEN_FRAME_TEMPLATES).toEqual(["m15token", "m15tokenartifact"]);
    // The two frames 4.49 re-measured: the type band from 8.54 %W, the set
    // symbol in its own box, the P/T on an M15 plate.
    for (const t of V34_TOKEN_FRAME_TEMPLATES) {
      const profile = getFrameProfile(t);
      expect(profile.type.rect.leftPct, t).toBe(8.54);
      expect(profile.symbolRect, t).toEqual({ topPct: 82.73, leftPct: 80.13, widthPct: 12, heightPct: 4.1 });
      expect(profile.pt?.plateAssetPathTemplate, t).toMatch(/^\/frames\/m15(artifact)?\/pt\/\{color\}\.png$/);
    }
    // alphatoken is not one of them: only its tokens' wording changes.
    expect(getFrameProfile("alphatoken").symbolRect).toBeUndefined();
  });

  it("re-bakes EVERY card on the two token frames, and no non-token card on any other template", async () => {
    const { V34_TOKEN_FRAME_TEMPLATES, classifyForSweep, hasNewerLook, hasPendingCorrection } = await import("@/lib/cards/layout-version");
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

  it("re-bakes a token whose printed line changes on ANY template (alphatoken, a showcase, flip's Roles)", async () => {
    const { classifyForSweep } = await import("@/lib/cards/layout-version");
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
