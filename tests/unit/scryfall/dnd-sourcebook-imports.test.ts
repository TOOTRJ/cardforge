import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/dnd-sourcebook-printings.json";
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
// TODO 4.11 wave 2: the D&D Sourcebook showcase's imports. Every printing of
// the showcase runs of Adventures in the Forgotten Realms (AFR #299–358) and
// Battle for Baldur's Gate (CLB #375–450), and the four printings either side
// of them (fixtures/dnd-sourcebook-printings.json, captured 2026-10-27 and
// trimmed to what the import reads). AFR #299–349 and CLB #375–450 — 127
// printings — land on `dndsourcebook`: exact once the card's colour is
// verified, nearest until then. AFR #350–358 print the 'Dungeon Module'
// cover (another design) and stay `showcase`, as before. The card's colour
// is the printing's, always; the legends' crown is off (none prints); the
// stamp and the collector line follow the printing.
// ---------------------------------------------------------------------------

const printings = printingsData as Record<string, unknown>;
const card = (key: string) => scryfallCardSchema.parse(printings[key]);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const every = (template: FrameTemplate) => new Set(KEYS.map((k) => frameComboKey(template, k)));
const isSourcebook = (set: string, n: number) => (set === "afr" && n >= 299 && n <= 349) || (set === "clb" && n >= 375 && n <= 450);

const rows = Object.keys(printings).map((key) => {
  const c = card(key);
  return { key, c, n: Number(c.collector_number), match: frameMatchFromScryfall(c), colour: pickFrameColorKey(frameColorsFromScryfall(c)) };
});
const sourcebook = rows.filter((r) => isSourcebook(r.c.set ?? "", r.n));

