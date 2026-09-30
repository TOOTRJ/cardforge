import { describe, expect, it } from "vitest";
import {
  pickFrameReference,
  pickFrameReferenceFrom,
  type PinnedReferenceRow,
} from "@/lib/cards/frame-reference-pick";
import { FRAME_REFERENCES, frameReferenceOptions } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// Which printing stands for a (template, colour) — the ONE rule the score,
// the score batch, the stepper walk-through and the template sign-off share
// (TODO 0.18, the registry): an explicit registry pick (`?ref=`), else the
// admin-pinned printing (frame_reviews.reference_*), else the registry
// default. A `ref` the registry doesn't list for THAT combo is ignored, so
// a crafted URL can't make the tools render and score an arbitrary card.
// ---------------------------------------------------------------------------

const [DEFAULT, ALT] = frameReferenceOptions("lotr", "u");
const PIN: PinnedReferenceRow = {
  referenceScryfallId: "0b5b9131-4f7e-4912-ba47-63ed82f21d1b",
  referenceName: "Pinned Printing",
  referenceSet: "ltr",
};
const PINNED = { name: "Pinned Printing", set: "ltr", scryfallId: PIN.referenceScryfallId };

describe("pickFrameReference", () => {
  it("has two registry printings for lotr/u to pick between (fixture sanity)", () => {
    expect(DEFAULT).toBeDefined();
    expect(ALT).toBeDefined();
    expect(FRAME_REFERENCES.lotr.u).toEqual(DEFAULT);
  });

  it("an explicit registry pick beats the pinned printing", () => {
    expect(pickFrameReference({ template: "lotr", colorKey: "u", review: PIN, ref: ALT.scryfallId })).toEqual(ALT);
  });

  it("a ref the combo doesn't list falls through to the pin, then the default", () => {
    const otherColour = FRAME_REFERENCES.lotr.w!.scryfallId;
    for (const ref of [otherColour, "ffffffff-ffff-4fff-8fff-ffffffffffff", ""]) {
      expect(pickFrameReference({ template: "lotr", colorKey: "u", review: PIN, ref })).toEqual(PINNED);
      expect(pickFrameReference({ template: "lotr", colorKey: "u", review: null, ref })).toEqual(DEFAULT);
    }
  });

  it("the pinned printing beats the registry default", () => {
    expect(pickFrameReference({ template: "lotr", colorKey: "u", review: PIN })).toEqual(PINNED);
  });

  it("a pin needs its id AND its name; a missing set reads as empty", () => {
    const noName = { ...PIN, referenceName: null };
    expect(pickFrameReference({ template: "lotr", colorKey: "u", review: noName })).toEqual(DEFAULT);
    const noId = { ...PIN, referenceScryfallId: null };
    expect(pickFrameReference({ template: "lotr", colorKey: "u", review: noId })).toEqual(DEFAULT);
    const noSet = { ...PIN, referenceSet: null };
    expect(pickFrameReference({ template: "lotr", colorKey: "u", review: noSet })).toEqual({ ...PINNED, set: "" });
  });

  it("a combo with no real printing has none — unless the admin pinned one", () => {
    expect(frameReferenceOptions("lotr", "c")).toEqual([]);
    expect(pickFrameReference({ template: "lotr", colorKey: "c", review: undefined })).toBeNull();
    expect(pickFrameReference({ template: "lotr", colorKey: "c", review: PIN })).toEqual(PINNED);
  });
});

describe("pickFrameReferenceFrom", () => {
  it("reads the pin of exactly that template and colour", () => {
    const reviews = new Map<string, PinnedReferenceRow>([["lotr/w", PIN]]);
    expect(pickFrameReferenceFrom(reviews, "lotr", "w")).toEqual(PINNED);
    // Another colour's pin (or another template's) never leaks.
    expect(pickFrameReferenceFrom(reviews, "lotr", "u")).toEqual(DEFAULT);
    expect(pickFrameReferenceFrom(new Map([["lotrscroll/u", PIN]]), "lotr", "u")).toEqual(DEFAULT);
  });

  it("passes the ref through", () => {
    const reviews = new Map<string, PinnedReferenceRow>([["lotr/u", PIN]]);
    expect(pickFrameReferenceFrom(reviews, "lotr", "u", ALT.scryfallId)).toEqual(ALT);
  });
});
