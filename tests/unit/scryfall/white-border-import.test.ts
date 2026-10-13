import { describe, expect, it } from "vitest";
import { importedAnatomy, newCardFrameStyle } from "@/lib/cards/anatomy";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { signatureDrawnOn } from "@/lib/scryfall/frame-signatures";
import { frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import printings from "./fixtures/white-border-printings.json";

// ---------------------------------------------------------------------------
// TODO 4.30 — "imports follow the printing" for the border. A white-bordered
// printing on the 1997 or the 2003 frame (Fifth → Seventh Edition,
// Anthologies, Deckmasters; Eighth and Ninth Edition) is EXACT on its frame
// and imports with the switch on; its own black-bordered foil printing
// (7ED ★, 8ED ★) is exact too and names none. Everything else keeps the
// `border` gap: a white border on the 1993 frame (Unlimited, Revised, Fourth
// Edition: other drawings on another box — its own step) or on the 2015
// frame, and every silver, gold or yellow border.
// Fixtures: real Scryfall printings, trimmed.
// ---------------------------------------------------------------------------

const P = printings as unknown as Record<string, ScryfallCard>;
const match = (card: ScryfallCard) => {
  const m = frameMatchFromScryfall(card);
  return [m.status, m.template, (m.gaps ?? []).join("+")];
};
const probe = (over: Partial<ScryfallCard>) =>
  ({
    id: "94c70f23-0ca9-425e-a53a-6c09921c0075",
    name: "Probe",
    frame: "1997",
    border_color: "white",
    released_at: "1999-04-21",
    type_line: "Creature — Elf",
    mana_cost: "{G}",
    colors: ["G"],
    ...over,
  }) as ScryfallCard;

describe("white-bordered printings on the frames that draw the border", () => {
  it.each(["5ed-239", "6ed-304", "7ed-42", "ath-65", "dkm-33"])("%s (1997 frame): exact on `retro`, the switch on", (key) => {
    expect(P[key].border_color).toBe("white");
    expect(match(P[key])).toEqual(["exact", "retro", ""]);
    const patch = mapScryfallToFormPatch(P[key]);
    expect(patch.printed_border).toBe("white");
    const style = importedAnatomy(patch, "retro").style;
    expect(style.border).toBe("white");
    expect(newCardFrameStyle({ template: "retro", ...style }, patch.card_type ?? "creature").border).toBe("white");
  });

  it.each(["8ed-43", "8ed-138", "9ed-197", "9ed-305"])("%s (2003 frame): exact on `modern`, the switch on", (key) => {
    expect(P[key].border_color).toBe("white");
    expect(match(P[key])).toEqual(["exact", "modern", ""]);
    const patch = mapScryfallToFormPatch(P[key]);
    expect(patch.printed_border).toBe("white");
    expect(importedAnatomy(patch, "modern").style.border).toBe("white");
  });

  it.each(["7ed-42★", "8ed-43★"])("%s — the same card's black-bordered foil printing: exact, and no border named", (key) => {
    expect(P[key].border_color).toBe("black");
    expect(match(P[key])[0]).toBe("exact");
    const patch = mapScryfallToFormPatch(P[key]);
    expect("printed_border" in patch).toBe(false);
    expect("border" in importedAnatomy(patch, match(P[key])[1] as string).style).toBe(false);
  });

  it("a white-bordered land lands on the land frame with its border", () => {
    for (const [frame, template] of [["1997", "retroland"], ["2003", "modernland"]] as const) {
      const land = probe({ frame, type_line: "Land", mana_cost: "", colors: [] });
      expect(match(land), frame).toEqual(["exact", template, ""]);
      expect(importedAnatomy(mapScryfallToFormPatch(land), template).style.border).toBe("white");
    }
  });
});

describe("what stays a gap", () => {
  it("a white border on the 1993 frame (Unlimited, Revised, Fourth Edition): nearest, and the save drops the switch", () => {
    const unlimited = probe({ frame: "1993", released_at: "1993-12-01" });
    expect(frameMatchFromScryfall(unlimited)).toMatchObject({
      status: "nearest",
      template: "agclassic",
      blockedBy: "4.30",
      reason: "PipGlyph doesn't print a white border on this frame yet",
      gaps: ["border"],
    });
    const patch = mapScryfallToFormPatch(unlimited);
    expect(patch.printed_border).toBe("white");
    expect("border" in newCardFrameStyle({ template: "agclassic", ...importedAnatomy(patch, "agclassic").style }, "creature")).toBe(false);
  });

  it("a white border on the 2015 frame: nearest", () => {
    const m = frameMatchFromScryfall(probe({ frame: "2015", released_at: "2024-09-27" }));
    expect(m.status).toBe("nearest");
    expect(m.gaps).toContain("border");
  });

  it.each(["silver", "gold", "yellow"])("a %s border on the 1997 / 2003 frames: nearest, in its own words", (border_color) => {
    for (const frame of ["1997", "2003"]) {
      const m = frameMatchFromScryfall(probe({ frame, border_color }));
      expect(m, frame).toMatchObject({ status: "nearest", gaps: ["border"], reason: `PipGlyph doesn't print a ${border_color} border yet` });
      expect("printed_border" in mapScryfallToFormPatch(probe({ frame, border_color }))).toBe(false);
    }
  });

  it("a later gap still holds beside a drawn white border (a 2023 reprint on the 1997 frame)", () => {
    expect(match(probe({ released_at: "2023-01-13" }))).toEqual(["nearest", "retro", "reprint-colours"]);
  });

  it("a \"+border\" request row logged before 4.30 stays open: the row doesn't say which border it was", () => {
    expect(signatureDrawnOn("era/1997+border", "retro")).toBe(false);
    expect(signatureDrawnOn("era/2003+border", "modern")).toBe(false);
  });
});
