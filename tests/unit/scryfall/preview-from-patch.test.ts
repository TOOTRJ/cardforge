import { describe, expect, it } from "vitest";
import {
  backFaceFromPatch,
  previewFromImportPatch,
  splitSubtypes,
} from "@/lib/scryfall/preview-from-patch";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import type { ScryfallCard } from "@/lib/scryfall/client";

// The frame-compare tool renders the reference printing through our own
// pipeline. Multi-panel frames (adventure, flip, split, aftermath) draw their
// second half from the BACK FACE, so the preview must carry it — before this
// the compare view showed an empty page for every one of those combos.

const bonecrusher = {
  id: "09fd2d9c-1793-4beb-a3fb-7a869f660cd4",
  name: "Bonecrusher Giant // Stomp",
  layout: "adventure",
  type_line: "Creature — Giant // Instant — Adventure",
  rarity: "rare",
  color_identity: ["R"],
  artist: "Victor Adame Minguez",
  card_faces: [
    {
      name: "Bonecrusher Giant",
      mana_cost: "{2}{R}",
      type_line: "Creature — Giant",
      oracle_text:
        "Whenever Bonecrusher Giant becomes the target of a spell, Bonecrusher Giant deals 2 damage to that spell's controller.",
      power: "4",
      toughness: "3",
    },
    {
      name: "Stomp",
      mana_cost: "{1}{R}",
      type_line: "Instant — Adventure",
      oracle_text:
        "Damage can't be prevented this turn. Stomp deals 2 damage to any target.",
      flavor_text: "\"Fight me? Adorable.\"",
    },
  ],
} as unknown as ScryfallCard;

describe("splitSubtypes", () => {
  it("splits the creator's comma/newline field and drops blanks", () => {
    expect(splitSubtypes("Giant, Warrior\n Berserker ,")).toEqual([
      "Giant",
      "Warrior",
      "Berserker",
    ]);
    expect(splitSubtypes(null)).toEqual([]);
  });
});

describe("previewFromImportPatch", () => {
  it("carries the second face of a multi-face printing into the preview", () => {
    const patch = mapScryfallToFormPatch(bonecrusher, { artPreviewUrl: null });
    const preview = previewFromImportPatch(patch, bonecrusher.name, "adventure");

    expect(preview.frameStyle).toEqual({ template: "adventure" });
    expect(preview.title).toBe("Bonecrusher Giant");
    expect(preview.cost).toBe("{2}{R}");
    expect(preview.subtypes).toEqual(["Giant"]);
    expect(preview.power).toBe("4");
    // No rehosted art — the scan supplies it.
    expect(preview.artUrl).toBeNull();

    expect(preview.backFace).not.toBeNull();
    expect(preview.backFace?.title).toBe("Stomp");
    expect(preview.backFace?.cost).toBe("{1}{R}");
    expect(preview.backFace?.card_type).toBe("instant");
    expect(preview.backFace?.subtypes).toEqual(["Adventure"]);
    expect(preview.backFace?.rules_text).toContain("Stomp deals 2 damage");
    expect(preview.backFace?.art_url).toBeUndefined();
  });

  it("leaves backFace null for a single-faced printing", () => {
    const serra = {
      id: "b56b9131-4f7e-4912-ba47-63ed82f21d1b",
      name: "Serra Angel",
      layout: "normal",
      type_line: "Creature — Angel",
      mana_cost: "{3}{W}{W}",
      oracle_text: "Flying, vigilance",
      power: "4",
      toughness: "4",
      rarity: "uncommon",
      color_identity: ["W"],
    } as unknown as ScryfallCard;
    const preview = previewFromImportPatch(
      mapScryfallToFormPatch(serra, { artPreviewUrl: null }),
      serra.name,
      "m15",
    );
    expect(preview.backFace).toBeNull();
    expect(preview.subtypes).toEqual(["Angel"]);
  });

  it("falls back to the card name when the patch has no title", () => {
    const preview = previewFromImportPatch({}, "Fallback Name", "m15");
    expect(preview.title).toBe("Fallback Name");
    expect(preview.subtypes).toEqual([]);
    expect(preview.colorIdentity).toEqual([]);
  });
});

describe("backFaceFromPatch", () => {
  it("returns null for an absent back face", () => {
    expect(backFaceFromPatch(undefined)).toBeNull();
  });

  it("defaults a missing title to an empty string (the jsonb shape requires one)", () => {
    expect(backFaceFromPatch({ rules_text: "x" })?.title).toBe("");
  });
});
