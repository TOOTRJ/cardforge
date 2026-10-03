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

  it("a reference whose kind the frame can't dress walks the frame's own kind with sample content (TODO 4.5a)", async () => {
    // tarkirghostfire/c's only reference is Ugin #409, a planeswalker.
    const reference = FRAME_REFERENCES.tarkirghostfire.c!;
    expect(reference.name).toMatch(/^Ugin/);
    state.payload = {
      cardName: reference.name,
      scryfallUri: "https://scryfall.com/card/x",
      patch: { title: reference.name, kind: "planeswalker", frame_template: "m15pw", card_type: "planeswalker" },
    };
    const walk = await buildFrameWalkthrough({
      template: "tarkirghostfire",
      color: "c",
      kind: "planeswalker",
      seed: "reference",
    });
    expect(walk?.kind).toBe("creature");
    expect(walk?.seed?.fromReference).toBe(false);
    expect(walk?.seed?.patch).toMatchObject({ kind: "creature", frame_template: "tarkirghostfire" });
    expect(walk?.note).toMatch(/Ugin, Eye of the Storms is a planeswalker, which this frame doesn't dress/);
  });

  it("a reference the save accepts still walks from the reference, even off its kind's gallery (the snow artifact on m15snow)", async () => {
    // m15snow is a skin of the M15 standard, so the Artifact gallery doesn't
    // list it, but the kind gate doesn't refuse it: Replicating Ring KHM
    // #244 walks as the artifact it is (only a refused kind falls back).
    const reference = FRAME_REFERENCES.m15snow.c!;
    expect(reference.name).toBe("Replicating Ring");
    state.payload = {
      cardName: reference.name,
      scryfallUri: "https://scryfall.com/card/x",
      patch: { title: reference.name, kind: "artifact", frame_template: "m15snow", card_type: "artifact" },
    };
    const walk = await buildFrameWalkthrough({ template: "m15snow", color: "c", seed: "reference" });
    expect(walk?.seed?.fromReference).toBe(true);
    expect(walk?.kind).toBe("artifact");
    expect(walk?.seed?.patch).toMatchObject({ kind: "artifact", frame_template: "m15snow" });
  });

  it("names a refused kind with the right article", async () => {
    // A land on the Nyx frame (enchantment and creature only) — made up, to
    // reach a vowel-initial kind label.
    state.payload = {
      cardName: "Made-up Artifact",
      scryfallUri: null,
      patch: { title: "Made-up Artifact", kind: "artifact", frame_template: "nyx", card_type: "artifact" },
    };
    const walk = await buildFrameWalkthrough({ template: "nyx", color: "w", seed: "reference" });
    expect(walk?.seed?.fromReference).toBe(false);
    expect(walk?.note).toMatch(/Made-up Artifact is an artifact, which this frame doesn't dress/);
  });

  it("seed=sample never looks anything up", async () => {
    const walk = await buildFrameWalkthrough({ template: "saga", color: "w", seed: "sample" });
    expect(state.lookups).toHaveLength(0);
    expect(walk?.seed?.patch).toMatchObject({ frame_template: "saga", kind: "saga" });
  });
});

describe("the face the walk opens on (TODO 5.0b) — no template is a back body today", () => {
  it("the front by default: the card is pinned to the template itself", async () => {
    for (const params of [{}, { face: "front" }, { face: "nonsense" }]) {
      const walk = await buildFrameWalkthrough({ template: "m15", color: "w", ...params });
      expect(walk).toMatchObject({ previewFace: "front", cardTemplate: "m15", template: "m15" });
      expect(walk?.note).not.toMatch(/back face/);
    }
  });

  it("?face=back opens the preview on the back when the reference has a second face, and says so", async () => {
    const reference = FRAME_REFERENCES.m15.w!;
    state.payload = {
      cardName: "Archangel Avacyn // Avacyn, the Purifier",
      scryfallUri: null,
      patch: {
        title: "Archangel Avacyn",
        kind: "creature",
        frame_template: "m15",
        color_identity: ["white"],
        back_face: { title: "Avacyn, the Purifier", card_type: "creature" },
      },
    };
    const walk = await buildFrameWalkthrough({ template: "m15", color: "w", seed: "reference", face: "back" });
    // The front payload is the seed either way (the patch carries both faces).
    expect(state.lookups).toEqual([{ id: reference.scryfallId, template: "m15" }]);
    expect(walk).toMatchObject({ previewFace: "back", cardTemplate: "m15" });
    expect(walk?.seed?.patch.back_face).toEqual({ title: "Avacyn, the Purifier", card_type: "creature" });
    expect(walk?.note).toMatch(/The preview opens on the back face\.$/);
    // The array form Next hands over for a repeated parameter.
    const repeated = await buildFrameWalkthrough({ template: "m15", color: "w", seed: "reference", face: ["back"] });
    expect(repeated?.previewFace).toBe("back");
  });

  it("?face=back on a printing with no second face opens on the front and says why", async () => {
    state.payload = {
      cardName: "Serra Angel",
      scryfallUri: null,
      patch: { title: "Serra Angel", kind: "creature", frame_template: "m15", color_identity: ["white"] },
    };
    const walk = await buildFrameWalkthrough({ template: "m15", color: "w", seed: "reference", face: "back" });
    expect(walk?.previewFace).toBe("front");
    expect(walk?.seed?.fromReference).toBe(true);
    expect(walk?.note).toMatch(/has no second face, so the preview opens on the front\.$/);
  });

  it("a blank or sample walk keeps the face asked for (the preview has nothing to flip to, and draws the front)", async () => {
    const blank = await buildFrameWalkthrough({ template: "m15", color: "w", face: "back" });
    expect(blank).toMatchObject({ seed: null, previewFace: "back" });
    expect(blank?.note).toMatch(/blank card\. The preview opens on the back face\.$/);
    const sample = await buildFrameWalkthrough({ template: "m15", color: "w", seed: "sample", face: "back" });
    expect(sample).toMatchObject({ previewFace: "back", cardTemplate: "m15" });
    expect(sample?.seed?.fromReference).toBe(false);
  });
});
