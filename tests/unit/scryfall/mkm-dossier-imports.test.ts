import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/mkm-dossier-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameColorsFromScryfall, frameMatchFromScryfall, frontFacePairFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { frameAnatomyOf, importedAnatomy, normalizeAnatomy } from "@/lib/cards/anatomy";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { frameChoicesForType, resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { frameRequestFromImport } from "@/lib/frames/frame-requests";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 2: the MKM DOSSIER showcase's imports. Every printing
// Scryfall gives the `dossier` promo type (MKM #336–389 and #433, and the
// Secret Lair's SLD #1566–1569 and their rainbow-foil twins) and the
// printings either side of the run (MKM's 'magnified' #316, its Ravnica City
// #317, #335, #390, #432; SLD #1565 / #1570) —
// fixtures/mkm-dossier-printings.json, captured 2026-10-27 and trimmed to
// what the import reads. The 55 MKM printings land on `dossier`: exact once
// the card's colour is verified, nearest until then. The Secret Lair's four
// print the page on a NAVY border (0,21,34 on every scan) with their own
// accents, and keep their landing. The card's colour is the printing's,
// always; a legend's crown is ON (every legendary printing wears it), a
// two-colour card's split dress ON, the stamp and the collector line follow
// the printing.
// ---------------------------------------------------------------------------

const printings = printingsData as Record<string, unknown>;
const card = (key: string) => scryfallCardSchema.parse(printings[key]);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const IDENTITY_OF: Record<string, string> = { w: "white", u: "blue", b: "black", r: "red", g: "green" };
const every = (template: FrameTemplate) => new Set(KEYS.map((k) => frameComboKey(template, k)));

const rows = Object.keys(printings).map((key) => {
  const c = card(key);
  return { key, c, match: frameMatchFromScryfall(c), colour: pickFrameColorKey(frameColorsFromScryfall(c)) };
});
const isDossier = (c: { set?: string | null; promo_types?: readonly string[] | null }) => c.set === "mkm" && (c.promo_types ?? []).includes("dossier");
const dossier = rows.filter((r) => isDossier(r.c));

describe("the MKM dossier imports", () => {
  it("covers the run, the Secret Lair's dossiers and the neighbours: 55 + 8 + 7 printings", () => {
    expect(rows).toHaveLength(70);
    expect(dossier).toHaveLength(55);
    expect(rows.filter((r) => r.c.set === "sld" && (r.c.promo_types ?? []).includes("dossier"))).toHaveLength(8);
    // Every one single-faced, black-bordered on Scryfall, on the 2015 frame,
    // a creature — no walker, token or layout card among them.
    for (const r of dossier) {
      expect([r.c.layout, r.c.border_color, r.c.frame], r.key).toEqual(["normal", "black", "2015"]);
      expect(r.c.type_line, r.key).toMatch(/Creature/);
      const n = Number(r.c.collector_number);
      expect((n >= 336 && n <= 389) || n === 433, r.key).toBe(true);
    }
  });

  it("lands every dossier printing on `dossier`, exact, with no gap — two-colour, gold and invisible-ink alike", () => {
    for (const r of dossier) {
      expect(r.match.signature, r.key).toBe("showcase/mkm/dossier");
      expect([r.match.status, r.match.template], r.key).toEqual(["exact", "dossier"]);
      expect(r.match.landOn, r.key).toBeUndefined();
      expect(r.match.gaps ?? [], r.key).toEqual([]);
    }
    expect(dossier.filter((r) => r.colour === "m").length).toBe(29);
    expect(dossier.filter((r) => (r.c.promo_types ?? []).includes("invisibleink"))).toHaveLength(14);
    expect(dossier[0].match.exactLabel).toBe("Murders at Karlov Manor dossier showcase");
  });

  it("leaves the Secret Lair's navy-bordered dossiers, the magnified run and the neighbours where they were", () => {
    for (const r of rows.filter((x) => !isDossier(x.c))) {
      expect(r.match.template, r.key).not.toBe("dossier");
      expect(r.match.signature, r.key).not.toBe("showcase/mkm/dossier");
    }
    for (const key of ["sld-1566", "sld-1566s", "sld-1569s", "mkm-316", "mkm-317"]) {
      expect([rows.find((x) => x.key === key)!.match.signature, rows.find((x) => x.key === key)!.match.status], key).toEqual(["showcase", "nearest"]);
    }
  });

  it("is nearest until the card's colour is verified, exact once it is — and logs the ask until then", () => {
    for (const key of ["mkm-336", "mkm-341", "mkm-343", "mkm-350", "mkm-352", "mkm-365", "mkm-368", "mkm-376", "mkm-433"]) {
      const raw = mapScryfallToFormPatch(card(key));
      const colour = pickFrameColorKey(raw.color_identity ?? []);
      const none = finalizeImportMatch(raw, new Set([frameComboKey("m15", colour), frameComboKey("m15artifact", colour)]));
      expect([none.frame_template, none.frame_match?.status], key).toEqual(["dossier", "nearest"]);
      expect(frameRequestFromImport(none, { artImported: true, source: "import", verifiedKeys: new Set() }), key).toMatchObject({ signature: "showcase/mkm/dossier", status: "nearest" });
      const other = finalizeImportMatch(raw, new Set([frameComboKey("dossier", colour === "w" ? "u" : "w")]));
      expect(other.frame_match?.status, key).toBe("nearest");
      const ticked = new Set([frameComboKey("dossier", colour)]);
      const exact = finalizeImportMatch(raw, ticked);
      expect([exact.frame_template, exact.frame_match?.status], key).toEqual(["dossier", "exact"]);
      expect(frameRequestFromImport(exact, { artImported: true, source: "import", verifiedKeys: ticked }), key).toBeNull();
    }
  });

  it("keeps the printing's colour, the crown on a legend, the two-colour dress on a pair, the stamp and the collector line as printed", () => {
    let stamped = 0;
    let legends = 0;
    let pairs = 0;
    for (const r of dossier) {
      const patch = mapScryfallToFormPatch(r.c, { set: { printed_size: 286 } as never });
      // The card's colour is the printing's — never a frame stand-in's: its
      // one colour, its PAIR (the frame draws the pair's dress), or gold.
      const pair = frontFacePairFromScryfall(r.c);
      const { style, colorIdentity } = importedAnatomy(patch, "dossier");
      expect(colorIdentity, r.key).toEqual(pair ? [...pair].map((l) => IDENTITY_OF[l]) : frameColorsFromScryfall(r.c));
      const saved = normalizeAnatomy({ ...style, template: "dossier" }, "dossier", patch.card_type ?? "creature");
      // Every legendary printing wears the crown; no other does.
      const legendary = (r.c.frame_effects ?? []).includes("legendary");
      if (legendary) legends += 1;
      expect(patch.printed_crown === true, r.key).toBe(legendary);
      expect(saved.crown === true, r.key).toBe(legendary);
      // A two-colour card prints its pair's split.
      const twoColour = (r.c.colors ?? []).length === 2;
      if (twoColour) pairs += 1;
      expect(saved.twoColor === true, r.key).toBe(twoColour);
      // The oval on a rare or mythic, none on an uncommon.
      const rare = r.c.rarity === "rare" || r.c.rarity === "mythic";
      expect(saved.stamp, r.key).toBe(rare ? "oval" : "none");
      if (rare) stamped += 1;
      expect(saved.collector, r.key).toBe("2023");
    }
    expect(stamped).toBe(45);
    expect(legends).toBe(31);
    expect(pairs).toBe(28);
    expect(frameAnatomyOf("dossier")).toMatchObject({ crown: true, twoColor: ["split"], collector: true, stamp: true });
  });

  it("the AI's random pool reaches the frame only once it is verified in the card's colour", () => {
    const pool = (verified: ReadonlySet<string>) => {
      const picks = new Set<string | null>();
      for (let i = 0; i < 400; i += 1) {
        picks.add(resolveGeneratedFrame({ cardType: "creature", requested: "random", colorIdentity: ["red"], verifiedKeys: verified, random: () => i / 400 }));
      }
      return picks;
    };
    const m15 = every("m15");
    expect(pool(m15).has("dossier")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("dossier", "w")])).has("dossier")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("dossier", "r")])).has("dossier")).toBe(true);
    // …and the options dialog offers it with no colour until one is ticked.
    const offered = (verified: ReadonlySet<string>) => frameChoicesForType("creature", verified).find((f) => f.template === "dossier");
    expect(offered(m15)?.availableColorKeys ?? []).toEqual([]);
    expect(offered(every("dossier"))?.availableColorKeys).toEqual(expect.arrayContaining([...KEYS]));
    // A request for it by name on a planeswalker or a battle never lands there.
    expect(resolveGeneratedFrame({ cardType: "planeswalker", requested: "dossier", colorIdentity: ["red"], verifiedKeys: new Set([...every("dossier"), ...every("m15pw")]), random: () => 0 })).toBe("m15pw");
  });
});
