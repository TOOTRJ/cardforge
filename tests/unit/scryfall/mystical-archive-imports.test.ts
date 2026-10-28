import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/mystical-archive-printings.json";
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
// TODO 4.11 wave 2: the Strixhaven Mystical Archive's imports. Every printing
// of STA (#1–63 English, #64–126 the Japanese alternate art) and sixteen of
// the 2026 Secrets of Strixhaven archive (SOA #1–65 English, inverted;
// #66–130 Japanese; #131–195 Japanese 'silverscroll'), captured 2026-10-27
// and trimmed to what the import reads (fixtures/mystical-archive-
// printings.json). STA #1–63 land on `mysticalarchive`: exact once the
// card's colour is verified, nearest until then. The Japanese run and SOA
// print other frames and stay on `borderless/mystical-archive`, as before.
// The card's colour is the printing's, always (a two-colour card keeps both
// and wears the pair dress); no crown prints; the stamp and the collector
// line follow the printing.
// ---------------------------------------------------------------------------

const printings = printingsData as Record<string, unknown>;
const card = (key: string) => scryfallCardSchema.parse(printings[key]);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const every = (template: FrameTemplate) => new Set(KEYS.map((k) => frameComboKey(template, k)));

const rows = Object.keys(printings).map((key) => {
  const c = card(key);
  return { key, c, n: Number(c.collector_number), match: frameMatchFromScryfall(c), colour: pickFrameColorKey(frameColorsFromScryfall(c)) };
});
const archive = rows.filter((r) => r.c.set === "sta" && r.n <= 63);

