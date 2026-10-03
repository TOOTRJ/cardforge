import { describe, expect, it } from "vitest";
import collector from "./fixtures/collector-printings.json";
import styles from "./fixtures/collector-style-printings.json";
import { importedAnatomy, newCardFrameStyle } from "@/lib/cards/anatomy";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch, stampOfPrinting } from "@/lib/scryfall/import-mapper";

// ---------------------------------------------------------------------------
// TODO 4.9c — the holofoil stamp an import writes (owner 2026-09-29: imports
// follow the printing): Scryfall's `security_stamp` oval → "oval", triangle
// → "triangle", anything else → "none" — ALWAYS named, so an unstamped
// printing never takes the new card's "auto" (a common imported onto a
// rare's frame stays unstamped), and the save drops the key where the
// landed frame has no notch (a token frame, the emblem). Fixtures: the
// real Scryfall payloads of the 4.9a / 4.9b tests — DMU #107 (a stamped
// mythic), TDOM #1 and TFDN #24 (unstamped tokens), the SLD 2023 rares
// (triangle: the Universes Beyond-style Secret Lair drops), PJUD #11 (a
// 1997-frame promo, no stamp).
// ---------------------------------------------------------------------------

type CollectorKey = keyof typeof collector;
type StyleKey = keyof typeof styles;
const card = (raw: unknown): ScryfallCard => scryfallCardSchema.parse(raw);
const of = (key: CollectorKey) => card((collector as Record<string, unknown>)[key]);
const styled = (key: StyleKey) => card((styles as Record<string, unknown>)[key]);

describe("stampOfPrinting", () => {
  it("reads Scryfall's security_stamp: oval, triangle, else none", () => {
    expect(stampOfPrinting({ security_stamp: "oval" })).toBe("oval");
    expect(stampOfPrinting({ security_stamp: "triangle" })).toBe("triangle");
    expect(stampOfPrinting({ security_stamp: " Oval " })).toBe("oval");
    for (const other of ["acorn", "circle", "heart", "arena", "", "   ", null, undefined]) {
      expect(stampOfPrinting({ security_stamp: other }), String(other)).toBe("none");
    }
  });

  it("the fixtures: DMU #107 and ONC #114 carry the oval, the SLD drops the triangle, the tokens and the 1997 promo none", () => {
    expect(stampOfPrinting(of("dmu-107"))).toBe("oval");
    expect(stampOfPrinting(of("dmu-107-es"))).toBe("oval");
    expect(stampOfPrinting(of("onc-114"))).toBe("oval");
    expect(stampOfPrinting(of("fdn-1"))).toBe("oval");
    expect(stampOfPrinting(of("tdom-1"))).toBe("none");
    expect(stampOfPrinting(of("tfdn-24"))).toBe("none");
    expect(stampOfPrinting(of("pjud-11-he"))).toBe("none");
    expect(stampOfPrinting(styled("sld-1242"))).toBe("triangle");
    expect(stampOfPrinting(styled("sld-728"))).toBe("triangle");
  });
});

describe("the import patch and the saved card", () => {
  it("names the printing's stamp on every import, and the landed frame keeps or drops it at the save", () => {
    const dmu = mapScryfallToFormPatch(of("dmu-107"), { artPreviewUrl: null });
    expect(dmu.printed_stamp).toBe("oval");
    expect(importedAnatomy(dmu, "m15").style.stamp).toBe("oval");
    expect(newCardFrameStyle({ template: "m15", ...importedAnatomy(dmu, "m15").style }, "creature").stamp).toBe("oval");

    // An unstamped token printing lands on a token frame: "none", dropped.
    const tdom = mapScryfallToFormPatch(of("tdom-1"), { artPreviewUrl: null });
    expect(tdom.printed_stamp).toBe("none");
    expect(importedAnatomy(tdom, "m15token").style.stamp).toBe("none");
    expect(newCardFrameStyle({ template: "m15token", ...importedAnatomy(tdom, "m15token").style }, "token")).not.toHaveProperty("stamp");

    // A triangle printing landing on a wave-1 frame keeps "triangle" (the
    // frame draws its oval; a frame that prints the triangle is 4.9d's).
    const sld = mapScryfallToFormPatch(styled("sld-1242"), { artPreviewUrl: null });
    expect(sld.printed_stamp).toBe("triangle");
    expect(newCardFrameStyle({ template: "m15", ...importedAnatomy(sld, "m15").style }, "creature").stamp).toBe("triangle");

    // A 1997-frame printing: "none" — and never the new card's "auto".
    const pjud = mapScryfallToFormPatch(of("pjud-11-he"), { artPreviewUrl: null });
    expect(pjud.printed_stamp).toBe("none");
    expect(newCardFrameStyle({ template: "m15", ...importedAnatomy(pjud, "m15").style }, "creature").stamp).toBe("none");
  });
});
