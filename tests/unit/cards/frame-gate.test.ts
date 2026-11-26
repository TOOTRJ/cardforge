import { describe, expect, it } from "vitest";
import {
  ARTIFACT_MASTER_UNVERIFIED,
  artifactMasterReviewKey,
  frameGateError,
  isFrameComboAvailable,
  verifiedKeysForType,
} from "@/lib/cards/frame-availability";
import { FRAME_COLOR_KEYS, frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// The server-side twin of the picker's gate: createCardAction /
// updateCardAction refuse an unpublished (template, colour) pair so a stale
// client or a crafted payload can't save what the admin hasn't published.

const published = new Set([
  frameComboKey("m15", "w"),
  frameComboKey("m15", "m"),
  frameComboKey("m15", "c"),
  frameComboKey("saga", "u"),
]);

describe("frameGateError", () => {
  it("passes a published pair", () => {
    expect(frameGateError("m15", ["white"], published)).toBeNull();
    expect(frameGateError("saga", ["blue"], published)).toBeNull();
  });

  it("refuses an unpublished colour of a published frame, naming the colour", () => {
    const error = frameGateError("m15", ["blue"], published);
    expect(error).toMatch(/isn't available in blue yet/);
  });

  it("refuses an unpublished frame outright", () => {
    expect(frameGateError("battle", ["white"], published)).not.toBeNull();
  });

  it("maps identities like the renderer: none → colorless, two or more → multicolor", () => {
    expect(frameGateError("m15", [], published)).toBeNull();
    expect(frameGateError("m15", null, published)).toBeNull();
    expect(frameGateError("m15", ["white", "blue"], published)).toBeNull();
    expect(frameGateError("m15", ["white", "blue", "black"], published)).toBeNull();
  });

  it("treats a missing or legacy template as the default frame", () => {
    expect(frameGateError(undefined, ["white"], published)).toBeNull();
    expect(frameGateError("regular", ["white"], published)).toBeNull();
    expect(frameGateError("regular", ["green"], published)).toMatch(/green/);
  });
});

// TODO 5.9: Innistrad: Double Feature prints EVERY artifact on its one
// artifact frame, whatever the colour (FrameProfile.artifactMasterKeys maps
// every key to `a`). Its w…m references are non-artifacts, so their ticks
// never looked at `a`; the `c` tick did (DBL #252 The Celestus). An artifact
// in a colour there needs that colour AND `c` — the one rule every caller
// reads (artifactMasterReviewKey; verifiedKeysForType for a held set).
describe("an artifact on a frame that dresses its colour as the artifact master", () => {
  const whiteOnly = new Set([
    frameComboKey("doublefeature", "w"),
    frameComboKey("m15artifact", "w"),
    frameComboKey("agclassic", "c"),
  ]);
  const withC = new Set([...whiteOnly, frameComboKey("doublefeature", "c")]);
  const artifact = { cardType: "artifact" };
  const artifactCreature = { cardType: "creature", supertype: "Artifact" };
  const creature = { cardType: "creature", supertype: "Legendary" };

  it("needs its colour and `c`, in words that say why", () => {
    expect(frameGateError("doublefeature", ["white"], whiteOnly, artifact)).toBe(ARTIFACT_MASTER_UNVERIFIED);
    expect(frameGateError("doublefeature", ["white"], whiteOnly, artifactCreature)).toBe(ARTIFACT_MASTER_UNVERIFIED);
    expect(frameGateError("doublefeature", ["white"], withC, artifact)).toBeNull();
    // `c` alone is never a white card's.
    expect(frameGateError("doublefeature", ["white"], new Set([frameComboKey("doublefeature", "c")]), artifact)).toMatch(
      /isn't available in white yet/,
    );
  });

  it("asks nothing more of a non-artifact, a colourless artifact, another frame, or a caller with no type", () => {
    expect(frameGateError("doublefeature", ["white"], whiteOnly, creature)).toBeNull();
    expect(frameGateError("doublefeature", ["white"], whiteOnly)).toBeNull();
    expect(frameGateError("doublefeature", ["colorless"], new Set([frameComboKey("doublefeature", "c")]), artifact)).toBeNull();
    expect(frameGateError("m15artifact", ["white"], whiteOnly, artifact)).toBeNull();
    // Alpha dresses `c` alone: its colourless artifact is its own review.
    expect(frameGateError("agclassic", ["colorless"], whiteOnly, artifact)).toBeNull();
    expect(artifactMasterReviewKey("doublefeature", "w", artifact)).toBe("c");
    expect(artifactMasterReviewKey("doublefeature", "m", artifactCreature)).toBe("c");
    expect(artifactMasterReviewKey("doublefeature", "c", artifact)).toBeNull();
    expect(artifactMasterReviewKey("agclassic", "c", artifact)).toBeNull();
    expect(artifactMasterReviewKey("doublefeature", "w", creature)).toBeNull();
    expect(artifactMasterReviewKey("doublefeatureland", "w", artifact)).toBeNull();
    expect(isFrameComboAvailable("doublefeature", "w", whiteOnly, artifact)).toBe(false);
    expect(isFrameComboAvailable("doublefeature", "w", withC, artifact)).toBe(true);
  });

  it("verifiedKeysForType reads the set as the artifact sees it — and hands back the same set otherwise", () => {
    const seen = verifiedKeysForType(whiteOnly, artifact);
    expect(seen.has(frameComboKey("doublefeature", "w"))).toBe(false);
    expect(seen.has(frameComboKey("m15artifact", "w"))).toBe(true);
    expect(seen.has(frameComboKey("agclassic", "c"))).toBe(true);
    expect(verifiedKeysForType(withC, artifact)).toBe(withC);
    expect(verifiedKeysForType(whiteOnly, creature)).toBe(whiteOnly);
    expect(verifiedKeysForType(whiteOnly, null)).toBe(whiteOnly);
    // Only the Double Feature spell frame dresses a coloured key by type:
    // every other frame's ticks read as they always did.
    const everyOther = new Set(
      FRAME_TEMPLATE_VALUES.filter((t) => t !== "doublefeature").flatMap((t) =>
        FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k)),
      ),
    );
    expect(verifiedKeysForType(everyOther, artifact)).toBe(everyOther);
  });
});
