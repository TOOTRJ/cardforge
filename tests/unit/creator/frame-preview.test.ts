import { describe, expect, it } from "vitest";
import {
  firstColourToWalk,
  isFramePreviewSave,
  parsePreviewFramesParam,
  parseWalkthroughSeed,
  resolveFramePreviewMode,
  walkthroughHref,
  walkthroughKind,
  walkthroughKindFor,
  withPreviewFramesParam,
  withoutPreviewParams,
} from "@/lib/creator/frame-preview";
import { templateSupportsKind } from "@/lib/creator/card-kinds";
import { isDfcBackBody } from "@/lib/cards/dfc";
import { FRAME_COLOR_KEYS, frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// Admin frame preview (TODO 2.1/2.2): the URL contract, the admin-only union
// with the verified set, which saves are previews, and the walk-through's
// kind + link. Pure rules; the pages and the form lean on them.
// ---------------------------------------------------------------------------

const ALL = FRAME_TEMPLATE_VALUES.length * FRAME_COLOR_KEYS.length;

describe("parsePreviewFramesParam", () => {
  it("'all' names every template in every colour", () => {
    const parsed = parsePreviewFramesParam("all");
    expect(parsed?.param).toBe("all");
    expect(parsed?.keys).toHaveLength(ALL);
    expect(new Set(parsed?.keys).size).toBe(ALL);
    // 'all' anywhere in a list wins.
    expect(parsePreviewFramesParam("battle,ALL")?.param).toBe("all");
  });

  it("a template means all seven colours; template/colour means one", () => {
    const parsed = parsePreviewFramesParam("battle, saga/w");
    expect(parsed?.param).toBe("battle,saga/w");
    expect(parsed?.keys.sort()).toEqual(
      [...FRAME_COLOR_KEYS.map((k) => frameComboKey("battle", k)), "saga/w"].sort(),
    );
  });

  it("drops unknown templates, colours and malformed tokens; nothing valid → null", () => {
    expect(parsePreviewFramesParam("nope,saga/x,saga/w/extra")).toBeNull();
    expect(parsePreviewFramesParam("nope,m15/u")?.keys).toEqual(["m15/u"]);
    expect(parsePreviewFramesParam("")).toBeNull();
    expect(parsePreviewFramesParam(undefined)).toBeNull();
    expect(parsePreviewFramesParam(null)).toBeNull();
  });

  it("reads Next's array form for a repeated parameter and dedupes", () => {
    const parsed = parsePreviewFramesParam(["saga/w", "saga/w", "battle/u"]);
    expect(parsed?.keys.sort()).toEqual(["battle/u", "saga/w"]);
    expect(parsed?.param).toBe("saga/w,battle/u");
  });
});

describe("resolveFramePreviewMode — admins only, decided by the caller's profile", () => {
  const verified = ["m15/w", "saga/w"];

  it("is null for a non-admin whatever the URL says", () => {
    expect(resolveFramePreviewMode({ isAdmin: false, param: "all", verifiedKeys: verified })).toBeNull();
  });

  it("is null for an admin without a valid parameter", () => {
    expect(resolveFramePreviewMode({ isAdmin: true, param: undefined, verifiedKeys: verified })).toBeNull();
    expect(resolveFramePreviewMode({ isAdmin: true, param: "nope", verifiedKeys: verified })).toBeNull();
  });

  it("unions the previewed combos with the verified set and keeps the verified set apart", () => {
    const mode = resolveFramePreviewMode({ isAdmin: true, param: "saga", verifiedKeys: verified });
    expect(mode?.publishedKeys).toEqual(verified);
    expect(mode?.unverifiedKeys).toHaveLength(FRAME_COLOR_KEYS.length - 1);
    expect(mode?.unverifiedKeys).not.toContain("saga/w");
    expect(new Set(mode?.pickableKeys)).toEqual(
      new Set([...verified, ...FRAME_COLOR_KEYS.map((k) => `saga/${k}`)]),
    );
  });
});

describe("isFramePreviewSave", () => {
  const mode = { publishedKeys: ["m15/w"] };

  it("never outside preview mode", () => {
    expect(
      isFramePreviewSave({ mode: null, walkthrough: true, template: "battle", colorIdentity: ["white"] }),
    ).toBe(false);
  });

  it("a verified combo saves normally; an unverified one is a preview", () => {
    expect(
      isFramePreviewSave({ mode, walkthrough: false, template: "m15", colorIdentity: ["white"] }),
    ).toBe(false);
    expect(
      isFramePreviewSave({ mode, walkthrough: false, template: "m15", colorIdentity: ["blue"] }),
    ).toBe(true);
    // Identities map like the gate: two colours → multicolor.
    expect(
      isFramePreviewSave({ mode, walkthrough: false, template: "m15", colorIdentity: ["white", "blue"] }),
    ).toBe(true);
  });

  it("every save during a walk-through is a preview (a test card)", () => {
    expect(
      isFramePreviewSave({ mode, walkthrough: true, template: "m15", colorIdentity: ["white"] }),
    ).toBe(true);
  });
});

describe("walkthroughKindFor", () => {
  it.each([
    ["m15", "creature"],
    ["m15artifact", "artifact"],
    ["m15land", "land"],
    ["m15snowland", "land"],
    ["m15pw", "planeswalker"],
    ["m15token", "token"],
    ["battle", "battle"],
    ["saga", "saga"],
    ["adventure", "adventure"],
    ["split", "split"],
    ["aftermath", "aftermath"],
    ["flip", "flip"],
    ["retroland", "land"],
    ["nyx", "enchantment"],
    ["expeditionland", "land"],
    ["fullartland", "land"],
  ] as const)("%s → %s", (template, kind) => {
    expect(walkthroughKindFor(template)).toBe(kind);
  });

  it("every template's walk starts on a kind that can wear it — a double-faced BACK body's on the kind whose cards it dresses the back of (TODO 5.1a)", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const kind = walkthroughKindFor(template);
      if (isDfcBackBody(template)) {
        expect(kind, template).toBe("transform");
        expect(templateSupportsKind(template, kind), template).toBe(false);
        continue;
      }
      expect(templateSupportsKind(template, kind), template).toBe(true);
    }
    expect(walkthroughKindFor("m15dfcfront")).toBe("transform");
    expect(walkthroughKindFor("m15dfclandfront")).toBe("transform");
  });

  it("walkthroughKind keeps a URL kind the template can wear, else the template's own", () => {
    expect(walkthroughKind("m15", "instant")).toBe("instant");
    expect(walkthroughKind("m15pw", "creature")).toBe("planeswalker");
    expect(walkthroughKind("saga", "garbage")).toBe("saga");
    expect(walkthroughKind("battle", undefined)).toBe("battle");
  });
});

