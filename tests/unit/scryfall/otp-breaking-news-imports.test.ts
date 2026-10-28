import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/otp-breaking-news-printings.json";
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
// TODO 4.11 wave 2: the OTJ BREAKING NEWS showcase's imports. Every printing
// of OTJ's bonus sheet (OTP #1–80: the Breaking News run #1–65 and the
// textured-foil reprints #66–80) and a few neighbours (OTJ #1–2, #286, the
// OTJ borderless showcase #299–301, BIG #1–2) —
// fixtures/otp-breaking-news-printings.json, captured 2026-10-28 and trimmed
// to what the import reads. The 63 single-bodied printings of #1–65 land on
// `breakingnews`: exact once the card's colour is verified, nearest until
// then. #39 (a split card) and #50 (a planeswalker) keep their borderless
// landing under gaps of their own; the textured foils keep theirs. The
// card's colour is the printing's, always; the one legend's crown is ON on
// this frame only, a two-colour card's split dress ON, the stamp and the
// collector line follow the printing.
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
const inRun = (c: { set?: string | null; collector_number?: string | null }) => c.set === "otp" && Number(c.collector_number) <= 65;
const run = rows.filter((r) => inRun(r.c));
const single = run.filter((r) => !["39", "50"].includes(r.c.collector_number ?? ""));

