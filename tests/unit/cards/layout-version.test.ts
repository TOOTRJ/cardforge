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
    const card = UNTOUCHED_SINCE_V22;
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
    const card = { ...UNTOUCHED_SINCE_V22, rendered_image_url: "https://x/y.png" };
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
    const card = { ...UNTOUCHED_SINCE_V22, rendered_image_url: "https://x/y.png" };
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
    expect(hasPendingCorrection(at("lotr"))).toBe(false);
    // A v21 card v29 left alone keeps its v22 opt-in badge; one v29 changed
    // gets the sweep's re-bake (opt-in look included) instead.
    expect(hasNewerLook({ ...at("lotr"), layout_version: 21, visibility: "public" })).toBe(true);
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
    expect(CARD_LAYOUT_VERSION).toBe(30);
    expect(rolloutPolicy(30)).toBe("sweep");
    expect(latestOptInVersion()).toBe(22);
    expect(classifyForSweep(at("fullartland"))).toBe("rebake");
    expect(classifyForSweep(at("fullartland", { frame_style: { template: "fullartland", finish: "foil" } }))).toBe(
      "rebake",
    );
    expect(hasNewerLook({ ...at("fullartland"), visibility: "public" })).toBe(false);
    expect(hasPendingCorrection(at("fullartland"))).toBe(true);
    // Every other template — including the full-art frames that share its
    // profile family and the default m15 a {} frame_style draws — keeps its
    // v29 bake: the sweep stamps it without a render.
    for (const t of FRAME_TEMPLATE_VALUES.filter((v) => v !== "fullartland")) {
      expect(isRenderStale(29, t), t).toBe(false);
      expect(classifyForSweep(at(t)), t).toBe("stamp");
    }
    expect(classifyForSweep({ ...at("m15"), frame_style: {} })).toBe("stamp");
  });
});
