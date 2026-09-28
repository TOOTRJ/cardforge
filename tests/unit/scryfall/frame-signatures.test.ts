import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/signature-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import {
  frameColorsFromScryfall,
  frameMatchFromScryfall,
  mapScryfallToFormPatch,
} from "@/lib/scryfall/import-mapper";
import {
  BORDER_PENDING_TEMPLATES,
  FRAME_SIGNATURE_KEYS,
  FRAME_SIGNATURE_RULES,
  isKnownFrameSignature,
  landFrameColorRule,
  type FrameMatchStatus,
} from "@/lib/scryfall/frame-signatures";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The frame signature registry (TODO 1.4, 1.17, 1.19). Every fixture is a
// real printing captured once from Scryfall (2026-09-28) and trimmed to the
// fields the registry, the importer and the reference check read; tests
// never call Scryfall.
// ---------------------------------------------------------------------------

type PrintingKey = keyof typeof printingsData;
const printing = (key: PrintingKey) => scryfallCardSchema.parse(printingsData[key]);
const colorKeyOf = (key: PrintingKey) => pickFrameColorKey(frameColorsFromScryfall(printing(key)));

// [fixture, status, template, landOn]
type Row = [PrintingKey, FrameMatchStatus, FrameTemplate, FrameTemplate | undefined];

describe("the general signatures (TODO 1.4)", () => {
  const rows: Row[] = [
    // Porcelain Legionnaire NPH #19: a white artifact creature on the 2003
    // frame prints the ARTIFACT frame, which only M15 has.
    ["nph-19", "nearest", "m15artifact", undefined],
    // Flooded Strand KTK #233: a fetch land prints its two colours — a
    // two-colour land frame PipGlyph draws gold (4.6).
    ["ktk-233", "nearest", "m15land", undefined],
    // Evolving Wilds MSC #240 stays grey; Fabled Passage and Prismatic Vista
    // print the gold land frame (their scans).
    ["msc-240", "exact", "m15land", undefined],
    ["eld-244", "exact", "m15land", undefined],
    ["mh1-244", "exact", "m15land", undefined],
    ["zen-211", "nearest", "modernland", undefined],
    // Nyx: the THB constellation showcase IS the nyx frame, but PipGlyph's
    // Nyx dresses enchantments only, so a god lands on M15; the regular Nyx
    // starfield (THB #18, FDN #27) is M15 with a gap; THS on the 2003 frame
    // is nearest Nyx (Bident of Thassa THS #42).
    ["thb-259", "nearest", "nyx", "m15"],
    ["thb-18", "nearest", "m15", undefined],
    ["fdn-27", "nearest", "m15", undefined],
    ["ths-42", "nearest", "nyx", undefined],
    // Future Sight: unsupported, nearest M15.
    ["fut-18", "unsupported", "m15", undefined],
    // Extended art.
    ["woe-328", "exact", "extendedart", undefined],
    // Pinned showcase runs.
    ["ltr-482", "nearest", "lotrscroll", undefined],
    ["ltr-602", "nearest", "lotrscroll", "saga"],
    ["tdm-303", "exact", "tarkirdraconic", undefined],
    ["tdm-320", "nearest", "tarkirdraconic", "adventure"],
    ["tdm-399", "nearest", "tarkirghostfire", undefined],
    ["tdm-400", "nearest", "tarkirghostfire", undefined],
    ["tdm-409", "nearest", "tarkirghostfire", undefined],
    ["mul-1", "nearest", "tarkirdragon", undefined],
    ["mul-60", "nearest", "tarkirdragon", undefined],
    ["mul-5", "nearest", "m15", undefined],
    // A snow ARTIFACT prints the snow frame, which the Artifact kind can't
    // take yet: it lands on the artifact frame.
    ["khm-244", "nearest", "m15snow", "m15artifact"],
    // Anatomy gaps on the M15 era: the crown, the double-faced marks, a
    // two-colour land, the silver border + Un-host layout.
    ["dmu-107", "nearest", "m15", undefined],
    ["mid-7", "nearest", "m15", undefined],
    ["ktk-229", "nearest", "m15land", undefined],
    ["ust-1", "nearest", "m15", undefined],
  ];

  it.each(rows)("%s → %s %s (landOn %s)", (key, status, template, landOn) => {
    const match = frameMatchFromScryfall(printing(key));
    expect([match.status, match.template, match.landOn]).toEqual([status, template, landOn]);
  });

  it("names the anatomy gap and the blocking item", () => {
    expect(frameMatchFromScryfall(printing("dmu-107"))).toMatchObject({
      signature: "era/2015+crown",
      blockedBy: "4.6",
      reason: "PipGlyph doesn't draw the legendary crown yet",
    });
    expect(frameMatchFromScryfall(printing("mid-7")).signature).toBe("era/2015+dfc");
    expect(frameMatchFromScryfall(printing("thb-18")).signature).toBe("era/2015+nyx");
    expect(frameMatchFromScryfall(printing("ktk-233")).signature).toBe("era/2015+two-colour");
    expect(frameMatchFromScryfall(printing("nph-19")).signature).toBe("era/2003/coloured-artifact");
    expect(frameMatchFromScryfall(printing("fut-18"))).toMatchObject({
      signature: "future",
      exactLabel: "Future Sight frame",
      blockedBy: "4.15",
    });
  });

  it("says why a frame that can't dress the kind lands elsewhere", () => {
    expect(frameMatchFromScryfall(printing("thb-259")).reason).toBe(
      "PipGlyph's Nyx Constellation frame doesn't dress creatures yet",
    );
    expect(frameMatchFromScryfall(printing("khm-244")).reason).toBe(
      "PipGlyph's M15 (2015) Snow frame doesn't dress artifacts yet",
    );
  });
});

