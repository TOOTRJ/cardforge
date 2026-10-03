import { describe, expect, it } from "vitest";
import {
  ARTIST_SMALL_CAP_EM,
  quantizedPx,
  BRAND_MARK_GEOMETRY,
  COLLECTOR_METRICS,
  COLLECTOR_NUMBER_TRACKING_EM,
  MARK_TEXT_MAX_WIDTH_PCT,
  brandMarkWidthPct,
  collectorDrawn,
  collectorLayout,
  collectorMarkLine,
  collectorTextWidthEm,
  smallCapsChunks,
  smallCapsWidthEm,
  type CollectorLayoutCard,
  type CollectorTextRun,
} from "@/lib/cards/collector-layout";
import { COLLECTOR_FACES } from "@/lib/cards/collector-metrics";
import { displayTextWidthEm } from "@/lib/cards/display-metrics";
import { rulesTextWidthEm } from "@/lib/cards/rules-metrics";
import { M15_COLLECTOR, getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.9b — the collector line's LAYOUT (lib/cards/collector-layout.ts):
// the absolute runs both renderers draw, measured on the prints
// (M15_COLLECTOR's notes; scratchpad collector-line/measure2.json):
//   • both lines start at CC's 6.47 %W (97 px); line 1's baseline at
//     1993.5 px, line 2's at 2032 (the thirteen scans' means); the size
//     36 px (0.024 W: 25 px capitals);
//   • the 2015 style's letter stands in the column at the brush's x
//     (287 px — DMU #107's M at 287, ONC #114's R at 289, KLD #265's M at
//     290, TDOM #1's T at 292), or one space after a number that reaches
//     it; the 2023 style's letter comes first ("R 1242");
//   • the brush: 40 px wide from 27 above line 2's baseline to 3 above it;
//     the artist's pen 46 px after its left edge, in Beleren's synthesized
//     small caps at 38 px (capitals 27 px, small caps 22 — DMU #107);
//   • the © slot: right edge 93.54 %W (1403 px), line 2 when the renderer
//     draws a stat plate, else line 1 — the brand mark on display (its own
//     size), the footer text in MPlantin at 34 px on a clean download;
//   • every run's top is its baseline less the face's ascent at its size,
//     and its line height the face's ascent + descent (the probes of
//     2026-09-30: Satori and the browser agree on that box).
// ---------------------------------------------------------------------------

const m15 = getFrameProfile("m15");
const W = 1500;
const H = 2100;
const px = (pct: number, of: number) => (pct / 100) * of;

function dmu(over: Partial<CollectorLayoutCard> = {}): CollectorLayoutCard {
  return {
    cardType: "creature",
    supertype: "Legendary",
    rarity: "mythic",
    setCode: "DMU",
    collectorNumber: "107/281",
    lang: "en",
    artistCredit: "Chris Rahn",
    finish: "regular",
    collector: "2015",
    plates: { pt: true, loyalty: false, defense: false },
    ...over,
  };
}

const display = { kind: "display" } as const;
const texts = (layout: NonNullable<ReturnType<typeof collectorLayout>>) =>
  layout.runs.filter((r): r is CollectorTextRun => r.kind === "text");
const run = (layout: NonNullable<ReturnType<typeof collectorLayout>>, role: CollectorTextRun["role"]) => {
  const found = texts(layout).find((r) => r.role === role);
  if (!found) throw new Error(`no ${role} run`);
  return found;
};

describe("when the line is drawn", () => {
  it("only for a style on a template with the slot", () => {
    expect(collectorDrawn(m15, { collector: "2015" })).toBe("2015");
    expect(collectorDrawn(m15, { collector: "2023" })).toBe("2023");
    expect(collectorDrawn(m15, { collector: "off" })).toBeNull();
    expect(collectorDrawn(m15, {})).toBeNull();
    expect(collectorDrawn(m15, null)).toBeNull();
    expect(collectorDrawn(getFrameProfile("m15borderless"), { collector: "2023" })).toBeNull();
    expect(collectorLayout(getFrameProfile("m15borderless"), dmu({ collector: "2023" }), display)).toBeNull();
    expect(collectorLayout(m15, dmu({ collector: "off" }), display)).toBeNull();
    expect(collectorLayout(m15, dmu({ collector: undefined }), display)).toBeNull();
  });

  it("every slotted template lays the same line out — M15's slot (the walker's pins the © slot to line 2)", () => {
    const reference = collectorLayout(m15, dmu(), display)!;
    for (const template of FRAME_TEMPLATE_VALUES) {
      const profile = getFrameProfile(template);
      if (!profile.collector) continue;
      const { markLine, ...geometry } = profile.collector;
      expect(geometry, template).toEqual(M15_COLLECTOR);
      expect(markLine, template).toBe(template === "m15pw" ? 2 : undefined);
      // The card draws a stat plate here, so every template agrees.
      expect(collectorLayout(profile, dmu(), display), template).toEqual(reference);
    }
  });
});

describe("the geometry (M15_COLLECTOR, the prints)", () => {
  it("the slot's numbers", () => {
    expect(M15_COLLECTOR.leftPct).toBeCloseTo(6.47, 5);
    expect(M15_COLLECTOR.rightPct).toBeCloseTo(93.54, 5);
    expect(px(M15_COLLECTOR.line1BaselinePct, H)).toBeCloseTo(1993.5, 3);
    expect(px(M15_COLLECTOR.line2BaselinePct, H)).toBeCloseTo(2032, 3);
    expect(px(M15_COLLECTOR.brushLeftPct, W)).toBeCloseTo(287, 3);
    expect(M15_COLLECTOR.sizePct * W).toBeCloseTo(36, 6);
    expect(M15_COLLECTOR.artistSizePct * W).toBeCloseTo(38, 6);
    expect(M15_COLLECTOR.markTextSizePct * W).toBeCloseTo(34, 6);
  });

  it("2015: the number from the pen x on line 1, the letter in the brush's column; line 2's set • language from the pen x", () => {
    const layout = collectorLayout(m15, dmu(), display)!;
    const number = run(layout, "number");
    expect(number.text).toBe("107/281");
    expect(px(number.xPct, W)).toBeCloseTo(97.05, 1);
    expect(px(number.baselinePct, H)).toBeCloseTo(1993.5, 3);
    expect(number.sizePct * W).toBeCloseTo(36, 6);
    expect(number.letterSpacingEm).toBe(COLLECTOR_NUMBER_TRACKING_EM);
    expect(number.face).toBe("collector");
    expect(number.widthPct).toBeCloseTo((collectorTextWidthEm("107/281", COLLECTOR_NUMBER_TRACKING_EM) * 36) / 15, 6);
    const letter = run(layout, "letter");
    expect(letter.text).toBe("M");
    expect(px(letter.xPct, W)).toBeCloseTo(287, 3);
    expect(letter.letterSpacingEm).toBe(0);
    const set = run(layout, "set");
    expect(set.text).toBe("DMU • EN");
    expect(px(set.xPct, W)).toBeCloseTo(97.05, 1);
    expect(px(set.baselinePct, H)).toBeCloseTo(2032, 3);
    // The brush at its column, 40 wide, 27 above line 2's baseline to 3 above.
    const brush = layout.runs.find((r) => r.kind === "path" && r.role === "brush")!;
    expect(brush.kind).toBe("path");
    if (brush.kind !== "path") return;
    expect(px(brush.xPct, W)).toBeCloseTo(287, 3);
    expect(px(brush.widthPct, W)).toBeCloseTo(40, 3);
    expect(px(brush.topPct, H)).toBeCloseTo(2032 - 27, 3);
    expect(px(brush.topPct + brush.heightPct, H)).toBeCloseTo(2032 - 3, 3);
    // The artist's pen 46 px after the brush, in Beleren at 38 px.
    const artist = run(layout, "artist");
    expect(artist.text).toBe("C");
    expect(artist.face).toBe("display");
    expect(px(artist.xPct, W)).toBeCloseTo(287 + 46, 3);
    expect(artist.sizePct * W).toBeCloseTo(38, 6);
    expect(px(artist.baselinePct, H)).toBeCloseTo(2032, 3);
  });

  it("2023: the letter first, a space, the number padded to four", () => {
    const layout = collectorLayout(m15, dmu({ collector: "2023", collectorNumber: "9" }), display)!;
    const letter = run(layout, "letter");
    const number = run(layout, "number");
    expect(letter.text).toBe("M");
    expect(number.text).toBe("0009");
    expect(px(letter.xPct, W)).toBeCloseTo(97.05, 1);
    const spacePx = (COLLECTOR_METRICS.advances[" "] / 1000) * 36;
    expect(px(number.xPct, W)).toBeCloseTo(97.05 + px(letter.widthPct, W) + spacePx, 3);
  });

  it("a number that reaches the column pushes the letter one space after it; a long set run pushes the brush and the column", () => {
    const long = collectorLayout(m15, dmu({ collectorNumber: "1234/1234" }), display)!;
    const number = run(long, "number");
    const spacePx = (COLLECTOR_METRICS.advances[" "] / 1000) * 36;
    expect(px(number.xPct + number.widthPct, W)).toBeGreaterThan(287 - spacePx);
    expect(px(run(long, "letter").xPct, W)).toBeCloseTo(px(number.xPct + number.widthPct, W) + spacePx, 3);
    const wide = collectorLayout(m15, dmu({ setCode: "WWWWWW", lang: "zht" }), display)!;
    const set = run(wide, "set");
    expect(set.text).toBe("WWWWWW • CT");
    const brush = wide.runs.find((r) => r.kind === "path" && r.role === "brush")!;
    expect(brush.xPct).toBeCloseTo(set.xPct + set.widthPct + (spacePx / W) * 100, 6);
    expect(run(wide, "letter").xPct).toBeCloseTo(brush.xPct, 6);
  });

  it("every run's top is its baseline less the face's ascent, with the face's line box", () => {
    const layout = collectorLayout(m15, dmu(), { kind: "download", footerText: "Forged by Kesh" })!;
    for (const r of texts(layout)) {
      const face = COLLECTOR_FACES[r.face];
      expect(r.lineHeight, r.role).toBeCloseTo(face.ascent + face.descent, 6);
      expect(px(r.topPct, H), r.role).toBeCloseTo(px(r.baselinePct, H) - face.ascent * r.sizePct * W, 3);
    }
  });
});

describe("the ★ and the language", () => {
  it("the ★ run between the set code and the language for the flag or a foil finish, the • joined into one run otherwise", () => {
    const dot = collectorLayout(m15, dmu(), display)!;
    expect(run(dot, "set").text).toBe("DMU • EN");
    expect(dot.runs.some((r) => r.kind === "path" && r.role === "separator")).toBe(false);
    for (const card of [dmu({ star: true }), dmu({ finish: "foil" })]) {
      const star = collectorLayout(m15, card, display)!;
      const set = run(star, "set");
      const lang = run(star, "language");
      const sep = star.runs.find((r) => r.kind === "path" && r.role === "separator")!;
      expect(set.text).toBe("DMU");
      expect(lang.text).toBe("EN");
      expect(sep.kind).toBe("path");
      if (sep.kind !== "path") return;
      const spacePx = (COLLECTOR_METRICS.advances[" "] / 1000) * 36;
      expect(px(sep.xPct, W)).toBeCloseTo(px(set.xPct + set.widthPct, W) + spacePx, 3);
      expect(px(sep.widthPct, W)).toBeCloseTo(18, 3);
      expect(px(sep.topPct + sep.heightPct, H)).toBeCloseTo(2032 - 0.08 * 36, 3);
      expect(px(lang.xPct, W)).toBeCloseTo(px(sep.xPct + sep.widthPct, W) + spacePx, 3);
    }
  });

  it("a ★ stored in the number is the ★ run too (KLD-style promo numbers)", () => {
    const layout = collectorLayout(m15, dmu({ collectorNumber: "265★" }), display)!;
    expect(layout.runs.filter((r) => r.kind === "path" && r.role === "number-star")).toHaveLength(1);
    expect(run(layout, "number").text).toBe("265");
  });

  it("es prints SP; an unverified language leaves line 2 to the set code alone; no set code starts at the language", () => {
    expect(run(collectorLayout(m15, dmu({ lang: "es" }), display)!, "set").text).toBe("DMU • SP");
    expect(run(collectorLayout(m15, dmu({ lang: "he" }), display)!, "set").text).toBe("DMU");
    const noSet = collectorLayout(m15, dmu({ setCode: null }), display)!;
    expect(texts(noSet).some((r) => r.role === "set")).toBe(false);
    expect(run(noSet, "language").text).toBe("EN");
    expect(px(run(noSet, "language").xPct, W)).toBeCloseTo(97.05, 1);
  });
});

describe("the © slot", () => {
  it("line 2 when the renderer draws a stat plate — any plate — else line 1; never the data's presence", () => {
    expect(collectorMarkLine({ pt: true, loyalty: false, defense: false })).toBe(2);
    expect(collectorMarkLine({ pt: false, loyalty: true, defense: false })).toBe(2);
    expect(collectorMarkLine({ pt: false, loyalty: false, defense: true })).toBe(2);
    expect(collectorMarkLine({ pt: false, loyalty: false, defense: false })).toBe(1);
    // A Treasure token storing a stray P/T that no renderer prints: line 1.
    const stray = collectorLayout(m15, dmu({ cardType: "token", supertype: "Artifact", plates: { pt: false, loyalty: false, defense: false } }), display)!;
    expect(stray.markLine).toBe(1);
    expect(stray.mark.kind === "brand" && stray.mark.anchor.line).toBe(1);
  });

  it("a planeswalker: ALWAYS line 2 — the master draws the loyalty shield's outline even when the card draws no plate", () => {
    const m15pw = getFrameProfile("m15pw");
    expect(m15pw.collector?.markLine).toBe(2);
    expect(collectorMarkLine({ pt: false, loyalty: false, defense: false }, m15pw.collector)).toBe(2);
    expect(collectorMarkLine({ pt: false, loyalty: false, defense: false }, m15.collector)).toBe(1);
    // A walker saved without a loyalty value (the bake draws no plate; the
    // editor shows the empty shield): the mark — and a clean download's
    // footer text — stay on line 2, below the shield's outline (it ends at
    // y 1984 px; a line-1 mark's ink would cross it at y ≈ 1967–2003).
    const walker = dmu({ cardType: "planeswalker", plates: { pt: false, loyalty: false, defense: false } });
    for (const style of ["2015", "2023"] as const) {
      const shown = collectorLayout(m15pw, { ...walker, collector: style }, display)!;
      expect(shown.markLine, style).toBe(2);
      expect(shown.mark.kind === "brand" && px(shown.mark.anchor.baselinePct, H), style).toBeCloseTo(2032, 3);
      const clean = collectorLayout(m15pw, { ...walker, collector: style }, { kind: "download", footerText: "Forged by Kesh" })!;
      expect(px(run(clean, "mark-text").baselinePct, H), style).toBeCloseTo(2032, 3);
    }
    // With its loyalty the answer is the same, and every other slotted
    // template still follows the plate it draws.
    expect(collectorLayout(m15pw, { ...walker, plates: { pt: false, loyalty: true, defense: false } }, display)!.markLine).toBe(2);
    for (const template of ["m15", "m15land", "m15artifact", "m15snow", "m15devoid", "m15token", "m15tokentext", "emblem"] as const) {
      const profile = getFrameProfile(template);
      expect(profile.collector?.markLine, template).toBeUndefined();
      expect(collectorLayout(profile, dmu({ plates: { pt: false, loyalty: false, defense: false } }), display)!.markLine, template).toBe(1);
    }
  });

  it("display: the brand mark at its own size, right-aligned on the slot, on the line's baseline", () => {
    const layout = collectorLayout(m15, dmu(), display)!;
    expect(layout.mark.kind).toBe("brand");
    if (layout.mark.kind !== "brand") return;
    const a = layout.mark.anchor;
    expect(a.rightPct).toBeCloseTo(93.54, 5);
    expect(px(a.baselinePct, H)).toBeCloseTo(2032, 3);
    expect(a.sizePct).toBeCloseTo(BRAND_MARK_GEOMETRY.fontPct, 6); // 2.6 % W, as every brand mark
    expect(a.lineHeight).toBeCloseTo(COLLECTOR_FACES.display.ascent + COLLECTOR_FACES.display.descent, 6);
    expect(px(a.topPct, H)).toBeCloseTo(2032 - COLLECTOR_FACES.display.ascent * 0.026 * W, 3);
    expect(a.widthPct).toBeCloseTo(brandMarkWidthPct(1), 6);
    expect(brandMarkWidthPct(1)).toBeCloseTo(
      (0.03 + 0.008 + displayTextWidthEm("pipglyph.com", { letterSpacingEm: 0.02 }) * 0.026) * 100,
      6,
    );
    // No line-1 mark and no footer text on display.
    expect(texts(layout).some((r) => r.role === "mark-text")).toBe(false);
    const noPlate = collectorLayout(m15, dmu({ plates: { pt: false, loyalty: false, defense: false } }), display)!;
    expect(noPlate.mark.kind === "brand" && px(noPlate.mark.anchor.baselinePct, H)).toBeCloseTo(1993.5, 3);
  });

  it("a clean download: the footer text in MPlantin at 34 px, right-aligned on the slot — or nothing", () => {
    const text = collectorLayout(m15, dmu(), { kind: "download", footerText: " Forged by Kesh " })!;
    expect(text.mark.kind).toBe("text");
    const mark = run(text, "mark-text");
    expect(mark.text).toBe("Forged by Kesh");
    expect(mark.face).toBe("body");
    expect(mark.sizePct * W).toBeCloseTo(34, 6);
    expect(px(mark.xPct + mark.widthPct, W)).toBeCloseTo(px(93.54, W), 3);
    expect(px(mark.widthPct, W)).toBeCloseTo(rulesTextWidthEm("Forged by Kesh") * 34, 3);
    expect(px(mark.baselinePct, H)).toBeCloseTo(2032, 3);
    for (const footerText of [null, undefined, "", "   "]) {
      const none = collectorLayout(m15, dmu(), { kind: "download", footerText })!;
      expect(none.mark.kind, String(footerText)).toBe("none");
      expect(texts(none).some((r) => r.role === "mark-text"), String(footerText)).toBe(false);
    }
  });

  it("a clean download's footer text never runs back over the line: past 45 % of the width it is cut with ONE '…'", () => {
    expect(MARK_TEXT_MAX_WIDTH_PCT).toBe(0.45);
    const maxPx = MARK_TEXT_MAX_WIDTH_PCT * W;
    // Forty characters of ordinary text (the field's limit) fit whole.
    const ordinary = "© 2026 Red Jester Studios, all rights ok";
    expect(ordinary).toHaveLength(40);
    expect(run(collectorLayout(m15, dmu(), { kind: "download", footerText: ordinary })!, "mark-text").text).toBe(ordinary);
    // Forty W's would be 1,300 px wide — over the artist, the set code and
    // the pen x itself. Cut, the text still ends on the slot's edge.
    const wide = "W".repeat(40);
    expect(rulesTextWidthEm(wide) * 34).toBeGreaterThan(px(93.54, W) - px(6.47, W));
    for (const plates of [{ pt: true, loyalty: false, defense: false }, { pt: false, loyalty: false, defense: false }]) {
      // The longest line 1 the fields allow, in both styles.
      for (const style of ["2015", "2023"] as const) {
        const layout = collectorLayout(
          m15,
          dmu({ plates, collector: style, setCode: "WWWWWW", collectorNumber: "W".repeat(12), artistCredit: "Someone With An Extraordinarily Long Illustrator Name" }),
          { kind: "download", footerText: wide },
        )!;
        const mark = run(layout, "mark-text");
        expect(mark.text.endsWith("…")).toBe(true);
        expect((mark.text.match(/…/g) ?? []).length).toBe(1);
        expect(px(mark.widthPct, W)).toBeLessThanOrEqual(maxPx + 1e-6);
        expect(px(mark.widthPct, W)).toBeCloseTo(rulesTextWidthEm(mark.text) * 34, 3);
        expect(px(mark.xPct + mark.widthPct, W)).toBeCloseTo(px(93.54, W), 3);
        // Nothing else on the mark's line reaches it; the artist keeps room.
        const sameLine = layout.runs.filter((r) => r !== mark && (r.kind === "text" ? Math.abs(r.baselinePct - mark.baselinePct) < 1e-6 : false));
        for (const other of sameLine) expect(other.xPct + other.widthPct, `${style} ${other.kind === "text" ? other.text : ""}`).toBeLessThan(mark.xPct - 1);
        expect(layout.artist?.text.length).toBeGreaterThan(8);
      }
    }
  });
});

describe("the artist", () => {
  it("synthesized small caps: capitals at the size, lower-case as capitals at 0.8 of it, word by word", () => {
    expect(smallCapsChunks("Chris")).toEqual([
      { text: "C", small: false },
      { text: "HRIS", small: true },
    ]);
    expect(smallCapsChunks("Wenfei")).toEqual([
      { text: "W", small: false },
      { text: "ENFEI", small: true },
    ]);
    expect(smallCapsChunks("McKinnon")).toEqual([
      { text: "M", small: false },
      { text: "C", small: true },
      { text: "K", small: false },
      { text: "INNON", small: true },
    ]);
    expect(smallCapsChunks("J.")).toEqual([{ text: "J.", small: false }]);
    expect(ARTIST_SMALL_CAP_EM).toBe(0.8);
    expect(smallCapsWidthEm("Chris Rahn")).toBeCloseTo(
      displayTextWidthEm("C") + displayTextWidthEm("HRIS") * 0.8 + displayTextWidthEm(" ") + displayTextWidthEm("R") + displayTextWidthEm("AHN") * 0.8,
      9,
    );
    const layout = collectorLayout(m15, dmu(), display)!;
    const artist = texts(layout).filter((r) => r.role === "artist");
    expect(artist.map((r) => r.text)).toEqual(["C", "HRIS", "R", "AHN"]);
    // The small caps are 38 × 0.8 = 30.4 px nominal, DRAWN at the whole HD
    // pixel the bake rounds to (4.9c: quantizedPx — the preview now draws
    // the same 30); the chunk's advance keeps the nominal 30.4 (the bake's
    // gap today, a correction for a collector-scoped sweep).
    expect(artist.map((r) => Math.round(r.sizePct * W * 100) / 100)).toEqual([38, 30, 38, 30]);
    expect((artist[1].widthPct / 100) * W).toBeCloseTo(displayTextWidthEm("HRIS") * 30.4, 6);
    expect(quantizedPx(30.4)).toBe(30);
    expect(quantizedPx(38)).toBe(38);
    // Each chunk starts where the one before ends; a word gap is the display face's space.
    expect(artist[1].xPct).toBeCloseTo(artist[0].xPct + artist[0].widthPct, 6);
    expect(artist[2].xPct).toBeCloseTo(artist[1].xPct + artist[1].widthPct + (displayTextWidthEm(" ") * 38 * 100) / W, 6);
    expect(layout.artist).toEqual({ text: "Chris Rahn", sizePct: 38 / W, cut: false });
  });

  it("a long artist is cut with ONE '…' before the © slot's content — the mark on line 2, the footer text, or the slot's edge", () => {
    const long = "Someone With An Extraordinarily Long Illustrator Name Indeed Yes";
    const display2 = collectorLayout(m15, dmu({ artistCredit: long }), display)!;
    expect(display2.artist?.cut).toBe(true);
    expect(display2.artist?.text.endsWith("…")).toBe(true);
    expect((display2.artist?.text.match(/…/g) ?? []).length).toBe(1);
    // The size never drops below the slot's 38 px here: the 5 pt floor
    // (41.7 px) is above it, so the fit cuts instead of shrinking.
    expect(display2.artist?.sizePct).toBeCloseTo(38 / W, 9);
    const last = texts(display2).filter((r) => r.role === "artist").at(-1)!;
    const markLeft = display2.mark.kind === "brand" ? display2.mark.anchor.rightPct - display2.mark.anchor.widthPct : 0;
    expect(last.xPct + last.widthPct).toBeLessThanOrEqual(markLeft - 2 + 1e-9);
    // Line 1's mark leaves line 2 the whole slot: the same name fits more.
    const noPlate = collectorLayout(m15, dmu({ artistCredit: long, plates: { pt: false, loyalty: false, defense: false } }), display)!;
    expect(noPlate.artist!.text.length).toBeGreaterThan(display2.artist!.text.length);
    const lastFree = texts(noPlate).filter((r) => r.role === "artist").at(-1)!;
    expect(lastFree.xPct + lastFree.widthPct).toBeLessThanOrEqual(93.54 + 1e-9);
    // A clean download with a long footer text leaves less room than the mark.
    const footer = collectorLayout(m15, dmu({ artistCredit: long }), { kind: "download", footerText: "A rather long custom footer mark here" })!;
    expect(footer.artist!.text.length).toBeLessThan(display2.artist!.text.length);
  });

  it("no artist: no brush, no artist runs", () => {
    const none = collectorLayout(m15, dmu({ artistCredit: null }), display)!;
    expect(none.runs.some((r) => r.kind === "path" && r.role === "brush")).toBe(false);
    expect(texts(none).some((r) => r.role === "artist")).toBe(false);
    expect(none.artist).toBeNull();
  });
});
