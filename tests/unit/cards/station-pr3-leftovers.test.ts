import { describe, expect, it } from "vitest";
import printed from "../ai/fixtures/station-printed.json";
import { parseStationText, resolveStationTiers, serializeStation } from "@/lib/cards/station";
import { withPrintTypographyUpdate } from "@/lib/validation/print-typography";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { submittedRulesOf } from "@/lib/creator/structured-rules";
import { frameRequestFromImport } from "@/lib/frames/frame-requests";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { showsPowerToughness } from "@/lib/cards/card-display";
import { parseSubtypes } from "@/lib/creator/card-fields";
import { faceContentSchema } from "@/lib/validation/card";
import { FRAME_TEMPLATE_VALUES, type CardType, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.27a, PR 3 — the leftovers the independent check of #549 reported,
// and the import of every printed station card.
// ---------------------------------------------------------------------------

describe("a tier line that ends in \\r (a text saved through the API with Windows line ends)", () => {
  const unix = "Flying\nStation\n3+ | Draw a card.\nScry 1.\n8+ | Flying";
  const windows = unix.replace(/\n/g, "\r\n");

  it("reads as the same tiers (main: a top band alone — no tier, no plate)", () => {
    expect(parseStationText(windows, true)).toEqual(parseStationText(unix, true));
    expect(parseStationText(windows, true).tiers).toEqual([
      { threshold: 3, text: "Draw a card.\nScry 1.", pt: false },
      { threshold: 8, text: "Flying", pt: true },
    ]);
    expect(resolveStationTiers(null, windows, true).intro).toBe("Flying\nStation");
    // A lone \r at the very end, too.
    expect(parseStationText("Station\n8+ | Flying\r").tiers).toEqual([{ threshold: 8, text: "Flying", pt: false }]);
  });

  it("a text with \\n line ends reads exactly as it did", () => {
    for (const card of printed) {
      const text = parseStationText(card.oracle_text, card.power !== null);
      expect(serializeStation(text.intro, text.tiers), card.name).toBe(card.oracle_text);
    }
  });
});

describe("a fourth tier line that becomes a tier of its own is not typeset (the maker never typed in it)", () => {
  // Stored as plain text with FOUR tier lines: the fourth sits in tier 3's
  // text as typed. Its maker removes tier 1 in the editor — the fourth line
  // is now tier 3, a box they never touched.
  const stored = {
    rules_text: 'Station\n2+ | "One" -- a.\n5+ | "Two" -- b.\n8+ | "Three" -- c.\n12+ | "Four" -- d.',
    face_content: null,
  };
  const afterRemove = {
    rules_text: 'Station\n5+ | "Two" -- b.\n8+ | "Three" -- c.\n12+ | "Four" -- d.',
    face_content: {
      v: 1,
      station: {
        intro: "Station",
        tiers: [
          { threshold: 5, text: '"Two" -- b.' },
          { threshold: 8, text: '"Three" -- c.' },
          { threshold: 12, text: '"Four" -- d.', pt: true },
        ],
      },
    },
  };

  it("every tier keeps its characters — the fourth line's too (main set it in print typography)", () => {
    const out = withPrintTypographyUpdate(afterRemove as never, stored as never) as unknown as typeof afterRemove;
    expect(out.face_content.station.tiers.map((tier) => tier.text)).toEqual(['"Two" -- b.', '"Three" -- c.', '"Four" -- d.']);
    expect(out.rules_text).toBe(afterRemove.rules_text);
  });

  it("a tier the maker DID type in is still typeset", () => {
    const edited = structuredClone(afterRemove);
    edited.face_content.station.tiers[2]!.text = '"Four" -- changed.';
    edited.rules_text = edited.rules_text.replace('"Four" -- d.', '"Four" -- changed.');
    const out = withPrintTypographyUpdate(edited as never, stored as never) as unknown as typeof afterRemove;
    expect(out.face_content.station.tiers.map((tier) => tier.text)).toEqual(['"Two" -- b.', '"Three" -- c.', "“Four” — changed."]);
  });
});

describe("the import of every printed station card (35) — bordered", () => {
  const EVERY: ReadonlySet<string> = new Set(
    FRAME_TEMPLATE_VALUES.flatMap((template) => ["w", "u", "b", "r", "g", "c", "m"].map((colour) => frameComboKey(template as FrameTemplate, colour))),
  );
  const NONE_OF_STATION: ReadonlySet<string> = new Set([...EVERY].filter((key) => !key.startsWith("m15station")));
  const asScryfall = (card: (typeof printed)[number], index: number) =>
    scryfallCardSchema.parse({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name: card.name,
      layout: card.layout,
      set: card.set,
      set_type: "expansion",
      collector_number: card.cn,
      released_at: "2025-08-01",
      frame: card.frame,
      frame_effects: [],
      border_color: "black",
      full_art: false,
      textless: false,
      keywords: card.keywords,
      type_line: card.type_line,
      mana_cost: card.mana_cost,
      colors: card.colors,
      color_identity: card.color_identity,
      oracle_text: card.oracle_text,
      ...(card.power !== null ? { power: card.power, toughness: card.toughness } : {}),
      rarity: card.rarity,
    });

  it("ticked: lands on the station frame, exact; the save writes its tiers as rows with the plate where print has it", () => {
    for (const [index, card] of printed.entries()) {
      const patch = finalizeImportMatch(mapScryfallToFormPatch(asScryfall(card, index)), EVERY);
      const planet = card.type_line.includes("Planet");
      expect(patch.frame_template, card.name).toBe(planet ? "m15stationland" : "m15station");
      expect(patch.frame_match, card.name).toMatchObject({ status: "exact", signature: "station/2015" });
      // No request row for an exact landing.
      expect(frameRequestFromImport(patch, { artImported: true, source: "import" }), card.name).toBeNull();
      // The creator's save of the imported card (a new card on the frame).
      const cardType = patch.card_type as CardType;
      const saved = submittedRulesOf(
        planet ? "land" : "artifact",
        { rules_text: patch.rules_text ?? "", station_pt_tier: null, loyalty_abilities: [], saga_intro: "", saga_chapters: [] },
        { stationFrame: true, stationShowsPt: showsPowerToughness(cardType, parseSubtypes(patch.subtypes_text ?? ""), patch.supertype) },
      );
      expect(saved.rulesText, card.name).toBe(card.oracle_text);
      expect(faceContentSchema.safeParse(saved.faceContent).success, card.name).toBe(true);
      const tiers = saved.faceContent!.station!.tiers;
      // A Spacecraft's rows plate its last tier (The Eternity Elevator, which
      // prints no P/T, draws no plate: the layout asks printsPowerToughness);
      // a Planet's mark none.
      expect(tiers.findIndex((tier) => tier.pt), card.name).toBe(planet ? -1 : tiers.length - 1);
      expect(resolveStationTiers(saved.faceContent, saved.rulesText, card.power !== null).tiers.filter((tier) => tier.pt).length, card.name).toBe(card.power !== null ? 1 : 0);
    }
  });

  it("not ticked: the artifact / land frame, nearest, 'not yet verified', and a row in the request log", () => {
    for (const [index, card] of printed.entries()) {
      const patch = finalizeImportMatch(mapScryfallToFormPatch(asScryfall(card, index)), NONE_OF_STATION);
      const planet = card.type_line.includes("Planet");
      expect(patch.frame_template, card.name).toBe(planet ? "m15land" : "m15artifact");
      expect(patch.frame_match, card.name).toMatchObject({ status: "nearest", signature: "station/2015", unverified: true });
      expect(frameRequestFromImport(patch, { artImported: true, source: "import" }), card.name).toMatchObject({ signature: "station/2015", cause: "unverified" });
      expect(patch.rules_text, card.name).toBe(card.oracle_text);
    }
  });
});