describe("the D&D Sourcebook imports", () => {
  it("covers both showcase runs and their neighbours: 127 sourcebook printings, AFR's nine module lands, four neighbours", () => {
    expect(rows).toHaveLength(140);
    expect(sourcebook).toHaveLength(127);
    expect(sourcebook.filter((r) => r.c.set === "afr")).toHaveLength(51);
    expect(sourcebook.filter((r) => r.c.set === "clb")).toHaveLength(76);
    // Every one single-faced, black-bordered, on the 2015 frame, with the
    // `showcase` effect — and no walker, token or layout card among them.
    for (const r of sourcebook) {
      expect([r.c.layout, r.c.border_color, r.c.frame], r.key).toEqual(["normal", "black", "2015"]);
      expect(r.c.frame_effects, r.key).toContain("showcase");
      expect(r.c.type_line, r.key).not.toMatch(/Planeswalker|Token|Battle|Saga/);
    }
  });

  it("lands every sourcebook printing on `dndsourcebook`, exact, with no gap — whatever its colours", () => {
    for (const r of sourcebook) {
      expect(r.match.signature, r.key).toBe("showcase/afr/sourcebook");
      expect([r.match.status, r.match.template], r.key).toEqual(["exact", "dndsourcebook"]);
      expect(r.match.landOn, r.key).toBeUndefined();
      expect(r.match.gaps ?? [], r.key).toEqual([]);
    }
    // Two- and three-colour legends print the same page (AFR #336 Barrowin,
    // CLB #415 Bane …): exact too.
    expect(sourcebook.filter((r) => r.colour === "m").length).toBeGreaterThan(30);
    expect(sourcebook.find((r) => r.key === "clb-415")!.match.exactLabel).toBe("Battle for Baldur's Gate D&D Sourcebook showcase");
    expect(sourcebook.find((r) => r.key === "afr-299")!.match.exactLabel).toBe("Adventures in the Forgotten Realms D&D Sourcebook showcase");
  });

  it("leaves the 'Dungeon Module' lands and the neighbours where they were", () => {
    for (const r of rows.filter((x) => x.c.set === "afr" && x.n >= 350 && x.n <= 358)) {
      expect([r.match.signature, r.match.status], r.key).toEqual(["showcase", "nearest"]);
      expect(r.match.template, r.key).not.toBe("dndsourcebook");
    }
    for (const key of ["afr-298", "afr-359", "clb-374", "clb-451"]) {
      const r = rows.find((x) => x.key === key)!;
      expect(r.match.template, key).not.toBe("dndsourcebook");
      expect(r.match.signature, key).not.toBe("showcase/afr/sourcebook");
    }
  });

  it("is nearest until the card's colour is verified, exact once it is — and logs the ask until then", () => {
    for (const key of ["afr-299", "afr-305", "afr-336", "afr-348", "clb-397", "clb-415", "clb-442"]) {
      const raw = mapScryfallToFormPatch(card(key));
      const colour = pickFrameColorKey(raw.color_identity ?? []);
      const none = finalizeImportMatch(raw, new Set([frameComboKey("m15", colour)]));
      expect([none.frame_template, none.frame_match?.status], key).toEqual(["dndsourcebook", "nearest"]);
      expect(frameRequestFromImport(none, { artImported: true, source: "import", verifiedKeys: new Set() }), key).toMatchObject({ signature: "showcase/afr/sourcebook", status: "nearest" });
      const other = finalizeImportMatch(raw, new Set([frameComboKey("dndsourcebook", colour === "w" ? "u" : "w")]));
      expect(other.frame_match?.status, key).toBe("nearest");
      const ticked = new Set([frameComboKey("dndsourcebook", colour)]);
      const exact = finalizeImportMatch(raw, ticked);
      expect([exact.frame_template, exact.frame_match?.status], key).toEqual(["dndsourcebook", "exact"]);
      expect(frameRequestFromImport(exact, { artImported: true, source: "import", verifiedKeys: ticked }), key).toBeNull();
    }
  });

  it("keeps the printing's colour, the crown off on a legend, the stamp and the 2015 collector line as printed", () => {
    let stamped = 0;
    let legends = 0;
    for (const r of sourcebook) {
      const patch = mapScryfallToFormPatch(r.c, { set: { printed_size: 281 } as never });
      // The card's colour is the printing's — never a frame stand-in's.
      expect(patch.color_identity, r.key).toEqual(frameColorsFromScryfall(r.c));
      const { style, colorIdentity } = importedAnatomy(patch, "dndsourcebook");
      expect(colorIdentity, r.key).toEqual(patch.color_identity);
      const saved = normalizeAnatomy({ ...style, template: "dndsourcebook" }, "dndsourcebook", patch.card_type ?? "creature");
      // No legend of the run prints a crown, and the frame draws none.
      if ((r.c.frame_effects ?? []).includes("legendary")) {
        legends += 1;
        expect(patch.printed_crown, r.key).toBe(false);
      }
      expect("crown" in saved, r.key).toBe(false);
      // No two-colour dress on the one page.
      expect("twoColor" in saved, r.key).toBe(false);
      // The oval on a rare or mythic, none on a common or uncommon.
      const rare = r.c.rarity === "rare" || r.c.rarity === "mythic";
      expect(saved.stamp, r.key).toBe(rare ? "oval" : "none");
      if (rare) stamped += 1;
      expect(saved.collector, r.key).toBe("2015");
    }
    expect(stamped).toBe(49);
    expect(legends).toBe(75);
    expect(frameAnatomyOf("dndsourcebook")).toMatchObject({ crown: false, twoColor: [], collector: true, stamp: true });
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
    expect(pool(m15).has("dndsourcebook")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("dndsourcebook", "w")])).has("dndsourcebook")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("dndsourcebook", "r")])).has("dndsourcebook")).toBe(true);
    // …and the options dialog offers it with no colour until one is ticked.
    const offered = (verified: ReadonlySet<string>) => frameChoicesForType("creature", verified).find((f) => f.template === "dndsourcebook");
    expect(offered(m15)?.availableColorKeys ?? []).toEqual([]);
    expect(offered(every("dndsourcebook"))?.availableColorKeys).toEqual(expect.arrayContaining([...KEYS]));
    // A request for it by name on a planeswalker or a battle never lands there.
    expect(resolveGeneratedFrame({ cardType: "planeswalker", requested: "dndsourcebook", colorIdentity: ["red"], verifiedKeys: new Set([...every("dndsourcebook"), ...every("m15pw")]), random: () => 0 })).toBe("m15pw");
  });
});
