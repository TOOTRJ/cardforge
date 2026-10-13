import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ptValue } from "@/lib/cards/stat-fit";
import { M15_HOLO_STAMP_KEEP_OUT } from "@/lib/cards/holo-stamp";
import { inkEntersRect } from "@/lib/cards/rules-layout";
import { STATION, parseStationText, type StationText } from "@/lib/cards/station";
import { stationDrawing, stationLayout, type StationLayout } from "@/lib/cards/station-layout";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { STATION_MEASURED } from "@/scripts/lib/station-2025.mjs";
import oracle from "./fixtures/station-oracle.json";

// The station frame's tiers layout (TODO 4.27a): one size for the whole box,
// bands from the text, every piece on even HD px — and the bands it gives
// the PRINTED cards against where the prints put them (30 cards measured,
// scripts/lib/station-2025.mjs). STATION_REPORT_FILE=<path> writes the table.

type OracleCard = { name: string; set: string; collector_number: string; type_line: string; oracle_text: string; power: string | null; toughness: string | null };
const CARDS = oracle as OracleCard[];
const PRINT = (STATION_MEASURED as { bands: { boundaries: Record<string, number[]>; unsure: string[] } }).bands;

const profileOf = (card: Pick<OracleCard, "type_line">) => getFrameProfile(card.type_line.startsWith("Land") ? "m15stationland" : "m15station");
const lay = (card: OracleCard, stamp: Rect | null = null): StationLayout => {
  const pt = card.power !== null && card.toughness !== null ? ptValue(card.power, card.toughness) : null;
  return stationLayout({ profile: profileOf(card), text: parseStationText(card.oracle_text, pt !== null), ptValue: pt, stamp });
};
const custom = (text: StationText, pt: string | null = null, stamp: Rect | null = null) =>
  stationLayout({ profile: getFrameProfile("m15station"), text, ptValue: pt, stamp });
const isEvenPx = (rect: Rect) =>
  [rect.leftPct * 15, rect.topPct * 21, (rect.leftPct + rect.widthPct) * 15, (rect.topPct + rect.heightPct) * 21].every((px) => Math.abs(px / 2 - Math.round(px / 2)) < 1e-6);

const REMINDER = "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)";

describe("the printed cards", () => {
  it("sets every one of the 36 without a clip, the size never under 46 px", () => {
    for (const card of CARDS) {
      const laid = lay(card);
      expect(laid.clipped, card.name).toBe(false);
      expect(laid.sizePx, card.name).toBeGreaterThanOrEqual(46);
      for (const [i, band] of laid.bands.tiers.entries()) {
        expect(band.y0 % 2, card.name).toBe(0);
        expect(band.y1 - band.y0, `${card.name} tier ${i}`).toBeGreaterThanOrEqual(2 * STATION.badge.rRing);
      }
    }
  });

  // EOE #249 Wurmwall Sweeper's measured 1666 is a 272 px band for the one
  // word "Flying" — every other one-line last band is 176–178 px; the read
  // caught something else. Listed, not chased, and out of the tolerances.
  const OUTLIERS = new Set(["eoe-249"]);

  it("puts the bands where print puts them: the median edge within 4 px, two in three within 10", () => {
    const rows: string[] = [];
    const deltas: number[] = [];
    for (const card of CARDS) {
      const id = `${card.set}-${card.collector_number}`;
      const print = PRINT.boundaries[id];
      if (!print) continue;
      const laid = lay(card);
      const ours = laid.bands.tiers.map((b) => b.y0);
      expect(ours.length, id).toBe(print.length);
      const delta = ours.map((y, i) => y - print[i]!);
      if (!PRINT.unsure.some((u) => u.startsWith(id)) && !OUTLIERS.has(id)) deltas.push(...delta.map(Math.abs));
      rows.push(`${id.padEnd(8)} ${String(laid.sizePx).padStart(2)} px rule ${laid.rule}  ours ${ours.join(" / ").padEnd(11)} print ${print.join(" / ").padEnd(11)} Δ ${delta.map((d) => (d > 0 ? `+${d}` : `${d}`)).join(" / ")}  ${card.name}`);
    }
    const sorted = [...deltas].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const within = (n: number) => sorted.filter((d) => d <= n).length;
    rows.push(`edges ${sorted.length}: median ${median}, ≤4 px ${within(4)}, ≤10 px ${within(10)}, max ${sorted[sorted.length - 1]}`);
    if (process.env.STATION_REPORT_FILE) fs.writeFileSync(process.env.STATION_REPORT_FILE, rows.join("\n"));
    expect(median).toBeLessThanOrEqual(4);
    expect(within(10) / sorted.length).toBeGreaterThanOrEqual(2 / 3);
    // The widest: EOE #241 The Eternity Elevator, +70 — print gives its
    // three-line tier 315 px where the rule gives 248 (a smaller size or
    // more air there; not readable off a scan at half our size).
    expect(sorted[sorted.length - 1]).toBeLessThanOrEqual(70);
  });

  it("plates the tier the reminder names, at its band's centre, the lines clear of it — and no Planet", () => {
    for (const card of CARDS) {
      const laid = lay(card);
      if (card.power === null) {
        expect(laid.plate, card.name).toBeNull();
        continue;
      }
      const plated = parseStationText(card.oracle_text, true).tiers.findIndex((t) => t.pt);
      const band = laid.bands.tiers[plated]!;
      expect(laid.plate, card.name).not.toBeNull();
      expect(Math.abs((laid.plate!.y0 + laid.plate!.y1) / 2 - band.cy), card.name).toBeLessThanOrEqual(1);
      const text = laid.tiers[plated]!.text;
      const rect: Rect = { leftPct: (laid.plate!.x0 / 1500) * 100, topPct: (laid.plate!.y0 / 2100) * 100, widthPct: ((laid.plate!.x1 - laid.plate!.x0) / 1500) * 100, heightPct: ((laid.plate!.y1 - laid.plate!.y0) / 2100) * 100 };
      if (text) for (const target of ["hd", "default"] as const) expect(inkEntersRect(text, rect, target), `${card.name} ${target}`).toBe(false);
    }
  });
});

