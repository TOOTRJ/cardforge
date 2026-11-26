import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/dbl-double-feature-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameColorsFromScryfall, frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { FRAME_SIGNATURE_KEYS } from "@/lib/scryfall/frame-signatures";
import { importedAnatomy, normalizeAnatomy } from "@/lib/cards/anatomy";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { frameChoicesForType, resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { templateRefusesKind } from "@/lib/creator/card-kinds";
import { frameRequestFromImport } from "@/lib/frames/frame-requests";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.9 (its one-faced part): the Innistrad: Double Feature imports. The
// set's 437 one-faced printings and four of its transform cards
// (fixtures/dbl-double-feature-printings.json, captured from Scryfall on
// 2026-11-25 and trimmed to what the import reads): every one-faced
// creature, instant, sorcery, enchantment, artifact and land — 431 — keeps
// the `double-feature` signature and names the frame once it is verified in
// the card's colour (`doublefeature`, the land `doublefeatureland`): exact
// there, and until then nearest on the frame it always landed on. The five
// walkers, the one Vehicle (#427 Honeymoon Hearse) and the transform cards
// keep the old rule as it was (`double-feature/other`).
// ---------------------------------------------------------------------------

const printings = printingsData as Record<string, unknown>;
const card = (key: string) => scryfallCardSchema.parse(printings[key]);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const every = (template: FrameTemplate) => new Set(KEYS.map((k) => frameComboKey(template, k)));
const OLD_REASON = "PipGlyph doesn't have Double Feature's black-and-white frame yet";

const rows = Object.keys(printings).map((key) => {
  const c = card(key);
  return { key, c, match: frameMatchFromScryfall(c), colour: pickFrameColorKey(frameColorsFromScryfall(c)) };
});
const oneFaced = rows.filter((r) => r.c.layout === "normal");
const isWalker = (r: (typeof rows)[number]) => /Planeswalker/.test(r.c.type_line ?? "");
const eligible = oneFaced.filter((r) => !isWalker(r) && r.c.collector_number !== "427");
const rest = rows.filter((r) => !eligible.includes(r));

describe("the Innistrad: Double Feature imports", () => {
  it("covers the set: 437 one-faced printings — 431 on the frame — and four transform cards", () => {
    expect(oneFaced).toHaveLength(437);
    expect(eligible).toHaveLength(431);
    expect(oneFaced.filter(isWalker)).toHaveLength(5);
    expect(rows.filter((r) => r.c.layout === "transform")).toHaveLength(4);
    for (const r of rows) expect([r.c.set, r.c.border_color, r.c.frame], r.key).toEqual(["dbl", "black", "2015"]);
    expect(eligible.filter((r) => /Land/.test(r.c.type_line ?? ""))).toHaveLength(14);
  });

  it("puts the one-faced rule before the old one, both before every rule that called them exact", () => {
    const at = (key: string) => FRAME_SIGNATURE_KEYS.indexOf(key);
    expect(at("double-feature/other")).toBe(at("double-feature") + 1);
    expect(at("signature-spellbook")).toBe(at("double-feature/other") + 1);
    for (const later of ["transform/2015", "vehicle/2015", "era/2015"]) expect(at("double-feature/other"), later).toBeLessThan(at(later));
  });

  it("names the frame once verified for every one-faced card it dresses — nearest on today's landing until then", () => {
    for (const r of eligible) {
      const land = /Land/.test(r.c.type_line ?? "");
      expect(r.match, r.key).toMatchObject({
        signature: "double-feature",
        status: "nearest",
        onceVerified: land ? "doublefeatureland" : "doublefeature",
        onceVerifiedMatch: { status: "exact", reason: null },
        reason: "PipGlyph's Double Feature frame isn't verified yet",
        blockedBy: "5.9",
        exactLabel: "Innistrad: Double Feature black-and-white frame",
      });
      // Today's landing: the kind's M15 frame, as before.
      expect(["m15", "m15artifact", "m15land"], r.key).toContain(r.match.template);
    }
  });

  it("leaves the walkers, the Vehicle and the transform cards on the old rule, unchanged", () => {
    expect(rest).toHaveLength(10);
    for (const r of rest) {
      expect(r.match, r.key).toMatchObject({ signature: "double-feature/other", status: "nearest", reason: OLD_REASON, blockedBy: "4.11" });
      expect(r.match.onceVerified, r.key).toBeUndefined();
    }
    expect(frameMatchFromScryfall(card("dbl-427")).template).toBe("m15artifact");
    expect(frameMatchFromScryfall(card("dbl-2")).template).toBe("m15dfcfront");
  });

  it("is nearest until the card's colour is verified, exact once it is — and logs the ask until then", () => {
    const cases: [string, FrameTemplate, FrameTemplate][] = [
      ["dbl-1", "m15", "doublefeature"], // Adeline, white legend
      ["dbl-43", "m15", "doublefeature"], // Component Collector, blue
      ["dbl-216", "m15", "doublefeature"], // Dawnhart Wardens, G/W: gold
      ["dbl-23", "m15artifact", "doublefeature"], // Hedgewitch's Mask, a WHITE artifact
      ["dbl-252", "m15artifact", "doublefeature"], // The Celestus, colourless
      ["dbl-261", "m15land", "doublefeatureland"], // Evolving Wilds
      ["dbl-266", "m15land", "doublefeatureland"], // Rockfall Vale, R/G
    ];
    for (const [key, landing, frame] of cases) {
      const raw = mapScryfallToFormPatch(card(key));
      const colour = pickFrameColorKey(raw.color_identity ?? []);
      const standards = new Set([...every("m15"), ...every("m15artifact"), ...every("m15land")]);
      const none = finalizeImportMatch(raw, standards);
      expect([none.frame_template, none.frame_match?.status], key).toEqual([landing, "nearest"]);
      expect(frameRequestFromImport(none, { artImported: true, source: "import", verifiedKeys: standards }), key).toMatchObject({ signature: "double-feature", status: "nearest", template: landing });
      // Another colour ticked is not this one.
      const other = finalizeImportMatch(raw, new Set([...standards, frameComboKey(frame, colour === "w" ? "u" : "w")]));
      expect(other.frame_template, key).toBe(landing);
      const ticked = new Set([...standards, frameComboKey(frame, colour)]);
      const exact = finalizeImportMatch(raw, ticked);
      expect([exact.frame_template, exact.frame_match?.status], key).toEqual([frame, "exact"]);
      expect(frameRequestFromImport(exact, { artImported: true, source: "import", verifiedKeys: ticked }), key).toBeNull();
    }
  });

  it("keeps the printing's colour; a legend's crown on, a rare's oval stamp, a dual's split pinline", () => {
    let duals = 0;
    for (const r of eligible) {
      const land = /Land/.test(r.c.type_line ?? "");
      const template: FrameTemplate = land ? "doublefeatureland" : "doublefeature";
      const patch = mapScryfallToFormPatch(r.c);
      const { style } = importedAnatomy(patch, template);
      const saved = normalizeAnatomy({ ...style, template }, template, patch.card_type ?? "creature");
      expect(saved.crown === true, r.key).toBe(!land && (r.c.frame_effects ?? []).includes("legendary"));
      expect(saved.stamp === "oval" || saved.stamp === "auto", r.key).toBe(r.c.security_stamp === "oval");
      const dual = land && (r.c.color_identity ?? []).length === 2;
      if (dual) duals += 1;
      expect(saved.twoColor === true, r.key).toBe(dual);
    }
    expect(duals).toBe(10);
  });

  it("the frames dress the kinds the rule keeps to, the land frame the land alone", () => {
    for (const kind of ["creature", "instant", "sorcery", "enchantment", "artifact"] as const) expect(templateRefusesKind("doublefeature", kind), kind).toBe(false);
    for (const kind of ["land", "planeswalker", "battle", "token", "saga"] as const) expect(templateRefusesKind("doublefeature", kind), kind).toBe(true);
    expect(templateRefusesKind("doublefeatureland", "land")).toBe(false);
    for (const kind of ["creature", "instant", "artifact", "planeswalker"] as const) expect(templateRefusesKind("doublefeatureland", kind), kind).toBe(true);
  });

  it("the AI's random pool reaches the frame only once it is verified in the card's colour", () => {
    const pool = (verified: ReadonlySet<string>) => {
      const picks = new Set<string | null>();
      for (let i = 0; i < 400; i += 1) {
        picks.add(resolveGeneratedFrame({ cardType: "creature", requested: "random", colorIdentity: ["blue"], verifiedKeys: verified, random: () => i / 400 }));
      }
      return picks;
    };
    const m15 = every("m15");
    expect(pool(m15).has("doublefeature")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("doublefeature", "w")])).has("doublefeature")).toBe(false);
    expect(pool(new Set([...m15, frameComboKey("doublefeature", "u")])).has("doublefeature")).toBe(true);
    const offered = (verified: ReadonlySet<string>) => frameChoicesForType("creature", verified).find((f) => f.template === "doublefeature");
    expect(offered(m15)?.availableColorKeys ?? []).toEqual([]);
    expect(offered(every("doublefeature"))?.availableColorKeys).toEqual(expect.arrayContaining([...KEYS]));
    // A land asked for by name lands on the land frame's family, never the
    // spell frame.
    expect(resolveGeneratedFrame({ cardType: "land", requested: "doublefeature", colorIdentity: ["blue"], verifiedKeys: new Set([...every("doublefeature"), ...every("m15land")]), random: () => 0 })).not.toBe("doublefeature");
  });
});
