import { describe, expect, it } from "vitest";
import {
  anatomyDefaults,
  applyFrameAnatomyPatch,
  frameAnatomyOf,
  importedFormAnatomy,
  newCardFrameStyle,
  normalizeAnatomy,
  partPageKeyOf,
  resolveFrameOverlays,
  storedAnatomyOf,
} from "@/lib/cards/anatomy";
import { partColorFromCost } from "@/lib/cards/part-color";
import { cardFrameSplit, frameColorKeysFor, frameSplitClipPaths, partColorSplitFor } from "@/components/cards/frame-layer";
import { AFTERMATH_PART_SEAM, PREPARE_PAGE, PREPARE_PAGE_KEYS, SPLIT_PART_SEAM, getFrameProfile } from "@/lib/cards/template-layout";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { frameAnatomyPatchFor } from "@/lib/creator/revise";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity, type FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.26 — each part in its own colour: split's and aftermath's second
// half past a seam, the Prepare spell's page as its own colour's page. An
// ADDITION (owner rule 2026-09-29): drawn only with frame_style.partColor
// === true, so a stored card — whatever its back_face.color_identity says —
// draws today's look until its owner switches it on.
// ---------------------------------------------------------------------------

const MANIFEST = (manifestJson as { files: Record<string, { width: number; height: number }> }).files;

describe("the declaration", () => {
  it("is on split, aftermath and prepare alone", () => {
    const drawing = FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).partColor);
    expect(drawing.sort()).toEqual(["aftermath", "prepare", "split"]);
    expect(getFrameProfile("split").partColorSeam).toEqual(SPLIT_PART_SEAM);
    expect(getFrameProfile("aftermath").partColorSeam).toEqual(AFTERMATH_PART_SEAM);
    expect((getFrameProfile("prepare").overlays ?? []).filter((s) => s.anatomy === "partPage")).toEqual([PREPARE_PAGE]);
  });

  it("puts the seams in the masters' black gutters, on whole px at HD and the 750 bake", () => {
    // Split: black on every row from x 1071 to 1114 of the 2100 px master.
    const splitX = (2100 * SPLIT_PART_SEAM.atPct) / 100;
    expect(splitX).toBeGreaterThan(1071 + 2);
    expect(splitX).toBeLessThan(1114 - 2);
    expect(Number.isInteger(splitX) && Number.isInteger((1050 * SPLIT_PART_SEAM.atPct) / 100)).toBe(true);
    // Aftermath: black on every column from row 1135 to 1143.
    const afterY = (2100 * AFTERMATH_PART_SEAM.atPct) / 100;
    expect(afterY).toBeCloseTo(1140, 6);
    expect(Math.round((1050 * AFTERMATH_PART_SEAM.atPct) / 100) * 2).toBe(1140);
    expect(SPLIT_PART_SEAM.axis).toBe("x");
    expect(AFTERMATH_PART_SEAM.axis).toBe("y");
  });

  it("publishes a page for every key, at its even px rect", () => {
    expect(PREPARE_PAGE.keys).toEqual(PREPARE_PAGE_KEYS);
    for (const key of PREPARE_PAGE_KEYS) {
      for (const ext of ["png", "webp"]) {
        const file = MANIFEST[`prepare/page/${key}.${ext}`];
        expect(file, `prepare/page/${key}.${ext}`).toBeDefined();
        expect([file!.width, file!.height]).toEqual([668, 562]);
      }
    }
    const { leftPct, topPct, widthPct, heightPct } = PREPARE_PAGE.rect;
    for (const [v, side] of [[(leftPct * 1500) / 100, 1500], [(topPct * 2100) / 100, 2100], [(widthPct * 1500) / 100, 1500], [(heightPct * 2100) / 100, 2100]] as const) {
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-9);
      expect(Math.round(v) % 2, String(side)).toBe(0);
    }
    // …and the two-colour Prepare's pair masters (both dresses).
    for (const pair of ["wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"]) {
      for (const key of [pair, `${pair}-h`]) expect(MANIFEST[`prepare/${key}.png`], key).toBeDefined();
    }
  });
});

