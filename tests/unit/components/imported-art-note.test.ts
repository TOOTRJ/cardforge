import { describe, expect, it } from "vitest";
import {
  importedArtNoteText,
  type ImportedArtOrigin,
} from "@/components/creator/import/imported-art-note";

// ---------------------------------------------------------------------------
// TODO 1.18, UI half: the Art step's note on art imported from Scryfall,
// whose art_crop stops at the printed frame. (a) On a frame whose art
// reaches the card edge; (b) a full-art or textless printing's crop holds
// pieces of the printed frame (warn only, owner decision 2026-09-26). Only
// while the imported art is still the card's art.
// ---------------------------------------------------------------------------

const ART = "https://project.supabase.co/storage/v1/object/public/card-art/u/a.jpg";
const origin = (over: Partial<ImportedArtOrigin> = {}): ImportedArtOrigin => ({
  artUrl: ART,
  borderless: false,
  fullArt: false,
  textless: false,
  ...over,
});

describe("importedArtNoteText", () => {
  it("(a) an edge-to-edge frame: the art is only the classic window", () => {
    for (const template of ["m15borderless", "m15borderlessartifact", "fullartland"]) {
      expect(importedArtNoteText({ origin: origin({ borderless: true }), artUrl: ART, template }), template).toBe(
        "Scryfall only has this art cropped to the classic window — upload the full illustration for a sharp borderless card.",
      );
    }
  });

  it("(a)+(b) an edge-to-edge frame with a full-art crop", () => {
    expect(
      importedArtNoteText({ origin: origin({ fullArt: true }), artUrl: ART, template: "m15borderless" }),
    ).toBe(
      "Scryfall only has this art cropped to the printed frame, and it includes parts of that frame — upload the full illustration for a sharp borderless card.",
    );
  });

  it("(b) a full-art or textless printing on a bordered frame", () => {
    expect(importedArtNoteText({ origin: origin({ fullArt: true }), artUrl: ART, template: "m15fullartland" })).toBe(
      "Scryfall's art for this full-art printing includes parts of the printed frame — check its edges, or upload the full illustration.",
    );
    expect(
      importedArtNoteText({ origin: origin({ fullArt: true, textless: true }), artUrl: ART, template: "m15" }),
    ).toBe(
      "Scryfall's art for this textless printing includes parts of the printed frame — check its edges, or upload the full illustration.",
    );
  });

  it("nothing for a plain crop on a bordered frame, once the art changed, or with no import", () => {
    expect(importedArtNoteText({ origin: origin({ borderless: true }), artUrl: ART, template: "m15" })).toBeNull();
    expect(
      importedArtNoteText({ origin: origin({ fullArt: true }), artUrl: `${ART}?v=2`, template: "m15borderless" }),
    ).toBeNull();
    expect(importedArtNoteText({ origin: null, artUrl: ART, template: "m15borderless" })).toBeNull();
    expect(importedArtNoteText({ origin: origin(), artUrl: "", template: "m15borderless" })).toBeNull();
  });
});
