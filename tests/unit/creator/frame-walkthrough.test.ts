import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SAMPLE_SEED_NAME,
  sampleWalkthroughPatch,
} from "@/lib/creator/frame-walkthrough-seed";
import { FRAME_REFERENCES, frameReferenceOptions } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// "Walk the stepper" (TODO 2.2): the create page's seed for an admin's walk.
// A combo with a reference printing is prefilled from the compare view's own
// payload (buildFrameComparePayload — the same form patch, second face
// included) pinned to the frame under test; no printing or a failed lookup
// falls back to the compare view's sample content and says so. The Scryfall
// lookup is stubbed — tests never call the live API.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  reviews: new Map<string, unknown>(),
  payload: null as unknown,
  lookups: [] as Array<{ id: string; template: string }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getFrameReviews: async () => state.reviews,
}));
vi.mock("@/lib/scryfall/reference-preview", () => ({
  buildFrameComparePayload: async (id: string, template: string) => {
    state.lookups.push({ id, template });
    return state.payload;
  },
}));

import { buildFrameWalkthrough } from "@/lib/creator/frame-walkthrough";

const PINNED = "0f0f0f0f-0000-4000-8000-000000000001";

beforeEach(() => {
  state.reviews = new Map();
  state.payload = null;
  state.lookups = [];
});

describe("sampleWalkthroughPatch", () => {
  it("is the compare view's sample content, pinned to the frame and colour", () => {
    const patch = sampleWalkthroughPatch("adventure", "g", "adventure");
    expect(patch).toMatchObject({
      title: "Sample Card",
      kind: "adventure",
      frame_template: "adventure",
      color_identity: ["green"],
      card_type: "creature",
    });
    // The storybook page is the geometry the frame exists for.
    expect(patch.back_face).toMatchObject({
      title: "Sample Adventure",
      card_type: "instant",
      subtypes_text: "Adventure",
    });
  });

  it("a land template starts as its basic; multicolour is the single-select dress", () => {
    expect(sampleWalkthroughPatch("m15land", "u", "land")).toMatchObject({
      title: "Island",
      supertype: "Basic",
      subtypes_text: "Island",
      rules_text: "",
    });
    expect(sampleWalkthroughPatch("m15", "m", "creature").color_identity).toEqual(["multicolor"]);
    expect(sampleWalkthroughPatch("m15", "c", "creature").color_identity).toEqual(["colorless"]);
  });

  it("a planeswalker sample carries loyalty and its ability lines", () => {
    const patch = sampleWalkthroughPatch("m15pw", "b", "planeswalker");
    expect(patch.card_type).toBe("planeswalker");
    expect(patch.loyalty).toBe("4");
    expect(patch.rules_text).toMatch(/^\+1:/);
  });
});

describe("buildFrameWalkthrough", () => {
  it("is null without a real template and colour", async () => {
    expect(await buildFrameWalkthrough({ template: "nope", color: "w" })).toBeNull();
    expect(await buildFrameWalkthrough({ template: "saga", color: "x" })).toBeNull();
    expect(await buildFrameWalkthrough({})).toBeNull();
  });

  it("no seed: kind, frame and colour only — no lookup", async () => {
    const walk = await buildFrameWalkthrough({ template: "battle", color: "r" });
    expect(walk).toMatchObject({ template: "battle", colorKey: "r", kind: "battle", seed: null });
    expect(state.lookups).toHaveLength(0);
  });

  it("seed=reference: the compare payload's patch, pinned to the frame under test", async () => {
    const reference = FRAME_REFERENCES.adventure.g!;
    state.payload = {
      cardName: reference.name,
      scryfallUri: "https://scryfall.com/card/x",
      patch: {
        title: reference.name,
        kind: "adventure",
        frame_template: "m15",
        color_identity: ["green"],
        back_face: { title: "Second face" },
      },
    };
    const walk = await buildFrameWalkthrough({
      template: "adventure",
      color: "g",
      kind: "creature",
      seed: "reference",
    });
    expect(state.lookups).toEqual([{ id: reference.scryfallId, template: "adventure" }]);
    expect(walk?.seed?.fromReference).toBe(true);
    expect(walk?.seed?.patch.frame_template).toBe("adventure");
    expect(walk?.seed?.patch.back_face).toEqual({ title: "Second face" });
    expect(walk?.seed?.source).toEqual({ name: reference.name, scryfallUri: "https://scryfall.com/card/x" });
    // The printing's own kind wins over the URL's.
    expect(walk?.kind).toBe("adventure");
    expect(walk?.note).toContain(reference.name);
  });

  it("an admin-pinned reference wins over the registry default; ?ref= picks a registry alternate", async () => {
    state.payload = { cardName: "Pinned", scryfallUri: null, patch: { title: "Pinned" } };
    state.reviews = new Map([
      [
        "m15/w",
        { referenceScryfallId: PINNED, referenceName: "Pinned Card", referenceSet: "tst" },
      ],
    ]);
    await buildFrameWalkthrough({ template: "m15", color: "w", seed: "reference" });
    expect(state.lookups.at(-1)?.id).toBe(PINNED);

    const alternate = frameReferenceOptions("m15", "w")[1];
    if (alternate) {
      await buildFrameWalkthrough({ template: "m15", color: "w", seed: "reference", ref: alternate.scryfallId });
      expect(state.lookups.at(-1)?.id).toBe(alternate.scryfallId);
    }
  });

  it("no real printing → sample content, and says why", async () => {
    // A combo the registry documents as having no printing.
    const noPrinting = (["split", "aftermath", "adventure", "flip", "battle"] as const)
      .flatMap((t) => (["w", "u", "b", "r", "g", "c", "m"] as const).map((k) => [t, k] as const))
      .find(([t, k]) => FRAME_REFERENCES[t][k] === null);
    expect(noPrinting, "the registry documents at least one combo with no printing").toBeTruthy();
    const [template, color] = noPrinting!;
    const walk = await buildFrameWalkthrough({ template, color, seed: "reference" });
    expect(state.lookups).toHaveLength(0);
    expect(walk?.seed?.fromReference).toBe(false);
    expect(walk?.seed?.source.name).toBe(SAMPLE_SEED_NAME);
    expect(walk?.seed?.patch.frame_template).toBe(template);
    expect(walk?.note).toMatch(/no real printing/);
  });

  it("a failed lookup falls back to the sample and says so", async () => {
    state.payload = null;
    const walk = await buildFrameWalkthrough({ template: "saga", color: "w", seed: "reference" });
    expect(state.lookups).toHaveLength(1);
    expect(walk?.seed?.fromReference).toBe(false);
    expect(walk?.note).toMatch(/lookup of .* failed/);
  });

  it("seed=sample never looks anything up", async () => {
    const walk = await buildFrameWalkthrough({ template: "saga", color: "w", seed: "sample" });
    expect(state.lookups).toHaveLength(0);
    expect(walk?.seed?.patch).toMatchObject({ frame_template: "saga", kind: "saga" });
  });
});