describe("the Mystical Archive imports", () => {
  it("covers STA whole and a sample of SOA: 63 English archive printings", () => {
    expect(rows).toHaveLength(142);
    expect(archive).toHaveLength(63);
    // Every one English, single-faced, borderless, on the 2015 frame, an
    // instant or a sorcery — none legendary.
    for (const r of archive) {
      expect([r.c.lang, r.c.layout, r.c.border_color, r.c.frame], r.key).toEqual(["en", "normal", "borderless", "2015"]);
      expect(r.c.type_line, r.key).toMatch(/^(Instant|Sorcery)$/);
    }
    expect(archive.filter((r) => (r.c.colors ?? []).length === 2).map((r) => r.n)).toEqual([59, 60, 61, 62, 63]);
  });

  it("lands every English STA printing on `mysticalarchive`, exact, with no gap", () => {
    for (const r of archive) {
      expect(r.match.signature, r.key).toBe("borderless/mystical-archive/sta");
      expect([r.match.status, r.match.template], r.key).toEqual(["exact", "mysticalarchive"]);
      expect(r.match.landOn, r.key).toBeUndefined();
      expect(r.match.gaps ?? [], r.key).toEqual([]);
      expect(r.match.exactLabel, r.key).toBe("Strixhaven Mystical Archive frame");
    }
  });

  it("leaves the Japanese run and the 2026 archive where they were", () => {
    const others = rows.filter((r) => !archive.includes(r));
    expect(others).toHaveLength(79);
    for (const r of others) {
      expect([r.match.signature, r.match.status], r.key).toEqual(["borderless/mystical-archive", "nearest"]);
      expect(r.match.template, r.key).not.toBe("mysticalarchive");
    }
  });

  it("is nearest until the card's colour is verified, exact once it is — and logs the ask until then", () => {
    for (const key of ["sta-1", "sta-12", "sta-27", "sta-42", "sta-50", "sta-60", "sta-62"]) {
      const raw = mapScryfallToFormPatch(card(key));
      const colour = pickFrameColorKey(raw.color_identity ?? []);
      const none = finalizeImportMatch(raw, new Set([frameComboKey("m15borderless", colour)]));
      expect([none.frame_template, none.frame_match?.status], key).toEqual(["mysticalarchive", "nearest"]);
      expect(frameRequestFromImport(none, { artImported: true, source: "import", verifiedKeys: new Set() }), key).toMatchObject({ signature: "borderless/mystical-archive/sta", status: "nearest" });
      const other = finalizeImportMatch(raw, new Set([frameComboKey("mysticalarchive", colour === "w" ? "u" : "w")]));
      expect(other.frame_match?.status, key).toBe("nearest");
      const ticked = new Set([frameComboKey("mysticalarchive", colour)]);
      const exact = finalizeImportMatch(raw, ticked);
      expect([exact.frame_template, exact.frame_match?.status], key).toEqual(["mysticalarchive", "exact"]);
      expect(frameRequestFromImport(exact, { artImported: true, source: "import", verifiedKeys: ticked }), key).toBeNull();
    }
  });

  it("keeps the printing's colour, the two-colour dress, the stamp and the 2015 collector line as printed", () => {
    let stamped = 0;
    let pairs = 0;
    for (const r of archive) {
      const patch = mapScryfallToFormPatch(r.c, { set: { printed_size: 63 } as never });
      // The card's colour is the printing's — never a frame stand-in's.
      expect(patch.color_identity, r.key).toEqual(frameColorsFromScryfall(r.c));
      const { style, colorIdentity } = importedAnatomy(patch, "mysticalarchive");
      // A two-colour printing keeps BOTH its colours (the frame draws the
      // pair), a mono one its colour.
      const names = { W: "white", U: "blue", B: "black", R: "red", G: "green" } as const;
      const printed = (r.c.colors ?? []).map((l) => names[l as keyof typeof names]);
      if (printed.length === 2) expect([...(colorIdentity ?? [])].sort(), r.key).toEqual([...printed].sort());
      else expect(colorIdentity, r.key).toEqual(patch.color_identity);
      const saved = normalizeAnatomy({ ...style, template: "mysticalarchive" }, "mysticalarchive", patch.card_type ?? "instant");
      // No crown on the frame (none prints; the run has no legend).
      expect("crown" in saved, r.key).toBe(false);
      // The five two-colour printings split their colour lines: the switch on.
      if ((r.c.colors ?? []).length === 2) {
        pairs += 1;
        expect(saved.twoColor, r.key).toBe(true);
      }
      // The oval on a rare or mythic, none on an uncommon.
      const rare = r.c.rarity === "rare" || r.c.rarity === "mythic";
      expect(saved.stamp, r.key).toBe(rare ? "oval" : "none");
      if (rare) stamped += 1;
      expect(saved.collector, r.key).toBe("2015");
    }
    expect(stamped).toBe(45);
    expect(pairs).toBe(5);
    expect(frameAnatomyOf("mysticalarchive")).toMatchObject({ crown: false, twoColor: ["split"], collector: true, stamp: true });
  });

  it("the AI's random pool reaches the frame only once it is verified in the card's colour", () => {
    const pool = (verified: ReadonlySet<string>) => {
      const picks = new Set<string | null>();
      for (let i = 0; i < 400; i += 1) {
        picks.add(resolveGeneratedFrame({ cardType: "instant", requested: "random", colorIdentity: ["blue"], verifiedKeys: verified, random: () => i / 400 }));
      }
      return picks;
    };
    const m15 = every("m15");
    expect(pool(m15).has("mysticalarchive")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("mysticalarchive", "w")])).has("mysticalarchive")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("mysticalarchive", "u")])).has("mysticalarchive")).toBe(true);
    // …and the options dialog offers it with no colour until one is ticked.
    const offered = (verified: ReadonlySet<string>) => frameChoicesForType("instant", verified).find((f) => f.template === "mysticalarchive");
    expect(offered(m15)?.availableColorKeys ?? []).toEqual([]);
    expect(offered(every("mysticalarchive"))?.availableColorKeys).toEqual(expect.arrayContaining([...KEYS]));
    // A request for it by name on a planeswalker or a battle never lands there.
    expect(resolveGeneratedFrame({ cardType: "planeswalker", requested: "mysticalarchive", colorIdentity: ["blue"], verifiedKeys: new Set([...every("mysticalarchive"), ...every("m15pw")]), random: () => 0 })).toBe("m15pw");
  });
});
