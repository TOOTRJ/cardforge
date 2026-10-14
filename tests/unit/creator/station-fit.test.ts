import { describe, expect, it } from "vitest";
import printed from "../ai/fixtures/station-printed.json";
import {
  stationCutBands,
  stationCutNote,
  stationCutOf,
  stationFitLayout,
  stationOverLimit,
  stationOverLimitNote,
  type StationFitCard,
} from "@/lib/creator/station-fit";
import { STATION_ROW_MAX_CHARS } from "@/lib/cards/station";
import { cardStationLayout } from "@/lib/cards/station-layout";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { M15_HOLO_STAMP_KEEP_OUT } from "@/lib/cards/holo-stamp";
import { stationReminder } from "@/lib/creator/station-rows";
import { submittedRulesOf } from "@/lib/creator/structured-rules";
import { faceContentSchema } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// The tier editor's two notes (TODO 4.27a, PR 3; owner round 58, decision 2
// and the independent check of #549) — read from the station layout both
// renderers draw and from the save's own rule. No renderer reads them.
// ---------------------------------------------------------------------------

const REMINDER = stationReminder("Spacecraft", 9);
const ship = (rulesText: string, over: Partial<StationFitCard> = {}): StationFitCard => ({
  template: "m15station",
  frameStyle: { stamp: "auto" },
  cardType: "artifact",
  subtypes: ["Spacecraft"],
  colorIdentity: ["blue"],
  cost: "{2}{U}",
  rarity: "common",
  rulesText,
  power: "4",
  toughness: "5",
  ...over,
});
const sentence = "Whenever this Spacecraft attacks, draw a card, then discard a card.";
const words = (count: number) => Array.from({ length: count }, () => sentence).join(" ");

describe("text that does not fit its bands", () => {
  it("no printed card is cut — common or stamped rare", () => {
    for (const card of printed) {
      const planet = card.type_line.includes("Planet");
      for (const rarity of ["common", "mythic"]) {
        const cut = stationCutOf({
          template: planet ? "m15stationland" : "m15station",
          frameStyle: { stamp: "auto" },
          cardType: planet ? "land" : "artifact",
          subtypes: [planet ? "Planet" : "Spacecraft"],
          colorIdentity: [],
          rarity,
          rulesText: card.oracle_text,
          power: card.power,
          toughness: card.toughness,
        });
        expect(cut, `${card.name} (${rarity})`).toBeNull();
      }
    }
  });

  it("reads REAL cut text, not the layout's wider `clipped` flag (too little air, nothing cut)", () => {
    // Grow one tier's text a sentence at a time. Somewhere the layout stops
    // finding a size with its minimum air and says `clipped` while every
    // line is still inside its band — no note there; further on the text is
    // really cut, and the note names the band.
    const seen = { airOnly: 0, cut: 0 };
    let firstCut: number | null = null;
    for (let n = 1; n <= 40; n += 1) {
      const card = ship(`${REMINDER}\n2+ | Scry 1.\n9+ | Flying\n${words(n)}`);
      const layout = stationFitLayout(card)!;
      const cut = stationCutBands(layout);
      if (layout.clipped && !cut) seen.airOnly += 1;
      if (cut) {
        seen.cut += 1;
        firstCut ??= n;
        expect(layout.clipped).toBe(true);
      }
      // Once cut, more text is never un-cut.
      if (firstCut !== null) expect(cut, `${n} sentences`).not.toBeNull();
    }
    expect(seen.airOnly).toBeGreaterThan(0);
    expect(seen.cut).toBeGreaterThan(0);
  });

  it("names the bands that are cut: a tier, the top band, both", () => {
    const tier = stationCutOf(ship(`${REMINDER}\n2+ | Scry 1.\n9+ | Flying\n${words(40)}`))!;
    expect(tier.tiers).toContain(1);
    expect(stationCutNote({ top: false, tiers: [1] }, [2, 9])).toBe(
      "This text doesn't fit: the card cuts off the end of tier 2 (9+). Shorten it, or move text to another band.",
    );
    expect(stationCutNote({ top: true, tiers: [] }, [2, 9])).toContain("the end of the top band. Shorten it");
    expect(stationCutNote({ top: true, tiers: [1] }, [2, 9])).toContain("the top band and tier 2 (9+). Shorten them");
    // More text than the whole box: every band's end is cut — said once.
    expect(stationCutNote({ top: true, tiers: [0, 1] }, [2, 9])).toBe(
      "This text doesn't fit: the card has more text than its box holds, so the end of every band is cut off. Shorten the text.",
    );
    const top = stationCutOf(ship(`${words(40)}\n${REMINDER}\n9+ | Flying`))!;
    expect(top.top).toBe(true);
  });

  it("is the layout both renderers draw: the same P/T tier, flavour text and stamp", () => {
    const text = `${REMINDER}\n2+ | Scry 1.\n9+ | Flying`;
    const profile = getFrameProfile("m15station");
    const face = { cardType: "artifact" as const, subtypes: ["Spacecraft"], rulesText: text, flavorText: "Cold light.", power: "4", toughness: "5" };
    // A common: no stamp. A mythic with the stamp on "auto": the arch.
    expect(stationFitLayout(ship(text, { flavorText: "Cold light." }))).toEqual(cardStationLayout(profile, face, null));
    expect(stationFitLayout(ship(text, { flavorText: "Cold light.", rarity: "mythic" }))).toEqual(cardStationLayout(profile, face, M15_HOLO_STAMP_KEEP_OUT));
    expect(stationFitLayout(ship(text, { rarity: "mythic", frameStyle: { stamp: "none" } }))!.bands).toEqual(stationFitLayout(ship(text))!.bands);
    // The maker's tier carries the plate (a float of that tier).
    expect(stationFitLayout(ship(text, { ptTier: 0 }))!.plate!.y0).toBeLessThan(stationFitLayout(ship(text))!.plate!.y0);
    // A Planet has no plate.
    expect(stationFitLayout(ship(`${stationReminder("Planet", null)}\n12+ | {T}: Add {G}{G}.`, { template: "m15stationland", cardType: "land", subtypes: ["Planet"], power: null, toughness: null }))!.plate).toBeNull();
  });

  it("nothing off the station frames", () => {
    for (const template of ["m15artifact", "m15vehicle", "m15", null, undefined]) {
      expect(stationFitLayout(ship(`${REMINDER}\n9+ | ${words(60)}`, { template }))).toBeNull();
      expect(stationCutOf(ship(`${REMINDER}\n9+ | ${words(60)}`, { template }))).toBeNull();
    }
  });
});

