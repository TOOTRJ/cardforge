import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/stained-glass-printings.json";
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
// TODO 4.11 wave 2: the Dominaria United Stained Glass showcase's imports.
// Every printing of the run — DMU #287–368 (41 legends and their textured
// twins) and the nine Multiverse Legends Dominaria legends with their
// halo-foil and serialized twins — and ten printings beside it
// (fixtures/stained-glass-printings.json, captured 2026-10-27 and trimmed to
// what the import reads): DMU #286 (the set's regular frame), #369–371 (the
// Phyrexian-script Sheoldred, the two Ajani walkers), MUL #1 / #2 / #10 (the
// Tarkir, Theros and Kaldheim showcases), MUL #70 / #120 / #140 (etched and
// a halo-foil twin of another plane). The run lands on `stainedglass`:
// exact once the card's colour is verified, nearest until then; the rest
// where they were. The card's colour is the printing's; the crown is ON
// (every printing is legendary and prints the dome); a two-colour printing
// switches the two-colour dress on; the stamp and the collector line follow
// the printing.
// ---------------------------------------------------------------------------

const printings = printingsData as Record<string, unknown>;
const card = (key: string) => scryfallCardSchema.parse(printings[key]);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const COLOR_NAME: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };
const every = (template: FrameTemplate) => new Set(KEYS.map((k) => frameComboKey(template, k)));
const MUL_RUN = new Set([5, 12, 19, 22, 24, 55, 56, 58, 59, 135, 142, 149, 152, 154, 185, 186, 188, 189]);
const isRun = (set: string, n: number) => (set === "dmu" && n >= 287 && n <= 368) || (set === "mul" && MUL_RUN.has(n));

const rows = Object.keys(printings).map((key) => {
  const c = card(key);
  return { key, c, n: Number.parseInt(c.collector_number ?? "", 10), match: frameMatchFromScryfall(c), colour: pickFrameColorKey(frameColorsFromScryfall(c)) };
});
const run = rows.filter((r) => isRun(r.c.set ?? "", r.n));