describe("the switch (opt-in per card)", () => {
  it("is a new card's default where the frame draws it, dropped elsewhere", () => {
    expect(anatomyDefaults("split").partColor).toBe(true);
    expect(anatomyDefaults("aftermath").partColor).toBe(true);
    expect(anatomyDefaults("prepare").partColor).toBe(true);
    expect(anatomyDefaults("m15").partColor).toBeUndefined();
    expect(anatomyDefaults("adventure").partColor).toBeUndefined();
    expect(anatomyDefaults("flip").partColor).toBeUndefined();
    expect(normalizeAnatomy({ partColor: true }, "m15", "creature")).toEqual({});
    expect(normalizeAnatomy({ partColor: false }, "split", "instant")).toEqual({ partColor: false });
    expect(newCardFrameStyle<FrameStyle>({ template: "split" }, "instant").partColor).toBe(true);
    expect(newCardFrameStyle<FrameStyle>({ template: "split", partColor: false }, "instant").partColor).toBe(false);
    expect(newCardFrameStyle<FrameStyle>({ template: "adventure" }, "creature").partColor).toBeUndefined();
  });

  it("is kept by a remix and an import, and flipped by an edit", () => {
    expect(storedAnatomyOf({ partColor: true })).toEqual({ partColor: true });
    expect(storedAnatomyOf({ partColor: "yes" })).toEqual({});
    // (The creator switches it on for a new card on a frame that draws it.)
    expect("partColor" in importedFormAnatomy({})).toBe(false);
    const applied = applyFrameAnatomyPatch({ frameStyle: { template: "split" }, colorIdentity: ["red"], cardType: "instant" }, { partColor: true });
    expect(applied).toEqual({ ok: true, frameStyle: { template: "split", partColor: true }, colorIdentity: null });
    const dropped = applyFrameAnatomyPatch({ frameStyle: { template: "m15" }, colorIdentity: ["red"], cardType: "instant" }, { partColor: true });
    expect(dropped).toEqual({ ok: true, frameStyle: { template: "m15" }, colorIdentity: null });
  });
});

describe("the second part's colour from its cost", () => {
  it.each([
    ["{1}{U}", ["blue"]],
    ["{X}{B}{B}", ["black"]],
    ["{1}{W/B}", ["white", "black"]],
    ["{G/W}", ["green", "white"]],
    ["{2}{R/G}", ["red", "green"]],
    ["{1}{W}{B}", ["white", "black"]],
    ["{3}{U}{R}", ["blue", "red"]],
    ["{W}{U}{B}", ["multicolor"]],
    ["{2/W}", ["white"]],
    ["{3}", []],
    ["", []],
    [null, []],
  ] as const)("%s → %j", (cost, colours) => {
    expect(partColorFromCost(cost)).toEqual(colours);
  });
});

describe("the Prepare page", () => {
  const profile = getFrameProfile("prepare");
  const page = (colors: ColorIdentity[], style: Record<string, unknown>, part: { colors: ColorIdentity[]; cost?: string } | null, cost = "{2}{R}") =>
    resolveFrameOverlays(profile, style, {
      colors,
      cost,
      cardType: "creature",
      supertype: null,
      colorKey: colors.length === 1 ? ({ red: "r", white: "w", blue: "u" } as Record<string, string>)[colors[0]!]! : "m",
      part,
    }).filter((o) => o.anatomy === "partPage");

  it.each([
    [["blue"], "{1}{U}", "u"],
    [["green", "white"], "{G/W}", "gw-h"],
    [["white", "black"], "{1}{W}{B}", "wb"],
    [["white", "black"], "{1}{W/B}", "wb-h"],
    [["multicolor"], "{W}{U}{B}", "m"],
    [["colorless"], "{3}", "c"],
  ] as const)("a %j spell (%s) → page %s", (colors, cost, key) => {
    expect(partPageKeyOf({ colors: [...colors], cost })).toBe(key);
  });

  it("is drawn with the switch on, over a creature of another colour, and only then", () => {
    const on = page(["red"], { template: "prepare", partColor: true }, { colors: ["blue"], cost: "{1}{U}" });
    expect(on).toEqual([{ anatomy: "partPage", rect: PREPARE_PAGE.rect, key: "u", path: "/frames/prepare/page/u.png" }]);
    // Off, absent — a card stored before 4.26 — or no colour of its own: none.
    expect(page(["red"], { template: "prepare", partColor: false }, { colors: ["blue"] })).toEqual([]);
    expect(page(["red"], { template: "prepare" }, { colors: ["blue"] })).toEqual([]);
    expect(page(["red"], { template: "prepare", partColor: true }, { colors: [] })).toEqual([]);
    expect(page(["red"], { template: "prepare", partColor: true }, null)).toEqual([]);
    // The spell's colour IS the creature's: the master already paints it.
    expect(page(["red"], { template: "prepare", partColor: true }, { colors: ["red"], cost: "{R}" })).toEqual([]);
  });

  it("over the two-colour Prepare: none where the pair master's own page is the spell's", () => {
    const style = { template: "prepare", partColor: true, twoColor: true };
    // A gold W/U creature, a gold W/U spell: the pair master's own page.
    expect(page(["white", "blue"], style, { colors: ["white", "blue"], cost: "{1}{W}{U}" }, "{1}{W}{U}")).toEqual([]);
    // …a hybrid W/U spell (SOS #170's shape): the grey page over it.
    expect(page(["white", "blue"], style, { colors: ["white", "blue"], cost: "{1}{W/U}" }, "{1}{W}{U}").map((o) => o.key)).toEqual(["wu-h"]);
    // A hybrid creature (its -h master) with a hybrid spell: its own page.
    expect(page(["white", "blue"], style, { colors: ["white", "blue"], cost: "{W/U}" }, "{1}{W/U}{W/U}")).toEqual([]);
    // A red spell on the gold creature (YFRA #27).
    expect(page(["white", "blue"], style, { colors: ["red"], cost: "{X}{R}" }, "{1}{W}{U}").map((o) => o.key)).toEqual(["r"]);
  });
});

