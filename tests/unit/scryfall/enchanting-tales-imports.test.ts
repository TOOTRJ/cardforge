import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/enchanting-tales-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameColorsFromScryfall, frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { frameAnatomyOf, importedAnatomy, normalizeAnatomy } from "@/lib/cards/anatomy";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { frameChoicesForType, resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { templateRefusesKind } from "@/lib/creator/card-kinds";
import { frameRequestFromImport } from "@/lib/frames/frame-requests";
import { frameFitsImport, type ImportChooserPatch } from "@/lib/creator/import-frame-choice";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 2: the Enchanting Tales showcase's imports. The bonus sheet
// of Wilds of Eldraine, WOT #1–85 and #103 (fixtures/enchanting-tales-
// printings.json, captured 2026-10-27 and trimmed to what the import reads).
// WOT #1–63 — 63 printings, the Enchanting Tales storybook frame — land on
// `enchantingtales`: exact once the card's colour is verified, nearest until
// then. WOT #64–83 and their confetti-foil twins (#84 on) are the anime-style
// borderless reprints, another design: they keep their landing. The card's
// colour is the printing's, always; the stamp and the collector line follow
// the printing; no printing is legendary.
// ---------------------------------------------------------------------------

const printings = printingsData as Record<string, unknown>;
const card = (key: string) => scryfallCardSchema.parse(printings[key]);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const every = (template: FrameTemplate) => new Set(KEYS.map((k) => frameComboKey(template, k)));

const rows = Object.keys(printings).map((key) => {
  const c = card(key);
  return { key, c, n: Number(c.collector_number), match: frameMatchFromScryfall(c), colour: pickFrameColorKey(frameColorsFromScryfall(c)) };
});
const tales = rows.filter((r) => r.n >= 1 && r.n <= 63);
const anime = rows.filter((r) => r.n >= 64);

describe("the Enchanting Tales imports", () => {
  it("covers the run and the anime reprints: 63 Enchanting Tales printings, 23 anime ones", () => {
    expect(rows).toHaveLength(86);
    expect(tales).toHaveLength(63);
    expect(anime).toHaveLength(23);
    // Every one borderless, single-faced, mono-coloured, on the 2015 frame,
    // with the `showcase` effect; every one an enchantment (Auras and a
    // Kindred Enchantment among them), none legendary, none a creature.
    for (const r of tales) {
      expect([r.c.layout, r.c.border_color, r.c.frame], r.key).toEqual(["normal", "borderless", "2015"]);
      expect(r.c.frame_effects, r.key).toContain("showcase");
      expect(r.c.type_line, r.key).toMatch(/Enchantment/);
      expect(r.c.type_line, r.key).not.toMatch(/Legendary|Creature|Saga|Class|Case|Room/);
      expect(r.c.color_identity, r.key).toHaveLength(1);
    }
    expect(tales.filter((r) => /Aura/.test(r.c.type_line ?? "")).length).toBe(7);
    // The anime reprints carry no `showcase` effect.
    for (const r of anime) expect(r.c.frame_effects ?? [], r.key).not.toContain("showcase");
  });

  it("lands every Enchanting Tales printing on `enchantingtales`, exact, with no gap", () => {
    for (const r of tales) {
      expect(r.match.signature, r.key).toBe("showcase/wot/enchanting-tales");
      expect([r.match.status, r.match.template], r.key).toEqual(["exact", "enchantingtales"]);
      expect(r.match.landOn, r.key).toBeUndefined();
      expect(r.match.gaps ?? [], r.key).toEqual([]);
      expect(r.match.exactLabel, r.key).toBe("Wilds of Eldraine Enchanting Tales showcase");
    }
    // Auras and the Kindred Enchantment are the enchantment kind's dress.
    expect(templateRefusesKind("enchantingtales", "enchantment")).toBe(false);
    expect(templateRefusesKind("enchantingtales", "creature")).toBe(false);
    for (const kind of ["instant", "sorcery", "artifact", "land", "planeswalker", "battle", "token"] as const) expect(templateRefusesKind("enchantingtales", kind), kind).toBe(true);
  });

  it("the import chooser offers it to an enchantment and an Enchantment Creature only — never a plain or Artifact creature", () => {
    const verified = new Set([...every("enchantingtales"), ...every("m15"), ...every("m15artifact")]);
    const patch = (card_type: string, supertype: string | null) =>
      ({ kind: card_type, card_type, supertype, subtypes_text: "", title: "Test", rules_text: "", color_identity: ["blue"], frame_template: "m15", frame_match: null }) as unknown as ImportChooserPatch;
    expect(frameFitsImport("enchantingtales", { kind: "enchantment", verifiedKeys: verified, patch: patch("enchantment", null) })).toBe(true);
    expect(frameFitsImport("enchantingtales", { kind: "creature", verifiedKeys: verified, patch: patch("creature", "Enchantment") })).toBe(true);
    expect(frameFitsImport("enchantingtales", { kind: "creature", verifiedKeys: verified, patch: patch("creature", null) })).toBe(false);
    expect(frameFitsImport("enchantingtales", { kind: "creature", verifiedKeys: verified, patch: patch("creature", "Artifact") })).toBe(false);
  });

  it("leaves the anime reprints where they were", () => {
    for (const r of anime) {
      expect(r.match.template, r.key).not.toBe("enchantingtales");
      expect(r.match.signature, r.key).not.toBe("showcase/wot/enchanting-tales");
    }
  });

  it("is nearest until the card's colour is verified, exact once it is — and logs the ask until then", () => {
    for (const key of ["wot-1", "wot-8", "wot-25", "wot-27", "wot-40", "wot-63"]) {
      const raw = mapScryfallToFormPatch(card(key));
      const colour = pickFrameColorKey(raw.color_identity ?? []);
      const none = finalizeImportMatch(raw, new Set([frameComboKey("m15", colour)]));
      expect([none.frame_template, none.frame_match?.status], key).toEqual(["enchantingtales", "nearest"]);
      expect(frameRequestFromImport(none, { artImported: true, source: "import", verifiedKeys: new Set() }), key).toMatchObject({ signature: "showcase/wot/enchanting-tales", status: "nearest" });
      const other = finalizeImportMatch(raw, new Set([frameComboKey("enchantingtales", colour === "w" ? "u" : "w")]));
      expect(other.frame_match?.status, key).toBe("nearest");
      const ticked = new Set([frameComboKey("enchantingtales", colour)]);
      const exact = finalizeImportMatch(raw, ticked);
      expect([exact.frame_template, exact.frame_match?.status], key).toEqual(["enchantingtales", "exact"]);
      expect(frameRequestFromImport(exact, { artImported: true, source: "import", verifiedKeys: ticked }), key).toBeNull();
    }
  });

  it("keeps the printing's colour, no crown, the stamp and the 2023 collector line as printed", () => {
    let stamped = 0;
    for (const r of tales) {
      const patch = mapScryfallToFormPatch(r.c, { set: { printed_size: 63 } as never });
      expect(patch.color_identity, r.key).toEqual(frameColorsFromScryfall(r.c));
      const { style, colorIdentity } = importedAnatomy(patch, "enchantingtales");
      expect(colorIdentity, r.key).toEqual(patch.color_identity);
      const saved = normalizeAnatomy({ ...style, template: "enchantingtales" }, "enchantingtales", patch.card_type ?? "enchantment");
      expect("crown" in saved, r.key).toBe(false);
      expect("twoColor" in saved, r.key).toBe(false);
      // The oval on a rare or mythic, none on an uncommon (the run has no common).
      const rare = r.c.rarity === "rare" || r.c.rarity === "mythic";
      expect(r.c.security_stamp ?? null, r.key).toBe(rare ? "oval" : null);
      expect(saved.stamp, r.key).toBe(rare ? "oval" : "none");
      if (rare) stamped += 1;
      expect(saved.collector, r.key).toBe("2023");
    }
    expect(stamped).toBe(45);
    expect(frameAnatomyOf("enchantingtales")).toMatchObject({ crown: false, twoColor: [], collector: true, stamp: true });
  });

  it("the AI's random pool reaches the frame only once it is verified in the card's colour", () => {
    const pool = (verified: ReadonlySet<string>) => {
      const picks = new Set<string | null>();
      for (let i = 0; i < 400; i += 1) {
        picks.add(resolveGeneratedFrame({ cardType: "enchantment", requested: "random", colorIdentity: ["blue"], verifiedKeys: verified, random: () => i / 400 }));
      }
      return picks;
    };
    const m15 = every("m15");
    expect(pool(m15).has("enchantingtales")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("enchantingtales", "w")])).has("enchantingtales")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("enchantingtales", "u")])).has("enchantingtales")).toBe(true);
    // …and the options dialog offers it with no colour until one is ticked.
    const offered = (verified: ReadonlySet<string>) => frameChoicesForType("enchantment", verified).find((f) => f.template === "enchantingtales");
    expect(offered(m15)?.availableColorKeys ?? []).toEqual([]);
    expect(offered(every("enchantingtales"))?.availableColorKeys).toEqual(expect.arrayContaining([...KEYS]));
    // A request for it by name on an instant never lands there (enchantment dress).
    expect(resolveGeneratedFrame({ cardType: "instant", requested: "enchantingtales", colorIdentity: ["blue"], verifiedKeys: new Set([...every("enchantingtales"), ...every("m15")]), random: () => 0 })).not.toBe("enchantingtales");
  });
});
