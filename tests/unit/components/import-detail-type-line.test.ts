import { describe, expect, it } from "vitest";
import printings from "../scryfall/fixtures/import-printings.json";
import { importPatchTypeLine } from "@/components/creator/import/import-detail";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";

// ---------------------------------------------------------------------------
// TODO 3b.15 on the import dialog: the "Type" row of what an import will
// populate reads a token as the card will print it — "Token" first, then its
// words — not the stored columns in stored order ("Artifact token —
// Treasure"). Real (trimmed) Scryfall printings through the real mapper.
// ---------------------------------------------------------------------------

const patchOf = (key: keyof typeof printings) =>
  mapScryfallToFormPatch(scryfallCardSchema.parse(structuredClone(printings[key])));

describe("importPatchTypeLine — the import dialog's Type row", () => {
  it("prints a token's line as it prints: TMSH #27 Treasure, TKLD #7 Thopter", () => {
    expect(importPatchTypeLine(patchOf("tmsh-27"))).toBe("Token Artifact — Treasure");
    expect(importPatchTypeLine(patchOf("tkld-7"))).toBe("Token Artifact Creature — Thopter");
  });

  it("a Copy's bare \"Token\"", () => {
    expect(importPatchTypeLine({ card_type: "token", supertype: undefined, subtypes_text: undefined })).toBe("Token");
  });

  // TODO 1.20: every other card's row reads as the card will print it too —
  // the words in printed order, the card type capitalised, the subtypes as
  // the type line sets them (it read "Legendary creature — Elf, Druid", and
  // Dryad Arbor "Creature land — Forest, Dryad" beside its own scan).
  it("prints every other card's line as it prints", () => {
    expect(importPatchTypeLine({ card_type: "creature", supertype: "Legendary", subtypes_text: "Elf, Druid" })).toBe(
      "Legendary Creature — Elf Druid",
    );
    expect(importPatchTypeLine(patchOf("dsc-273"))).toBe("Land Creature — Forest Dryad");
    expect(importPatchTypeLine(patchOf("ths-42"))).toBe("Legendary Enchantment Artifact");
    expect(importPatchTypeLine(patchOf("mh2-259"))).toBe("Enchantment Land — Urza's Saga");
    expect(importPatchTypeLine(patchOf("fin-1"))).toBe("Enchantment Creature — Saga Dragon");
  });
});
