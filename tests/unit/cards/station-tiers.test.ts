import { describe, expect, it } from "vitest";
import oracle from "./fixtures/station-oracle.json";
import {
  STATION,
  STATION_MAX_TIERS,
  parseStationText,
  platedTierIndex,
  resolveStationTiers,
  serializeStation,
  stationBands,
  stationFromRulesText,
  stationTextSaysRows,
} from "@/lib/cards/station";
import { faceContentSchema } from "@/lib/validation/card";
import type { FaceContent } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.27a, step 1 — the station frame's tiers: the "N+ | text" grammar,
// held to the oracle text of all 36 station cards (Scryfall 2026-10-13: 31
// Spacecraft, 5 Planets), the structured rows read before the text, and the
// band arithmetic against print's measured rows.
// ---------------------------------------------------------------------------

describe("the tier grammar on every printed station card", () => {
  it("covers 31 Spacecraft and 5 Planets", () => {
    expect(oracle).toHaveLength(36);
    expect(oracle.filter((c) => c.type_line.includes("Planet"))).toHaveLength(5);
  });

  it.each(oracle.map((c) => [c.name, c] as const))("%s: tiers, top band, plate, and a byte-exact round trip", (_name, card) => {
    const hasPt = card.power !== null;
    const parsed = parseStationText(card.oracle_text, hasPt);
    const tierLines = card.oracle_text.split("\n").filter((l) => /^\d+\+ \|/.test(l));
    expect(parsed.tiers).toHaveLength(tierLines.length);
    expect(parsed.tiers.length).toBeGreaterThanOrEqual(1);
    expect(parsed.tiers.length).toBeLessThanOrEqual(2);
    // The top band holds the Station line and no tier line.
    expect(parsed.intro).toMatch(/^Station\b/m); // the three Arena cards print it without its reminder
    expect(parsed.intro).not.toMatch(/^\d+\+ \|/m);
    // Thresholds rise; every tier has text.
    parsed.tiers.forEach((t, i) => {
      expect(t.text.length).toBeGreaterThan(0);
      if (i > 0) expect(t.threshold).toBeGreaterThan(parsed.tiers[i - 1]!.threshold);
    });
    // The plate: none without a P/T; else the tier the reminder names — the last on every print.
    const plated = parsed.tiers.filter((t) => t.pt);
    expect(plated).toHaveLength(hasPt ? 1 : 0);
    if (hasPt) {
      expect(parsed.tiers[parsed.tiers.length - 1]!.pt).toBe(true);
      // The reminder names it; the three Arena cards print no reminder — the last tier is the fallback.
      if (card.oracle_text.includes("creature at")) expect(card.oracle_text).toContain(`creature at ${plated[0]!.threshold}+`);
    }
    // Text → rows → text is the oracle text, byte for byte.
    expect(serializeStation(parsed.intro, parsed.tiers)).toBe(card.oracle_text);
    // …and the rows pass the save's schema.
    const rows = stationFromRulesText(card.oracle_text, hasPt);
    expect(faceContentSchema.safeParse({ v: 1, station: rows }).success).toBe(true);
    expect(stationTextSaysRows(parsed.intro, parsed.tiers)).toBe(true);
  });

  it("later lines join the open tier (Sledge-Class Seedship: Flying + a second paragraph)", () => {
    const seedship = oracle.find((c) => c.name === "Sledge-Class Seedship")!;
    const { tiers } = parseStationText(seedship.oracle_text, true);
    expect(tiers).toEqual([{ threshold: 7, text: "Flying\nWhenever this Spacecraft attacks, you may put a creature card from your hand onto the battlefield.", pt: true }]);
  });
});

describe("shapes past print's", () => {
  it("no tier line: a top band alone (a Spacecraft with no tier)", () => {
    expect(parseStationText("Flying\nStation", true)).toEqual({ intro: "Flying\nStation", tiers: [] });
    expect(parseStationText(null)).toEqual({ intro: "", tiers: [] });
    expect(serializeStation("Flying", [])).toBe("Flying");
  });

  it("a text that starts with a tier has an empty top band", () => {
    expect(parseStationText("3+ | Flying", false)).toEqual({ intro: "", tiers: [{ threshold: 3, text: "Flying", pt: false }] });
  });

  it("a fourth tier line is never a fourth band: it stays in the third tier's text", () => {
    const parsed = parseStationText("1+ | a\n2+ | b\n3+ | c\n4+ | d", false);
    expect(parsed.tiers).toHaveLength(STATION_MAX_TIERS);
    expect(parsed.tiers[2]!.text).toBe("c\n4+ | d");
    expect(serializeStation(parsed.intro, parsed.tiers)).toBe("1+ | a\n2+ | b\n3+ | c\n4+ | d");
  });

  it("not a tier line: a cost, a three-digit number, 0+", () => {
    for (const line of ["+1: Draw a card.", "100+ | no", "0+ | no", "2 + | no", "Pay 2+ | no"]) {
      expect(parseStationText(line).tiers, line).toHaveLength(0);
    }
  });

  it("the plated tier of a plain text: the one the reminder names, else the last", () => {
    expect(platedTierIndex("Station (… artifact creature at 4+.)", [{ threshold: 4 }, { threshold: 9 }])).toBe(0);
    expect(platedTierIndex("Station", [{ threshold: 4 }, { threshold: 9 }])).toBe(1);
    expect(platedTierIndex("… creature at 7+.", [{ threshold: 4 }, { threshold: 9 }])).toBe(1);
  });
});