describe("the Stained Glass imports", () => {
  it("covers the run and its neighbours: 109 printings, ten beside them", () => {
    expect(rows).toHaveLength(119);
    expect(run).toHaveLength(109);
    expect(run.filter((r) => r.c.set === "dmu")).toHaveLength(82);
    expect(run.filter((r) => r.c.set === "mul")).toHaveLength(27);
    // Every one a black-bordered legendary creature on the 2015 frame, with
    // the `showcase` effect — no walker, colourless card, artifact or land.
    for (const r of run) {
      expect([r.c.layout, r.c.border_color, r.c.frame], r.key).toEqual(["normal", "black", "2015"]);
      expect(r.c.frame_effects, r.key).toContain("showcase");
      expect(r.c.type_line, r.key).toMatch(/^Legendary Creature — /);
      expect(r.colour, r.key).not.toBe("c");
    }
  });

  it("lands every printing of the run on `stainedglass`, exact, with no gap — whatever its colours", () => {
    for (const r of run) {
      expect(r.match.signature, r.key).toBe("showcase/dmu/stained-glass");
      expect([r.match.status, r.match.template], r.key).toEqual(["exact", "stainedglass"]);
      expect(r.match.landOn, r.key).toBeUndefined();
      expect(r.match.gaps ?? [], r.key).toEqual([]);
    }
    // Two-colour legends print the run's split box (the pair masters):
    // exact too (DMU #310 Radha R|G, MUL #56 Raff U|W …).
    expect(run.filter((r) => (r.c.colors ?? []).length === 2).length).toBe(72);
    expect(run.find((r) => r.key === "dmu-310")!.match.exactLabel).toBe("Dominaria United stained-glass showcase");
    expect(run.find((r) => r.key === "mul-56")!.match.exactLabel).toBe("Multiverse Legends Dominaria showcase (stained glass)");
  });

  it("leaves the neighbours where they were", () => {
    const expected: Record<string, string> = {
      "dmu-369": "showcase",
      "dmu-370": "showcase",
      "dmu-371": "showcase",
      "mul-1": "showcase/mul/tarkir",
      "mul-2": "showcase/thb/constellation",
      "mul-10": "showcase/mul",
      "mul-140": "showcase/mul",
    };
    for (const [key, signature] of Object.entries(expected)) {
      const r = rows.find((x) => x.key === key)!;
      expect(r.match.signature, key).toBe(signature);
      expect(r.match.template, key).not.toBe("stainedglass");
    }
    for (const key of ["dmu-286", "mul-70", "mul-120"]) {
      const r = rows.find((x) => x.key === key)!;
      expect(r.match.template, key).not.toBe("stainedglass");
      expect(r.match.signature, key).not.toBe("showcase/dmu/stained-glass");
    }
  });

  it("is nearest until the card's colour is verified, exact once it is — and logs the ask until then", () => {
    for (const key of ["dmu-287", "mul-12", "dmu-288", "dmu-291", "dmu-302", "dmu-310", "mul-189z"]) {
      const raw = mapScryfallToFormPatch(card(key));
      const colour = pickFrameColorKey(raw.color_identity ?? []);
      const none = finalizeImportMatch(raw, new Set([frameComboKey("m15", colour)]));
      expect([none.frame_template, none.frame_match?.status], key).toEqual(["stainedglass", "nearest"]);
      expect(frameRequestFromImport(none, { artImported: true, source: "import", verifiedKeys: new Set() }), key).toMatchObject({ signature: "showcase/dmu/stained-glass", status: "nearest" });
      const other = finalizeImportMatch(raw, new Set([frameComboKey("stainedglass", colour === "w" ? "u" : "w")]));
      expect(other.frame_match?.status, key).toBe("nearest");
      const ticked = new Set([frameComboKey("stainedglass", colour)]);
      const exact = finalizeImportMatch(raw, ticked);
      expect([exact.frame_template, exact.frame_match?.status], key).toEqual(["stainedglass", "exact"]);
      expect(frameRequestFromImport(exact, { artImported: true, source: "import", verifiedKeys: ticked }), key).toBeNull();
    }
  });

  it("keeps the printing's colour, the crown on, the two-colour dress on a pair, the stamp and the 2015 collector line as printed", () => {
    let stamped = 0;
    let pairs = 0;
    for (const r of run) {
      const patch = mapScryfallToFormPatch(r.c, { set: { printed_size: 281 } as never });
      // The card's colour is the printing's — never a frame stand-in's …
      expect(patch.color_identity, r.key).toEqual(frameColorsFromScryfall(r.c));
      const { style, colorIdentity } = importedAnatomy(patch, "stainedglass");
      // … and a pair saved on the frame keeps its two colours (the frame
      // draws the pair's dress, so the switch names the pair).
      if ((r.c.colors ?? []).length === 2) expect([...(colorIdentity ?? [])].sort(), r.key).toEqual((r.c.colors ?? []).map((l) => COLOR_NAME[l]).sort());
      else expect(colorIdentity, r.key).toEqual(patch.color_identity);
      const saved = normalizeAnatomy({ ...style, template: "stainedglass" }, "stainedglass", patch.card_type ?? "creature");
      // Every legend of the run prints the glass dome.
      expect(patch.printed_crown, r.key).toBe(true);
      expect(saved.crown, r.key).toBe(true);
      if ((r.c.colors ?? []).length === 2) {
        pairs += 1;
        expect(saved.twoColor, r.key).toBe(true);
      }
      const rare = r.c.rarity === "rare" || r.c.rarity === "mythic";
      expect(saved.stamp, r.key).toBe(rare ? "oval" : "none");
      if (rare) stamped += 1;
    }
    expect(pairs).toBe(72);
    expect(stamped).toBe(45);
    expect(frameAnatomyOf("stainedglass")).toMatchObject({ crown: true, twoColor: ["split"], collector: true, stamp: true });
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
    expect(pool(m15).has("stainedglass")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("stainedglass", "w")])).has("stainedglass")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("stainedglass", "r")])).has("stainedglass")).toBe(true);
    const offered = (verified: ReadonlySet<string>) => frameChoicesForType("creature", verified).find((f) => f.template === "stainedglass");
    expect(offered(m15)?.availableColorKeys ?? []).toEqual([]);
    expect(offered(every("stainedglass"))?.availableColorKeys).toEqual(expect.arrayContaining([...KEYS]));
    expect(resolveGeneratedFrame({ cardType: "planeswalker", requested: "stainedglass", colorIdentity: ["red"], verifiedKeys: new Set([...every("stainedglass"), ...every("m15pw")]), random: () => 0 })).toBe("m15pw");
  });
});