describe("a band over the row limit (the silent drop)", () => {
  const long = "x".repeat(STATION_ROW_MAX_CHARS + 1);
  const exact = "x".repeat(STATION_ROW_MAX_CHARS);
  const values = (rules_text: string, station_pt_tier: number | null = null) => ({ rules_text, station_pt_tier, loyalty_abilities: [], saga_intro: "", saga_chapters: [] });

  it("is exactly the save's rule: at the limit the rows are written, one character over they are not", () => {
    for (const [text, over] of [
      [`${REMINDER}\n2+ | ${exact}\n9+ | Flying`, false],
      [`${REMINDER}\n2+ | ${long}\n9+ | Flying`, true],
      [`${exact}\n9+ | Flying`, false],
      [`${long}\n9+ | Flying`, true],
    ] as const) {
      const saved = submittedRulesOf("artifact", values(text), { stationFrame: true });
      expect(saved.faceContent === null, text.slice(0, 40)).toBe(over);
      expect(stationOverLimit(text, null, true) !== null, text.slice(0, 40)).toBe(over);
      if (!over) expect(faceContentSchema.safeParse(saved.faceContent).success).toBe(true);
    }
  });

  it("says which band, and that the P/T pick is lost — only when it would be", () => {
    const text = `${REMINDER}\n2+ | ${long}\n9+ | Flying`;
    // The text plates 9+ (tier 2); the maker picked tier 1.
    const picked = stationOverLimit(text, 0, true)!;
    expect(picked).toEqual({ bands: ["Tier 1 (2+)"], moves: { choice: 0, textTier: 1 } });
    expect(stationOverLimitNote(picked, [2, 9])).toBe(
      "Tier 1 (2+) is over 600 characters: this card saves its tiers as lines of text. It prints the same bands — but the power / toughness goes back to tier 2 (9+), the tier the text names, not the one picked here. Shorten the text to keep your pick.",
    );
    // …and the save really does that (main did, without a word).
    const saved = submittedRulesOf("artifact", values(text, 0), { stationFrame: true });
    expect(saved).toEqual({ rulesText: text, faceContent: null });
    // The pick the text makes anyway, or none: nothing is lost.
    for (const choice of [null, 1]) {
      const same = stationOverLimit(text, choice, true)!;
      expect(same.moves).toBeNull();
      expect(stationOverLimitNote(same, [2, 9])).toBe("Tier 1 (2+) is over 600 characters: this card saves its tiers as lines of text. It prints the same bands.");
    }
    // A Planet shows no P/T.
    expect(stationOverLimit(text, 0, false)!.moves).toBeNull();
    // Two bands.
    expect(stationOverLimitNote(stationOverLimit(`${long}\n2+ | ${long}`, null, true)!, [2])).toContain("The top band and Tier 1 (2+) are over 600 characters");
  });

  it("nothing for a text inside the limit, or with no tier (it saves as plain text anyway)", () => {
    expect(stationOverLimit(`${REMINDER}\n9+ | Flying`, 0, true)).toBeNull();
    expect(stationOverLimit(long, null, true)).toBeNull();
    expect(stationOverLimit("", null, true)).toBeNull();
  });
});

describe("a Planet's rows mark no tier (the independent check of #549)", () => {
  const text = `This land enters tapped.\n{T}: Add {G}.\n${stationReminder("Planet", null)}\n12+ | {G}, {T}: Add {G}{G}.`;
  const values = { rules_text: text, station_pt_tier: null, loyalty_abilities: [], saga_intro: "", saga_chapters: [] };

  it("no `pt: true` on a card that shows no power / toughness; a Spacecraft keeps its plate", () => {
    const planet = submittedRulesOf("land", values, { stationFrame: true, stationShowsPt: false });
    expect(planet.faceContent!.station!.tiers).toEqual([{ threshold: 12, text: "{G}, {T}: Add {G}{G}." }]);
    // Main's row, for the record: the option absent.
    expect(submittedRulesOf("land", values, { stationFrame: true }).faceContent!.station!.tiers[0]).toMatchObject({ pt: true });
    const craft = submittedRulesOf("artifact", { ...values, rules_text: `${REMINDER}\n9+ | Flying` }, { stationFrame: true, stationShowsPt: true });
    expect(craft.faceContent!.station!.tiers).toEqual([{ threshold: 9, text: "Flying", pt: true }]);
  });

  it("an untouched edit still keeps what is stored, byte for byte", () => {
    const stored = { v: 1 as const, station: { intro: null, tiers: [{ threshold: 12, text: "x", pt: true as const }] } };
    const kept = submittedRulesOf("land", values, { stationFrame: true, stationShowsPt: false, opened: values, storedFaceContent: stored, storedRulesText: text });
    expect(kept).toEqual({ rulesText: text, faceContent: stored, keepsStored: true });
  });
});
