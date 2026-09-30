import { describe, expect, it } from "vitest";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { frameMatchFromScryfall } from "@/lib/scryfall/import-mapper";
import { FRAME_SIGNATURE_KEYS } from "@/lib/scryfall/frame-signatures";
import printings from "./fixtures/anatomy-printings.json";

// ---------------------------------------------------------------------------
// TODO 4.6.0 / 4.6b — the registry's anatomy gaps
// (lib/scryfall/frame-signatures.ts), on the real profiles (4.6b draws the
// pairs on m15, m15artifact and m15land; no frame draws the crown yet):
//   • the layout frames gain the crown and two-colour gaps — a crowned
//     adventure (WOE #220 Beluna) or a two-colour saga (KHM #201) used to
//     import `exact` on a frame that draws gold with no crown;
//   • `two-colour` splits by print's dress: `two-colour-hybrid` when every
//     coloured pip is a two-colour hybrid (twoColorDressOf), so a hybrid
//     printing can't import `exact` onto a gold-split dress later;
//   • crown → 4.6a; the pairs left undrawn after 4.6b → 4.6f.
// The same printings with the gaps a frame draws dropped:
// anatomy-gaps-declared.test.ts.
// ---------------------------------------------------------------------------

const P = Object.fromEntries(
  Object.entries(printings).map(([key, raw]) => [key, scryfallCardSchema.parse(raw) as ScryfallCard]),
);
const match = (key: string) => frameMatchFromScryfall(P[key]);

describe("the layout frames' new gaps", () => {
  it("a crowned adventure is nearest, blocked by the crown", () => {
    expect(match("woe-220")).toMatchObject({
      status: "nearest",
      template: "adventure",
      signature: "layout/2015+crown",
      blockedBy: "4.6a",
      reason: "PipGlyph doesn't draw the legendary crown yet",
    });
  });

  it("a two-colour saga is nearest, blocked by the two-colour frame's wave 2", () => {
    expect(match("khm-201")).toMatchObject({
      status: "nearest",
      template: "saga",
      signature: "layout/2015+two-colour",
      blockedBy: "4.6f",
    });
  });
});

describe("two-colour, by print's dress (4.6b: m15 draws both dresses, m15artifact and m15land the split)", () => {
  it("a gold-split printing — a two-colour or mixed cost — imports exact where its frame draws the split", () => {
    expect(match("stx-175")).toMatchObject({ status: "exact", signature: "era/2015", template: "m15" });
    expect(match("stx-175").gaps).toBeUndefined();
    expect(match("dft-219")).toMatchObject({ status: "exact", template: "m15artifact" });
    expect(match("mkm-264")).toMatchObject({ status: "exact", template: "m15land" });
    // A crowned pair keeps only the crown's gap (4.6a).
    expect(match("fdn-122")).toMatchObject({ status: "nearest", signature: "era/2015+crown", blockedBy: "4.6a" });
    expect(match("fdn-122").gaps).toEqual(["crown"]);
    expect(match("mkm-238").gaps).toEqual(["crown"]);
  });

  it("an all-hybrid printing imports exact on m15; the artifact frame has no hybrid dress, so it stays a gap", () => {
    expect(match("tla-212")).toMatchObject({ status: "exact", template: "m15", signature: "era/2015" });
    expect(match("eld-206")).toMatchObject({
      status: "nearest",
      template: "m15artifact",
      signature: "era/2015+two-colour-hybrid",
      blockedBy: "4.6f",
      reason: "two-colour hybrid cards print a split hybrid frame, and PipGlyph uses its gold one",
      gaps: ["two-colour-hybrid"],
    });
  });

  it("the new signatures are in the vocabulary the request log stores", () => {
    for (const key of [
      "layout/2015+crown",
      "layout/2015+two-colour",
      "layout/2015+two-colour-hybrid",
      "era/2015+two-colour-hybrid",
      "era/2003+two-colour-hybrid",
      "borderless/standard+two-colour-hybrid",
      "extendedart+two-colour-hybrid",
      "token/m20+two-colour-hybrid",
    ]) {
      expect(FRAME_SIGNATURE_KEYS, key).toContain(key);
    }
  });
});
