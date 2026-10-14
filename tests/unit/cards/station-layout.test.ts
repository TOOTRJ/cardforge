import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ptValue } from "@/lib/cards/stat-fit";
import { M15_HOLO_STAMP_KEEP_OUT } from "@/lib/cards/holo-stamp";
import { inkEntersRect } from "@/lib/cards/rules-layout";
import { STATION, parseStationText, type StationText } from "@/lib/cards/station";
import { stationDrawing, stationLayout, type StationLayout } from "@/lib/cards/station-layout";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import oracle from "./fixtures/station-oracle.json";
import printEdges from "./fixtures/station-print-edges.json";

// The station frame's tiers layout (TODO 4.27a): one size for the whole box,
// bands from the text, every piece on even HD px — and the bands it gives
// the PRINTED cards against where the prints put them (30 cards measured,
// scripts/lib/station-2025.mjs). STATION_REPORT_FILE=<path> writes the table.

type OracleCard = { name: string; set: string; collector_number: string; type_line: string; oracle_text: string; power: string | null; toughness: string | null };
const CARDS = oracle as OracleCard[];
const PRINT_EDGES = printEdges as { id: string; name: string; sample: "in" | "out"; printing: string; stamped: boolean; pt: string | null; edges: number[]; pr1: number[] }[];

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

  // Print's band edges as the independent check of #543 re-measured them on
  // the scans (fixtures/station-print-edges.json: 30 bordered printings the
  // rule was fitted on — 36 edges — and 13 extended-art + 2 borderless
  // printings it was not, 23 edges; print sets the extended ones without the
  // reminder). Laid out as the BAKE lays them: with the holofoil stamp's
  // keep-out on every stamped rare / mythic. `pr1` is where PR 1's bake put
  // the same edge. STATION_REPORT_FILE=<path> writes the table.
  it("puts the bands where print puts them: 34 of 36 edges within 20 px on the cards it was fitted on, 19 of 23 on the others", () => {
    const rows: string[] = [];
    const stats = { in: [] as number[], out: [] as number[] };
    const before = { in: [] as number[], out: [] as number[] };
    const byName = new Map(CARDS.map((card) => [card.name, card]));
    for (const print of PRINT_EDGES) {
      const card = byName.get(print.name)!;
      // An extended-art printing sets the keyword alone, without its reminder.
      const oracle_text = print.printing === "extended" ? card.oracle_text.replace(/Station \([^)]*\)/, "Station") : card.oracle_text;
      const laid = lay({ ...card, oracle_text }, print.stamped ? M15_HOLO_STAMP_KEEP_OUT : null);
      const ours = laid.bands.tiers.map((b) => b.y0);
      expect(ours.length, print.id).toBe(print.edges.length);
      expect(laid.clipped, print.id).toBe(false);
      const delta = ours.map((y, i) => y - print.edges[i]!);
      const was = print.pr1.map((y, i) => y - print.edges[i]!);
      stats[print.sample].push(...delta.map(Math.abs));
      before[print.sample].push(...was.map(Math.abs));
      const signed = (d: number[]) => d.map((v) => (v > 0 ? `+${v}` : `${v}`)).join(" / ");
      rows.push(
        `${print.id.padEnd(9)} ${print.sample.padEnd(3)} ${print.stamped ? "stamp" : "     "} ${String(laid.sizePx).padStart(2)} px rule ${laid.rule}  print ${print.edges.join(" / ").padEnd(11)} now ${ours.join(" / ").padEnd(11)} Δ ${signed(delta).padEnd(9)} PR 1 Δ ${signed(was).padEnd(9)} ${print.name}`,
      );
    }
    const line = (what: string, d: number[]) => {
      const sorted = [...d].sort((a, b) => a - b);
      const within = (n: number) => sorted.filter((v) => v <= n).length;
      return `${what}: edges ${sorted.length}, median ${sorted[Math.floor(sorted.length / 2)]}, ≤10 px ${within(10)}, ≤20 px ${within(20)}, max ${sorted[sorted.length - 1]}`;
    };
    rows.push(line("in sample, now ", stats.in), line("in sample, PR 1", before.in), line("out of sample, now ", stats.out), line("out of sample, PR 1", before.out));
    if (process.env.STATION_REPORT_FILE) fs.writeFileSync(process.env.STATION_REPORT_FILE, rows.join("\n"));
    const within20 = (d: number[]) => d.filter((v) => v <= 20).length;
    expect(stats.in).toHaveLength(36);
    expect(stats.out).toHaveLength(23);
    expect(within20(stats.in)).toBeGreaterThanOrEqual(34);
    expect(Math.max(...stats.in)).toBeLessThanOrEqual(26);
    expect(within20(stats.out)).toBeGreaterThanOrEqual(19);
    // Never worse than PR 1's rule on either sample.
    expect(within20(stats.in)).toBeGreaterThan(within20(before.in));
    expect(within20(stats.out)).toBeGreaterThan(within20(before.out));
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
    expect(laid.bands.tiers[0]!.y1 - laid.bands.tiers[0]!.y0).toBe(STATION.bandRules[0].lastFloorPx);
    expect(stationDrawing(laid, getFrameProfile("m15station"), "c").pieces.map((p) => p.kind)).toEqual(["band", "badge"]);
  });

  it("under the stamp a one-line last tier never moves; a full one gets print's 22 px more and its text sits above the arch", () => {
    const text = { intro: REMINDER, tiers: [{ threshold: 8, text: "Flying", pt: true }] };
    expect(custom(text, "4/4", M15_HOLO_STAMP_KEEP_OUT).bands).toEqual(custom(text, "4/4").bands);

    const full = { intro: REMINDER, tiers: [{ threshold: 8, text: "Flying\nWhenever this Spacecraft attacks, draw two cards, then discard a card.\nOther creatures you control have vigilance.", pt: true }] };
    const [stamped, bare] = [custom(full, "4/4", M15_HOLO_STAMP_KEEP_OUT), custom(full, "4/4")];
    expect(stamped.clipped).toBe(false);
    const [a, b] = [stamped.bands.tiers[0]!, bare.bands.tiers[0]!];
    if (stamped.sizePx === bare.sizePx) expect(a.y1 - a.y0).toBeGreaterThan(b.y1 - b.y0);
    expect(a.textY1).toBeLessThan(a.y1);
    expect(a.cy).toBe((a.y0 + a.y1) / 2);
    for (const target of ["hd", "default"] as const) expect(inkEntersRect(stamped.tiers[0]!.text!, M15_HOLO_STAMP_KEEP_OUT, target)).toBe(false);
  });

  it("the card the check clipped: two keyword lines, the reminder and three one-word tiers fit — the badges give way before the text", () => {
    const tiers = [
      { threshold: 2, text: "Flying", pt: false },
      { threshold: 6, text: "Vigilance", pt: false },
      { threshold: 10, text: "Trample", pt: true },
    ];
    for (const stamp of [null, M15_HOLO_STAMP_KEEP_OUT]) {
      const laid = custom({ intro: `Flash\nWard {2}\n${REMINDER}`, tiers }, "5/5", stamp);
      expect(laid.clipped).toBe(false);
      expect(laid.bands.top.y0).toBe(STATION.box.top);
      const drawing = stationDrawing(laid, getFrameProfile("m15station"), "u");
      for (const piece of drawing.pieces) {
        expect(isEvenPx(piece.rect), piece.kind).toBe(true);
        // No piece leaves its own band.
        if (piece.kind !== "band") {
          const [y0, y1] = [piece.rect.topPct * 21, (piece.rect.topPct + piece.rect.heightPct) * 21];
          expect(laid.bands.tiers.some((band) => y0 >= band.y0 - 0.01 && y1 <= band.y1 + 0.01), piece.kind).toBe(true);
        }
      }
    }
  });

  it("no top text: the tiers keep print's air and the top band is the rest, empty", () => {
    const laid = custom({ intro: "", tiers: [{ threshold: 4, text: "Flying", pt: true }] }, "2/2");
    expect(laid.clipped).toBe(false);
    expect(laid.bands.tiers[0]!.y1 - laid.bands.tiers[0]!.y0).toBe(STATION.bandRules[0].lastFloorPx);
    expect(laid.bands.top.y1 - laid.bands.top.y0).toBeGreaterThan(400);
  });

  it("a text past every size is drawn at the floor and says so", () => {
    const long = Array.from({ length: 9 }, () => "Whenever this Spacecraft attacks, each opponent loses 2 life and you gain 2 life.").join("\n");
    const laid = custom({ intro: REMINDER, tiers: [{ threshold: 3, text: long, pt: false }, { threshold: 9, text: long, pt: true }] }, "5/5");
    expect(laid.clipped).toBe(true);
    expect(laid.sizePx).toBe(42);
    expect(laid.rule).toBe(STATION.bandRules.length - 1);
    // The box is the box: the bands share it, none over the type bar or the art.
    expect(laid.bands.top.y0).toBe(STATION.box.top);
    expect(laid.bands.tiers[0]!.y0).toBeGreaterThanOrEqual(STATION.box.top);
    expect(laid.bands.tiers[1]!.y1).toBe(STATION.box.bottom);
    for (const band of laid.bands.tiers) expect(band.y1).toBeGreaterThan(band.y0);
  });

  it("every piece of every printed card sits on even HD px — whole px at the 750 px target", () => {
    for (const card of CARDS) {
      const drawing = stationDrawing(lay(card), profileOf(card), "g");
      for (const piece of drawing.pieces) expect(isEvenPx(piece.rect), `${card.name} ${piece.kind}`).toBe(true);
    }
  });
});