describe("the OTJ Breaking News imports", () => {
  it("covers the run, the textured foils and the neighbours: 65 + 15 + 7 printings", () => {
    expect(rows).toHaveLength(87);
    expect(run).toHaveLength(65);
    expect(rows.filter((r) => r.c.set === "otp" && Number(r.c.collector_number) > 65)).toHaveLength(15);
    // Every one borderless on Scryfall, on the 2015 frame; 63 single-bodied.
    for (const r of run) expect([r.c.border_color, r.c.frame], r.key).toEqual(["borderless", "2015"]);
    for (const r of single) expect(r.c.layout, r.key).toBe("normal");
    expect(single.filter((r) => /Creature/.test(r.c.type_line ?? ""))).toEqual([]);
  });

  it("lands every single-bodied printing on `breakingnews`, exact, with no gap — two-colour, gold, artifact, Vehicle and land alike", () => {
    for (const r of single) {
      expect(r.match.signature, r.key).toBe("showcase/otp/breaking-news");
      expect([r.match.status, r.match.template], r.key).toEqual(["exact", "breakingnews"]);
      expect(r.match.landOn, r.key).toBeUndefined();
      expect(r.match.gaps ?? [], r.key).toEqual([]);
    }
    expect(single.filter((r) => r.colour === "m").length).toBe(25);
    expect(single[0].match.exactLabel).toBe("Outlaws of Thunder Junction Breaking News showcase");
  });

  it("keeps the split card and the walker on their borderless landing, nearest, under gaps of their own", () => {
    const split = rows.find((r) => r.key === "otp-39")!;
    expect([split.match.signature, split.match.status, split.match.template, split.match.blockedBy]).toEqual(["showcase/otp/breaking-news/split", "nearest", "split", "4.11"]);
    const oko = rows.find((r) => r.key === "otp-50")!;
    expect([oko.match.signature, oko.match.status, oko.match.template, oko.match.blockedBy]).toEqual(["showcase/otp/breaking-news/planeswalker", "nearest", "m15borderlesspw", "4.11"]);
  });

  it("leaves the textured foils and the neighbours where they were", () => {
    for (const r of rows.filter((x) => !inRun(x.c))) {
      expect(r.match.template, r.key).not.toBe("breakingnews");
      expect(r.match.signature, r.key).not.toMatch(/^showcase\/otp\//);
    }
    for (const key of ["otp-66", "otp-74", "otp-78"]) expect(rows.find((x) => x.key === key)!.match.signature, key).toBe("borderless/standard");
    expect(rows.find((x) => x.key === "otp-75")!.match.signature).toBe("borderless/layout");
    expect(rows.find((x) => x.key === "otj-299")!.match.signature).toBe("borderless/showcase");
  });

  it("is nearest until the card's colour is verified, exact once it is — and logs the ask until then", () => {
    for (const key of ["otp-1", "otp-10", "otp-20", "otp-29", "otp-34", "otp-40", "otp-61", "otp-63", "otp-64", "otp-65"]) {
      const raw = mapScryfallToFormPatch(card(key));
      const colour = pickFrameColorKey(raw.color_identity ?? []);
      const none = finalizeImportMatch(raw, new Set([frameComboKey("m15", colour), frameComboKey("m15artifact", colour), frameComboKey("m15land", colour)]));
      expect([none.frame_template, none.frame_match?.status], key).toEqual(["breakingnews", "nearest"]);
      expect(frameRequestFromImport(none, { artImported: true, source: "import", verifiedKeys: new Set() }), key).toMatchObject({ signature: "showcase/otp/breaking-news", status: "nearest" });
      const other = finalizeImportMatch(raw, new Set([frameComboKey("breakingnews", colour === "w" ? "u" : "w")]));
      expect(other.frame_match?.status, key).toBe("nearest");
      const ticked = new Set([frameComboKey("breakingnews", colour)]);
      const exact = finalizeImportMatch(raw, ticked);
      expect([exact.frame_template, exact.frame_match?.status], key).toEqual(["breakingnews", "exact"]);
      expect(frameRequestFromImport(exact, { artImported: true, source: "import", verifiedKeys: ticked }), key).toBeNull();
    }
  });

  it("keeps the printing's colour, the crown on the legend (this frame only), the two-colour dress on a pair, the stamp and the collector line as printed", () => {
    let stamped = 0;
    let legends = 0;
    let pairs = 0;
    for (const r of single) {
      const patch = mapScryfallToFormPatch(r.c, { set: { printed_size: 65 } as never });
      // The card's colour is the printing's — never a frame stand-in's: its
      // one colour, its PAIR (the frame draws the pair's dress), or gold.
      const pair = frontFacePairFromScryfall(r.c);
      const { style, colorIdentity } = importedAnatomy(patch, "breakingnews");
      expect(colorIdentity, r.key).toEqual(pair ? [...pair].map((l) => IDENTITY_OF[l]) : frameColorsFromScryfall(r.c));
      const saved = normalizeAnatomy({ ...style, template: "breakingnews" }, "breakingnews", patch.card_type ?? "instant");
      // The run's one legend wears the crown here, and nowhere else.
      const legendary = (r.c.frame_effects ?? []).includes("legendary");
      if (legendary) legends += 1;
      expect(saved.crown === true, r.key).toBe(legendary);
      if (legendary) {
        const elsewhere = importedAnatomy(patch, "m15artifact").style;
        expect(elsewhere.crown, r.key).toBe(false);
      }
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
    expect(stamped).toBe(43);
    expect(legends).toBe(1);
    expect(pairs).toBe(21);
    expect(frameAnatomyOf("breakingnews")).toMatchObject({ crown: true, twoColor: ["split"], collector: true, stamp: true });
  });

  it("the AI's random pool reaches the frame only once it is verified in the card's colour", () => {
    const pool = (cardType: string, verified: ReadonlySet<string>) => {
      const picks = new Set<string | null>();
      for (let i = 0; i < 400; i += 1) {
        picks.add(resolveGeneratedFrame({ cardType, requested: "random", colorIdentity: ["red"], verifiedKeys: verified, random: () => i / 400 }));
      }
      return picks;
    };
    const m15 = every("m15");
    for (const cardType of ["instant", "creature"]) {
      expect(pool(cardType, m15).has("breakingnews"), cardType).toBe(false);
      expect(pool(cardType, new Set([...m15, frameComboKey("breakingnews", "w")])).has("breakingnews"), cardType).toBe(false);
      expect(pool(cardType, new Set([...m15, frameComboKey("breakingnews", "r")])).has("breakingnews"), cardType).toBe(true);
    }
    // …and the options dialog offers it with no colour until one is ticked.
    const offered = (verified: ReadonlySet<string>) => frameChoicesForType("instant", verified).find((f) => f.template === "breakingnews");
    expect(offered(m15)?.availableColorKeys ?? []).toEqual([]);
    expect(offered(every("breakingnews"))?.availableColorKeys).toEqual(expect.arrayContaining([...KEYS]));
    // A request for it by name on a planeswalker or a battle never lands there.
    expect(resolveGeneratedFrame({ cardType: "planeswalker", requested: "breakingnews", colorIdentity: ["red"], verifiedKeys: new Set([...every("breakingnews"), ...every("m15pw")]), random: () => 0 })).toBe("m15pw");
  });
});