describe("walk-through links", () => {
  it("walkthroughHref is the spec's /create?previewFrames=all&kind=…&template=…&color=…&seed=reference", () => {
    const href = walkthroughHref({ template: "adventure", colorKey: "g" });
    const url = new URL(href, "https://pipglyph.test");
    expect(url.pathname).toBe("/create");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      previewFrames: "all",
      kind: "adventure",
      template: "adventure",
      color: "g",
      seed: "reference",
    });
    expect(walkthroughHref({ template: "m15", colorKey: "w", seed: "none" })).not.toContain("seed=");
  });

  it("parseWalkthroughSeed only knows reference and sample", () => {
    expect(parseWalkthroughSeed("reference")).toBe("reference");
    expect(parseWalkthroughSeed("sample")).toBe("sample");
    expect(parseWalkthroughSeed("other")).toBe("none");
    expect(parseWalkthroughSeed(undefined)).toBe("none");
  });

  it("firstColourToWalk: unverified first, then needing re-verification, else white", () => {
    expect(
      firstColourToWalk([
        { colorKey: "w", verified: true },
        { colorKey: "u", verified: false },
      ]),
    ).toBe("u");
    expect(
      firstColourToWalk([
        { colorKey: "w", verified: true },
        { colorKey: "b", verified: true, stale: true },
      ]),
    ).toBe("b");
    expect(firstColourToWalk([{ colorKey: "u", verified: true }])).toBe("w");
  });

  it("the create → edit hop keeps the mode; Exit preview drops only the preview params", () => {
    expect(withPreviewFramesParam("/card/x/edit?step=publish", "all")).toBe(
      "/card/x/edit?step=publish&previewFrames=all",
    );
    expect(withPreviewFramesParam("/card/x/edit?step=publish", null)).toBe(
      "/card/x/edit?step=publish",
    );
    expect(
      withoutPreviewParams("/create", {
        previewFrames: "all",
        template: "saga",
        color: "w",
        kind: "saga",
        seed: "reference",
        ref: "abc",
        tag: "challenge-tag",
      }),
    ).toBe("/create?tag=challenge-tag");
    expect(withoutPreviewParams("/create", { previewFrames: "all" })).toBe("/create");
  });
});