describe("structured rows are read before the text", () => {
  const rows: FaceContent = { v: 1, station: { intro: "Station", tiers: [{ threshold: 4, text: "First strike", pt: true }, { threshold: 9, text: "Flying" }] } };

  it("rows win over a rules_text that says something else", () => {
    expect(resolveStationTiers(rows, "9+ | other", true)).toEqual({
      intro: "Station",
      tiers: [{ threshold: 4, text: "First strike", pt: true }, { threshold: 9, text: "Flying", pt: false }],
    });
  });

  it("a plate on a tier the text would not plate is the rows' alone (no dual write from them)", () => {
    const resolved = resolveStationTiers(rows, null, true);
    expect(stationTextSaysRows(resolved.intro, resolved.tiers)).toBe(false);
  });

  it("no P/T on the card: no tier is plated, whatever the rows say", () => {
    expect(resolveStationTiers(rows, null, false).tiers.some((t) => t.pt)).toBe(false);
  });

  it("without rows the text's grammar draws the card", () => {
    expect(resolveStationTiers(null, "Station\n3+ | Flying", true).tiers).toEqual([{ threshold: 3, text: "Flying", pt: true }]);
    expect(resolveStationTiers({ v: 1 }, "Station\n3+ | Flying", false).tiers).toEqual([{ threshold: 3, text: "Flying", pt: false }]);
  });

  it("rows with no tier are a top band alone", () => {
    expect(resolveStationTiers({ v: 1, station: { intro: "Station", tiers: [] } }, "3+ | ignored", true)).toEqual({ intro: "Station", tiers: [] });
  });
});

describe("the save's schema", () => {
  const tier = (threshold: number, pt?: true) => ({ threshold, text: "Flying", ...(pt ? { pt } : {}) });
  const ok = (tiers: unknown[]) => faceContentSchema.safeParse({ v: 1, station: { intro: "Station", tiers } }).success;

  it("takes zero to three tiers and refuses a fourth", () => {
    expect(ok([])).toBe(true);
    expect(ok([tier(1), tier(2), tier(3, true)])).toBe(true);
    expect(ok([tier(1), tier(2), tier(3), tier(4)])).toBe(false);
  });

  it("refuses two plated tiers, thresholds that don't rise, 0 and 100", () => {
    expect(ok([tier(1, true), tier(2, true)])).toBe(false);
    expect(ok([tier(5), tier(5)])).toBe(false);
    expect(ok([tier(0)])).toBe(false);
    expect(ok([tier(100)])).toBe(false);
  });
});

describe("band rows against print (HD px)", () => {
  it("two one-line tiers under a four-line reminder: EOE #25's 1591 / 1759 within 1 px", () => {
    // 60 px text: a one-line block is one line box tall.
    const bands = stationBands(236, [60, 60]);
    expect(bands.tiers.map((b) => b.y0)).toEqual([1592, 1760]);
    expect(bands.tiers[1]!.cy).toBe(1848); // print's badge and plate: 1845.5–1846.5
    expect(bands.fits).toBe(true);
  });

  it("a taller tier grows its band; the top band takes the rest and says when it can't", () => {
    const bands = stationBands(100, [260]);
    expect(bands.tiers[0]).toMatchObject({ y0: STATION.box.bottom - 332, y1: STATION.box.bottom });
    expect(stationBands(400, [260]).fits).toBe(false);
  });

  it("no tier: the top band is the whole box; compact bands still hold a badge", () => {
    expect(stationBands(200, []).top).toMatchObject({ y0: STATION.box.top, y1: STATION.box.bottom });
    const compact = stationBands(0, [40, 40, 40], true);
    for (const b of compact.tiers) expect(b.y1 - b.y0).toBeGreaterThanOrEqual(2 * STATION.badge.rRing);
  });
});
