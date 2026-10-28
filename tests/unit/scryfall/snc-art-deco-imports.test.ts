import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/snc-art-deco-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameColorsFromScryfall, frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { frameAnatomyOf, importedAnatomy, normalizeAnatomy } from "@/lib/cards/anatomy";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { frameChoicesForType, resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { frameRequestFromImport } from "@/lib/frames/frame-requests";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 2: the New Capenna Art Deco showcase's imports. Every
// printing of Streets of New Capenna from #295 to #406 and the walker run
// #441–449 (fixtures/snc-art-deco-printings.json, captured 2026-10-27 and
// trimmed to what the import reads). SNC #296–340 and their gilded-foil
// twins #361–405 — 90 printings — land on `sncartdeco`: exact once the
// card's colour is verified, nearest until then. #341–359 and #441–449 (the
// pale Golden Age frame, its walkers among them) and #360 (the Phyrexian
// Urabrask) stay `showcase`, as before. The card's colour is the
// printing's, always; the legends' crown is on (all 30 print the arch); the
// stamp and the collector line follow the printing.
// ---------------------------------------------------------------------------

const printings = printingsData as Record<string, unknown>;
const card = (key: string) => scryfallCardSchema.parse(printings[key]);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const every = (template: FrameTemplate) => new Set(KEYS.map((k) => frameComboKey(template, k)));
const isArtDeco = (n: number) => (n >= 296 && n <= 340) || (n >= 361 && n <= 405);

const rows = Object.keys(printings).map((key) => {
  const c = card(key);
  return { key, c, n: Number(c.collector_number), match: frameMatchFromScryfall(c), colour: pickFrameColorKey(frameColorsFromScryfall(c)) };
});
const deco = rows.filter((r) => isArtDeco(r.n));

describe("the New Capenna Art Deco imports", () => {
  it("covers the run, its gilded twins, the Golden Age cards and the neighbours: 90 Art Deco printings, every one three colours", () => {
    expect(rows).toHaveLength(121);
    expect(deco).toHaveLength(90);
    expect(deco.filter((r) => (r.c.promo_types ?? []).includes("gilded"))).toHaveLength(45);
    for (const r of deco) {
      expect([r.c.layout, r.c.border_color, r.c.frame], r.key).toEqual(["normal", "black", "2015"]);
      expect(r.c.frame_effects, r.key).toContain("showcase");
      expect(r.c.type_line, r.key).not.toMatch(/Planeswalker|Token|Battle|Saga/);
      expect(r.c.color_identity, r.key).toHaveLength(3);
      expect(r.colour, r.key).toBe("m");
    }
  });

  it("lands every Art Deco printing on `sncartdeco`, exact, with no gap — the gilded twins too", () => {
    for (const r of deco) {
      expect(r.match.signature, r.key).toBe("showcase/snc/art-deco");
      expect([r.match.status, r.match.template], r.key).toEqual(["exact", "sncartdeco"]);
      expect(r.match.landOn, r.key).toBeUndefined();
      expect(r.match.gaps ?? [], r.key).toEqual([]);
    }
    expect(rows.find((r) => r.key === "snc-296")!.match.exactLabel).toBe("Streets of New Capenna Art Deco showcase");
    expect(rows.find((r) => r.key === "snc-361")!.match.exactLabel).toBe("Streets of New Capenna Art Deco showcase (gilded foil)");
  });

  it("leaves the Golden Age cards, their walkers, the Phyrexian Urabrask and the neighbours where they were", () => {
    for (const r of rows.filter((x) => !isArtDeco(x.n))) {
      expect(r.match.template, r.key).not.toBe("sncartdeco");
      expect(r.match.signature, r.key).not.toBe("showcase/snc/art-deco");
    }
    for (const r of rows.filter((x) => (x.n >= 341 && x.n <= 360) || x.n >= 441)) {
      expect([r.match.signature, r.match.status], r.key).toEqual(["showcase", "nearest"]);
    }
    // The walkers keep their walker landing (ask first: no walker frame here).
    for (const key of ["snc-341", "snc-347", "snc-348", "snc-441", "snc-447", "snc-448"]) {
      expect(rows.find((r) => r.key === key)!.match.template, key).toBe("m15pw");
    }
    expect(rows.find((r) => r.key === "snc-295")!.match.signature).toBe("borderless/land+short-box");
    expect(rows.find((r) => r.key === "snc-406")!.match.template).toBe("extendedart");
  });

  it("is nearest until the card's colour is verified, exact once it is — and logs the ask until then", () => {
    for (const key of ["snc-296", "snc-301", "snc-307", "snc-310", "snc-361", "snc-372", "snc-375"]) {
      const raw = mapScryfallToFormPatch(card(key));
      const colour = pickFrameColorKey(raw.color_identity ?? []);
      expect(colour, key).toBe("m");
      const none = finalizeImportMatch(raw, new Set([frameComboKey("m15", colour)]));
      expect([none.frame_template, none.frame_match?.status], key).toEqual(["sncartdeco", "nearest"]);
      expect(frameRequestFromImport(none, { artImported: true, source: "import", verifiedKeys: new Set() }), key).toMatchObject({ signature: "showcase/snc/art-deco", status: "nearest" });
      const other = finalizeImportMatch(raw, new Set([frameComboKey("sncartdeco", "w")]));
      expect(other.frame_match?.status, key).toBe("nearest");
      const ticked = new Set([frameComboKey("sncartdeco", colour)]);
      const exact = finalizeImportMatch(raw, ticked);
      expect([exact.frame_template, exact.frame_match?.status], key).toEqual(["sncartdeco", "exact"]);
      expect(frameRequestFromImport(exact, { artImported: true, source: "import", verifiedKeys: ticked }), key).toBeNull();
    }
  });

  it("keeps the printing's colour, the crown ON on a legend, the stamp and the 2015 collector line as printed", () => {
    let stamped = 0;
    let legends = 0;
    for (const r of deco) {
      const patch = mapScryfallToFormPatch(r.c, { set: { printed_size: 281 } as never });
      // The card's colour is the printing's — never a frame stand-in's.
      expect(patch.color_identity, r.key).toEqual(frameColorsFromScryfall(r.c));
      const { style, colorIdentity } = importedAnatomy(patch, "sncartdeco");
      expect(colorIdentity, r.key).toEqual(patch.color_identity);
      const saved = normalizeAnatomy({ ...style, template: "sncartdeco" }, "sncartdeco", patch.card_type ?? "creature");
      // Every legend of the run prints the arch over its title bar.
      const legendary = (r.c.frame_effects ?? []).includes("legendary");
      if (legendary) {
        legends += 1;
        expect(patch.printed_crown, r.key).toBe(true);
        expect(saved.crown, r.key).toBe(true);
      } else {
        expect(saved.crown ?? false, r.key).toBe(false);
      }
      // No two-colour dress on the one gold frame.
      expect("twoColor" in saved, r.key).toBe(false);
      // The oval on a rare or mythic, none on a common or uncommon.
      const rare = r.c.rarity === "rare" || r.c.rarity === "mythic";
      expect(saved.stamp, r.key).toBe(rare ? "oval" : "none");
      if (rare) stamped += 1;
      expect(saved.collector, r.key).toBe("2015");
    }
    expect(stamped).toBe(50);
    expect(legends).toBe(30);
    expect(frameAnatomyOf("sncartdeco")).toMatchObject({ crown: true, twoColor: [], collector: true, stamp: true });
  });

  it("the AI's random pool reaches the frame only once it is verified in the card's colour", () => {
    const pool = (verified: ReadonlySet<string>) => {
      const picks = new Set<string | null>();
      for (let i = 0; i < 400; i += 1) {
        picks.add(resolveGeneratedFrame({ cardType: "creature", requested: "random", colorIdentity: ["white", "blue", "black"], verifiedKeys: verified, random: () => i / 400 }));
      }
      return picks;
    };
    const m15 = every("m15");
    expect(pool(m15).has("sncartdeco")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("sncartdeco", "w")])).has("sncartdeco")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("sncartdeco", "m")])).has("sncartdeco")).toBe(true);
    // …and the options dialog offers it with no colour until one is ticked.
    const offered = (verified: ReadonlySet<string>) => frameChoicesForType("creature", verified).find((f) => f.template === "sncartdeco");
    expect(offered(m15)?.availableColorKeys ?? []).toEqual([]);
    expect(offered(new Set([frameComboKey("sncartdeco", "m")]))?.availableColorKeys).toEqual(["m"]);
    // A request for it by name on a planeswalker or a battle never lands there.
    expect(resolveGeneratedFrame({ cardType: "planeswalker", requested: "sncartdeco", colorIdentity: ["red"], verifiedKeys: new Set([...every("sncartdeco"), ...every("m15pw")]), random: () => 0 })).toBe("m15pw");
  });
});
