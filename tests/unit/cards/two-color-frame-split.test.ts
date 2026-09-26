import { describe, expect, it } from "vitest";
import {
  frameColorKeysFor,
  frameSplitFor,
  twoColorFrameKeys,
} from "@/components/cards/frame-layer";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { parseFrameProfileOverride } from "@/lib/cards/profile-override";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// Two-colour Dragon Wing (owner decision 2026-09-25): a two-colour card draws
// the first colour's frame left of the seam and the second's right of it, in
// the printed guild order the cost pips use (MUL #60 Taigam, W/U: white wings
// left, blue right). Everything else keeps pickFrameColorKey's one key.
// ---------------------------------------------------------------------------

const NAME: Record<string, ColorIdentity> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};
const PAIRS = ["WU", "WB", "UB", "UR", "BR", "BG", "RG", "RW", "GW", "GU"] as const;

describe("twoColorFrameKeys", () => {
  it.each(PAIRS)("%s — printed order, whichever order the identity was stored in", (pair) => {
    const expected = [pair[0].toLowerCase(), pair[1].toLowerCase()];
    expect(twoColorFrameKeys([NAME[pair[0]], NAME[pair[1]]])).toEqual(expected);
    expect(twoColorFrameKeys([NAME[pair[1]], NAME[pair[0]]])).toEqual(expected);
  });

  it("covers every two-colour combination exactly once", () => {
    const seen = new Set(PAIRS.map((p) => [...p].sort().join("")));
    expect(seen.size).toBe(10);
  });

  it.each<[string, ColorIdentity[] | null | undefined]>([
    ["undefined", undefined],
    ["null", null],
    ["colourless (empty)", []],
    ["colourless", ["colorless"]],
    ["mono", ["white"]],
    ["the multicolor dress", ["multicolor"]],
    ["three colours", ["white", "blue", "black"]],
    ["five colours", ["white", "blue", "black", "red", "green"]],
    ["a colour + colourless", ["white", "colorless"]],
    ["a colour + multicolor", ["white", "multicolor"]],
    ["a duplicated colour", ["white", "white"]],
  ])("null for %s", (_label, colors) => {
    expect(twoColorFrameKeys(colors)).toBeNull();
  });
});

describe("frameSplitFor / frameColorKeysFor", () => {
  const dragon = getFrameProfile("tarkirdragon");

  it("splits Dragon Wing at 50 % — Bar (black + white) draws white left, black right", () => {
    expect(frameSplitFor(dragon, ["black", "white"])).toEqual({ leftKey: "w", rightKey: "b", atPct: 50 });
    expect(frameColorKeysFor(dragon, ["black", "white"], null)).toEqual(["w", "b"]);
  });

  it("keeps one key for everything that is not exactly two colours", () => {
    expect(frameSplitFor(dragon, ["white"])).toBeNull();
    expect(frameSplitFor(dragon, ["multicolor"])).toBeNull();
    expect(frameSplitFor(dragon, ["white", "blue", "black"])).toBeNull();
    expect(frameColorKeysFor(dragon, ["white", "blue", "black"], null)).toEqual(["m"]);
    expect(frameColorKeysFor(dragon, ["multicolor"], null)).toEqual(["m"]);
    expect(frameColorKeysFor(dragon, [], null)).toEqual(["c"]);
    expect(frameColorKeysFor(dragon, ["black"], null)).toEqual(["b"]);
  });

  it("never splits a profile without twoColorSplit", () => {
    const m15 = getFrameProfile("m15");
    expect(frameSplitFor(m15, ["black", "white"])).toBeNull();
    expect(frameColorKeysFor(m15, ["black", "white"], null)).toEqual(["m"]);
  });

  it("is set on Dragon Wing only", () => {
    const splitting = FRAME_TEMPLATE_VALUES.filter((t) => getFrameProfile(t).twoColorSplit);
    expect(splitting).toEqual(["tarkirdragon"]);
  });

  it("is code-owned: a stored override cannot set it", () => {
    expect(parseFrameProfileOverride({ twoColorSplit: { atPct: 30 } })).toBeNull();
  });
});