describe("the split and aftermath seams", () => {
  const split = getFrameProfile("split");
  const aftermath = getFrameProfile("aftermath");
  const type = { cardType: "instant", supertype: null, cost: "{1}{R}" };

  it("draws the second half's master past the seam with the switch on", () => {
    expect(partColorSplitFor(split, ["red"], type, { partColor: true }, { colors: ["blue"], cost: "{1}{U}", cardType: "instant" })).toEqual({
      leftKey: "r",
      rightKey: "u",
      atPct: 52,
    });
    expect(partColorSplitFor(aftermath, ["red"], type, { partColor: true }, { colors: ["black"], cost: "{X}{B}{B}" })).toEqual({
      leftKey: "r",
      rightKey: "b",
      atPct: (1140 / 2100) * 100,
      axis: "y",
    });
    // A gold second half paints the gold master.
    expect(partColorSplitFor(split, ["white"], type, { partColor: true }, { colors: ["blue", "black"] })?.rightKey).toBe("m");
  });

  it("draws nothing off, absent, without a colour of its own, or in the card's own colour", () => {
    for (const style of [{ partColor: false }, {}, null]) {
      expect(partColorSplitFor(split, ["red"], type, style, { colors: ["blue"] })).toBeNull();
    }
    expect(partColorSplitFor(split, ["red"], type, { partColor: true }, { colors: [] })).toBeNull();
    expect(partColorSplitFor(split, ["red"], type, { partColor: true }, null)).toBeNull();
    expect(partColorSplitFor(split, ["red"], type, { partColor: true }, { colors: ["red"] })).toBeNull();
    // A frame with no seam (m15, the adventure) never splits.
    expect(partColorSplitFor(getFrameProfile("adventure"), ["red"], type, { partColor: true }, { colors: ["blue"] })).toBeNull();
  });

  it("preloads both masters and clips a horizontal seam on its own axis", () => {
    expect(frameColorKeysFor(split, ["red"], type, { partColor: true }, { colors: ["blue"] })).toEqual(["r", "u"]);
    expect(frameColorKeysFor(split, ["red"], type, {}, { colors: ["blue"] })).toEqual(["r"]);
    const y = cardFrameSplit(aftermath, ["red"], type, { partColor: true }, { colors: ["black"] })!;
    expect(frameSplitClipPaths(y)).toEqual({
      left: `inset(0 0 calc(${100 - y.atPct}% - 1px) 0)`,
      right: `inset(${y.atPct}% 0 0 0)`,
    });
    // The vertical clip is the Dragon Wing split's, unchanged.
    const x = cardFrameSplit(split, ["red"], type, { partColor: true }, { colors: ["blue"] })!;
    expect(frameSplitClipPaths(x)).toEqual({ left: "inset(0 calc(48% - 1px) 0 0)", right: "inset(0 0 0 52%)" });
  });
});

describe("an edit's switch flip (frameAnatomyPatchFor)", () => {
  it("sends partColor only when the form's differs from the stored card's", () => {
    const stored = { frame_style: { template: "split", finish: "regular" }, color_identity: ["red"] as ColorIdentity[] };
    const values = (partColor?: boolean) =>
      ({
        frame_style: { template: "split", finish: "regular", ...(partColor === undefined ? {} : { partColor }) },
        color_identity: ["red"] as ColorIdentity[],
      }) as Parameters<typeof frameAnatomyPatchFor>[1];
    // A stored card opened and saved untouched: nothing about the switch.
    expect(frameAnatomyPatchFor(stored, values())).toBeUndefined();
    expect(frameAnatomyPatchFor(stored, values(true))).toEqual({ partColor: true });
    expect(frameAnatomyPatchFor({ ...stored, frame_style: { ...stored.frame_style, partColor: true } }, values(false))).toEqual({ partColor: false });
  });
});