describe("the acceptance's named cases (TODO 1.4 (e))", () => {
  it("Porcelain Legionnaire NPH #19 → m15artifact, white, nearest", () => {
    const patch = mapScryfallToFormPatch(printing("nph-19"));
    expect(patch.frame_match).toMatchObject({ status: "nearest", template: "m15artifact" });
    expect(patch.frame_template).toBe("m15artifact");
    expect(colorKeyOf("nph-19")).toBe("w");
  });

  it("Flooded Strand KTK #233 → m15land, multicolour", () => {
    const patch = mapScryfallToFormPatch(printing("ktk-233"));
    expect(patch.frame_template).toBe("m15land");
    expect(patch.color_identity).toEqual(["multicolor"]);
  });

  it("Bident of Thassa THS #42 → nyx, nearest", () => {
    const patch = mapScryfallToFormPatch(printing("ths-42"));
    expect(patch.frame_match).toMatchObject({ status: "nearest", template: "nyx" });
    expect(patch.frame_template).toBe("nyx");
  });

  it("a Future Sight printing → unsupported, nearest m15", () => {
    const patch = mapScryfallToFormPatch(printing("fut-18"));
    expect(patch.frame_match).toMatchObject({ status: "unsupported", template: "m15" });
    expect(patch.frame_template).toBe("m15");
  });

  it("layout kinds keep frame_template undefined (the kind fixes it) but carry the match", () => {
    const patch = mapScryfallToFormPatch(printing("tdm-320"));
    expect(patch.kind).toBe("adventure");
    expect(patch.frame_template).toBeUndefined();
    expect(patch.frame_match).toMatchObject({ template: "tarkirdraconic", landOn: "adventure" });
  });

  it("survives the route's JSON hop", () => {
    const patch = mapScryfallToFormPatch(printing("nph-19"));
    const wire = JSON.parse(JSON.stringify(patch)) as typeof patch;
    expect(wire.frame_match).toEqual(patch.frame_match);
  });
});

describe("fetch-land colours (landFrameColorRule)", () => {
  it("a fetch land for two basic land types prints those colours", () => {
    expect(landFrameColorRule(printing("ktk-233"))).toEqual(["W", "U"]);
    expect(landFrameColorRule(printing("zen-211"))).toEqual(["W", "R"]);
    expect(landFrameColorRule(printing("zne-1"))).toEqual(["W", "U"]);
  });

  it("a basic-land fetcher: Evolving Wilds grey, Fabled Passage and Prismatic Vista gold", () => {
    expect(landFrameColorRule(printing("msc-240"))).toBeNull();
    expect(colorKeyOf("msc-240")).toBe("c");
    expect(colorKeyOf("eld-244")).toBe("m");
    expect(colorKeyOf("mh1-244")).toBe("m");
  });

  it("a land that produces mana keeps the produced-mana rule", () => {
    expect(landFrameColorRule(printing("ktk-229"))).toBeNull();
    expect(colorKeyOf("ktk-229")).toBe("m");
  });
});

describe("the rule table", () => {
  it("has unique signature keys, all known", () => {
    expect(new Set(FRAME_SIGNATURE_KEYS).size).toBe(FRAME_SIGNATURE_KEYS.length);
    for (const key of FRAME_SIGNATURE_KEYS) expect(isKnownFrameSignature(key)).toBe(true);
    expect(isKnownFrameSignature("borderless/made-up")).toBe(false);
    expect(isKnownFrameSignature(undefined)).toBe(false);
  });

  it("ends in a catch-all, so every printing gets a match", () => {
    expect(FRAME_SIGNATURE_RULES[FRAME_SIGNATURE_RULES.length - 1]?.key).toBe("unknown-frame");
    const odd = scryfallCardSchema.parse({ id: "x", name: "Odd", frame: "3021", type_line: "Sorcery" });
    expect(frameMatchFromScryfall(odd)).toMatchObject({ status: "nearest", template: "m15" });
  });

  it("never calls a template whose border isn't true yet exact (4.35)", () => {
    for (const key of Object.keys(printingsData) as PrintingKey[]) {
      const match = frameMatchFromScryfall(printing(key));
      if (BORDER_PENDING_TEMPLATES.has(match.template)) expect(match.status, key).not.toBe("exact");
    }
  });

  it("an exact match never needs a reason, a non-exact one always has one", () => {
    for (const key of Object.keys(printingsData) as PrintingKey[]) {
      const match = frameMatchFromScryfall(printing(key));
      expect(match.reason === null, key).toBe(match.status === "exact");
      expect(isKnownFrameSignature(match.signature), key).toBe(true);
    }
  });
});