describe("shapes no print has", () => {
  it("no tier: the top band is the whole box, nothing is drawn but its text", () => {
    const laid = custom({ intro: "Flying\nWhenever this Spacecraft attacks, draw a card.", tiers: [] }, "3/3");
    expect(laid.bands.tiers).toEqual([]);
    expect(laid.plate).toBeNull();
    expect(laid.bands.top).toMatchObject({ y0: STATION.box.top, y1: STATION.box.bottom });
    const drawing = stationDrawing(laid, getFrameProfile("m15station"), "u");
    expect(drawing.pieces).toEqual([]);
    expect(drawing.values).toEqual([]);
    expect(drawing.texts).toHaveLength(1);
  });

  it("three tiers under a whole reminder fit; the plate may sit on any ONE tier", () => {
    const tiers = [
      { threshold: 2, text: "Flying", pt: false },
      { threshold: 8, text: "Whenever this Spacecraft attacks, draw a card, then discard a card.", pt: true },
      { threshold: 14, text: "Other creatures you control get +2/+2 and have vigilance.", pt: false },
    ];
    const laid = custom({ intro: REMINDER, tiers }, "20/20");
    expect(laid.clipped).toBe(false);
    expect(laid.bands.tiers).toHaveLength(3);
    expect(laid.plate).toMatchObject({ value: "20/20" });
    expect((laid.plate!.y0 + laid.plate!.y1) / 2).toBeGreaterThan(laid.bands.tiers[1]!.y0);
    expect((laid.plate!.y0 + laid.plate!.y1) / 2).toBeLessThan(laid.bands.tiers[1]!.y1);
    const drawing = stationDrawing(laid, getFrameProfile("m15station"), "r");
    expect(drawing.pieces.map((p) => p.kind)).toEqual(["band", "band", "band", "badge", "badge", "badge", "plate"]);
    expect(drawing.values.map((v) => v.value)).toEqual(["2+", "8+", "14+", "20/20"]);
    for (const piece of drawing.pieces) expect(isEvenPx(piece.rect), piece.kind).toBe(true);
  });

  it("no P/T: no plate, whatever the rows say; an empty tier still gets its band and badge", () => {
    const laid = custom({ intro: "", tiers: [{ threshold: 5, text: "", pt: true }] }, null);
    expect(laid.plate).toBeNull();
    expect(laid.tiers[0]!.text).toBeNull();
    expect(laid.bands.tiers[0]!.y1 - laid.bands.tiers[0]!.y0).toBe(STATION.bandRules[0].minPx + STATION.bandRules[0].lastExtraPx);
    expect(stationDrawing(laid, getFrameProfile("m15station"), "c").pieces.map((p) => p.kind)).toEqual(["band", "badge"]);
  });

  it("the stamp's arch is a keep-out of the last band only: a short last tier never moves", () => {
    const text = { intro: REMINDER, tiers: [{ threshold: 8, text: "Flying", pt: true }] };
    expect(custom(text, "4/4", M15_HOLO_STAMP_KEEP_OUT).bands).toEqual(custom(text, "4/4").bands);
  });

  it("a text past every size is drawn at the floor and says so", () => {
    const long = Array.from({ length: 9 }, () => "Whenever this Spacecraft attacks, each opponent loses 2 life and you gain 2 life.").join("\n");
    const laid = custom({ intro: REMINDER, tiers: [{ threshold: 3, text: long, pt: false }, { threshold: 9, text: long, pt: true }] }, "5/5");
    expect(laid.clipped).toBe(true);
    expect(laid.sizePx).toBe(42);
    expect(laid.rule).toBe(STATION.bandRules.length - 1);
  });

  it("every piece of every printed card sits on even HD px — whole px at the 750 px target", () => {
    for (const card of CARDS) {
      const drawing = stationDrawing(lay(card), profileOf(card), "g");
      for (const piece of drawing.pieces) expect(isEvenPx(piece.rect), `${card.name} ${piece.kind}`).toBe(true);
    }
  });
});
