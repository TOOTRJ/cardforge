import { describe, expect, it } from "vitest";
import { displayTextWidthEm } from "@/lib/cards/display-metrics";
import { BAND_GAP_PCT, HALF_PX_PCT, MIN_NAME_EM, costRowWidthPct, measuredLinePx } from "@/lib/cards/render-tiers";
import { getFrameProfile, type FrameProfile } from "@/lib/cards/template-layout";
import {
  DETACHED_COST_GAP_PCT,
  TITLE_FIT_HEADROOM,
  fitDetachedCostTitle,
  fitTitleBand,
  manaCostWidthPct,
  titleBandRoomPct,
} from "@/lib/cards/title-band";
import {
  ADVENTURE_PANEL_COST_PCT,
  ADVENTURE_PANEL_PCT,
  COST_DISC_PCT,
  RULES_TEXT,
  TITLE_SIZE_PCT,
  pctToPt,
  ptToPct,
} from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// fitTitleBand (TODO 4.20, layout v32): the M15-era family's name fit, for
// both renderers. A slot with `fit: "measured"` shrinks its name to the room
// its band really leaves it — beside an inline cost, alone, centred, or
// before a detached cost — instead of the CSS ellipsis, down to the 5 pt
// floor of the card's orientation; every other slot keeps the old path
// exactly. The shipped profiles carry the flag and the family's sizes
// (tests/unit/cards/m15-sizes-integration.test.ts); these cases set them
// explicitly so each case reads on its own.
// ---------------------------------------------------------------------------

const FLOOR = ptToPct(RULES_TEXT.hardFloorPt);

/** A profile's title on the measured fit, at the family's name size. */
function measured(p: FrameProfile, over: Partial<FrameProfile> = {}): FrameProfile {
  return { ...p, ...over, title: { ...p.title, sizePct: TITLE_SIZE_PCT, fit: "measured" } };
}
const M15 = measured(getFrameProfile("m15"));
/** The walker as v32 prints it: the family's name size and discs. */
const PW = measured(getFrameProfile("m15pw"), { costSizePct: COST_DISC_PCT });

const metricsOf = (p: FrameProfile) => ({ letterSpacingEm: p.title.letterSpacingEm, uppercase: p.title.uppercase });
/** A name's measured width at `size` (card-width fraction). */
const width = (p: FrameProfile, name: string, size: number, headroom = TITLE_FIT_HEADROOM) =>
  displayTextWidthEm(name, metricsOf(p)) * size * headroom;

describe("fitTitleBand — the old path", () => {
  it("is fitDetachedCostTitle (or nothing) for every slot without the flag", () => {
    const names = ["Wing", "Miner the Miner, Damned Delver", "Vinnie 'Goldfang' Lupo, Boss of Burrow Street"];
    const costs = [null, "", "{W}", "{1}{R}{W}{B}", "{W}".repeat(14)];
    for (const template of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(template);
      if (p.title.fit === "measured") continue;
      for (const name of names) {
        for (const cost of costs) {
          const want = cost?.trim() ? fitDetachedCostTitle(p, name, cost) : null;
          expect(fitTitleBand(p, name, cost), `${template} ${name} ${cost}`).toEqual(want);
          expect(fitTitleBand(p, name, cost, "landscape")).toEqual(want);
        }
      }
    }
  });
});

describe("fitTitleBand — a measured name beside an inline cost", () => {
  it("leaves the name the band less the band gap and the cost row as the bake draws it", () => {
    const cost = "{4}{W}";
    expect(titleBandRoomPct(M15, cost)).toBeCloseTo(
      M15.title.rect.widthPct / 100 - BAND_GAP_PCT - costRowWidthPct(cost, M15.costSizePct!),
      12,
    );
    // The pips never shrink: the disc is the profile's, whatever the name.
    expect(titleBandRoomPct(M15, "{W}".repeat(3))).toBeGreaterThan(titleBandRoomPct(M15, "{W}".repeat(4)));
  });

  it("keeps a name that fits at the family's size, whole", () => {
    expect(fitTitleBand(M15, "Serra Angel", "{3}{W}{W}")).toEqual({
      text: "Serra Angel",
      widthPct: titleBandRoomPct(M15, "{3}{W}{W}"),
      sizePct: TITLE_SIZE_PCT,
    });
  });

  it("shrinks, whole, a name the band's old CSS ellipsis would have cut at the family's size", () => {
    // Both fit today at 75 px; at 80 px, beside 72.75 px discs, they don't:
    // the old path would cut them, the fit sets them a little smaller,
    // filling the room exactly.
    for (const [name, cost] of [
      ["Mayor Ezekiel, Corrupt Official", "{4}{W}"],
      ["Kaelis, Whisperwood Sage", "{1}{U}{B}{R}"],
    ] as const) {
      expect(width(M15, name, TITLE_SIZE_PCT), name).toBeGreaterThan(titleBandRoomPct(M15, cost));
      const fit = fitTitleBand(M15, name, cost)!;
      expect(fit.text).toBe(name);
      expect(fit.sizePct).toBeLessThan(TITLE_SIZE_PCT);
      expect(width(M15, name, fit.sizePct)).toBeCloseTo(fit.widthPct, 12);
    }
  });

  it("shrinks a long name only as far as the room needs, instead of cutting it (Vinnie 'Goldfang' Lupo…)", () => {
    const name = "Vinnie 'Goldfang' Lupo, Boss of Burrow Street";
    const fit = fitTitleBand(M15, name, "{2}{B}{R}")!;
    expect(fit.text).toBe(name);
    expect(fit.sizePct).toBeLessThan(TITLE_SIZE_PCT);
    expect(fit.sizePct).toBeGreaterThan(FLOOR);
    expect(width(M15, name, fit.sizePct)).toBeCloseTo(fit.widthPct, 12);
    // The smallest public name at v32: ≈ 5.6 pt, above the 5 pt floor.
    expect(pctToPt(fit.sizePct)).toBeGreaterThan(5.5);
    expect(pctToPt(fit.sizePct)).toBeLessThan(5.7);
  });

  it("past the floor cuts the name with a whole '…' that fits, and never grows a name", () => {
    const name = "Skeptic, the Endlessly Wandering Walker of Worlds and Every Plane Between";
    const fit = fitTitleBand(M15, name, "{2}{W}{U}{B}")!;
    expect(fit.sizePct).toBe(FLOOR);
    expect(fit.text.endsWith("…")).toBe(true);
    expect(name.startsWith(fit.text.slice(0, -1))).toBe(true);
    expect(width(M15, fit.text, FLOOR)).toBeLessThanOrEqual(fit.widthPct + 1e-12);
    expect(fitTitleBand(M15, "Wing", "{W}")!.sizePct).toBe(TITLE_SIZE_PCT);
  });

  it("keeps a few letters beside a 64-character cost, and leaves the pips their size", () => {
    const cost = "{W}{U}{B}{R}{G}{C}{X}{2}{W}{U}{B}{R}{G}{C}{X}{2}{W}{U}{B}{R}{G}";
    expect(cost).toHaveLength(63);
    expect(titleBandRoomPct(M15, cost)).toBeLessThan(0);
    const fit = fitTitleBand(M15, "Skeptic, the Endless", cost)!;
    expect(fit.sizePct).toBe(FLOOR);
    // MIN_NAME_EM at the floor's whole px in the bake (it may round up by
    // half a pixel), so the "…" it cuts fits there.
    expect(fit.widthPct).toBeCloseTo(MIN_NAME_EM * (FLOOR + HALF_PX_PCT), 12);
    expect(fit.text).toMatch(/^Sk\S*…$/u);
    expect(width(M15, fit.text, FLOOR + HALF_PX_PCT)).toBeLessThanOrEqual(fit.widthPct + 1e-12);
    // A short name keeps its whole self.
    expect(fitTitleBand(M15, "Ox", cost)!.text).toBe("Ox");
  });
});

describe("fitTitleBand — a measured name with no cost beside it", () => {
  it("has the whole band on a start-aligned band too (a measured bake band draws no filler span)", () => {
    const land = measured(getFrameProfile("m15land"));
    expect(titleBandRoomPct(land, null)).toBeCloseTo(land.title.rect.widthPct / 100, 12);
    // A land shows no cost whatever it was given: the renderers pass null.
    const name = "Training Ground: Waterfall Basin";
    const fit = fitTitleBand(land, name, null)!;
    expect(fit.text).toBe(name);
    expect(fit.sizePct).toBeLessThan(TITLE_SIZE_PCT);
    expect(width(land, name, fit.sizePct)).toBeCloseTo(fit.widthPct, 12);
    // No cost at all, on a spell: the long name shrinks too.
    const spell = fitTitleBand(M15, "Asmoranomardicadaistinaculdacar", "")!;
    expect(spell.text).toBe("Asmoranomardicadaistinaculdacar");
    expect(width(M15, "Asmoranomardicadaistinaculdacar", TITLE_SIZE_PCT)).toBeGreaterThan(spell.widthPct);
    expect(spell.sizePct).toBeLessThan(TITLE_SIZE_PCT);
  });

  it("has the whole band on a centred band (tokens)", () => {
    const token = measured(getFrameProfile("m15token"));
    expect(token.title.align).toBe("center");
    expect(titleBandRoomPct(token, null)).toBeCloseTo(token.title.rect.widthPct / 100, 12);
    expect(fitTitleBand(token, "Soldier", null)).toEqual({
      text: "Soldier",
      widthPct: token.title.rect.widthPct / 100,
      sizePct: TITLE_SIZE_PCT,
    });
  });
});

describe("fitTitleBand — a measured name before a detached cost (the planeswalker)", () => {
  // Owner decision 2026-09-28: the walker's discs are the family's (0.0485)
  // and its name room is tuned against print. Each walker's name as the HD
  // bake sets it (measuredLinePx) beside its print's (the name's x-height
  // em, 4.20 print review): never bigger than the print, within 1 px of it
  // wherever our Beleren fits the print's name; Nissa and Tezzeret, which
  // it sets 4–7 % wider than the print's Beleren (TODO 4.8), shrink more.
  const PRINTED: [string, string, number, number][] = [
    ["Chandra, Torch of Defiance", "{2}{R}{R}", 78, 78.1], // KLD #110
    ["Gideon, Ally of Zendikar", "{2}{W}{W}", 80, 80.7], // BFZ #29
    ["Karn, Scion of Urza", "{4}", 80, 81.2], // DOM #1
    ["Liliana, Death's Majesty", "{3}{B}{B}", 80, 84.7], // AKH #97
    ["Kaya, Bane of the Dead", "{3}{W/B}{W/B}{W/B}", 80, 80.3], // WAR #231
    ["Nissa, Who Shakes the World", "{3}{G}{G}", 75, 78.9], // WAR #169
    ["Tezzeret, Master of the Bridge", "{4}{U}{B}", 72, 79.1], // WAR #275
  ];

  it.each(PRINTED)("sets %s whole, as big as its print allows and a band gap before its pips", (name, cost, px, printPx) => {
    const fit = fitTitleBand(PW, name, cost)!;
    expect(fit.text).toBe(name);
    expect(measuredLinePx(fit.sizePct, TITLE_SIZE_PCT, 1500)).toBe(px);
    expect(px).toBeLessThanOrEqual(printPx + 1);
    expect(px).toBeGreaterThanOrEqual(0.9 * printPx);
    // The name's box ends at least one band gap before the first disc, as
    // an inline cost's does (the prints leave 39–57 px of ink).
    const box = PW.costRect!;
    const pipsLeft = (box.leftPct + box.widthPct) / 100 - manaCostWidthPct(cost, COST_DISC_PCT);
    expect(PW.title.rect.leftPct / 100 + width(PW, name, px / 1500, 1) + BAND_GAP_PCT).toBeLessThanOrEqual(pipsLeft + 1e-12);
  });

  it("measures the name's advances against the room to the first disc, one band gap clear", () => {
    const cost = "{2}{R}{R}";
    const box = PW.costRect!;
    const pipsLeft = (box.leftPct + box.widthPct) / 100 - manaCostWidthPct(cost, COST_DISC_PCT);
    expect(DETACHED_COST_GAP_PCT).toBe(BAND_GAP_PCT);
    const room = pipsLeft - PW.title.rect.leftPct / 100 - DETACHED_COST_GAP_PCT;
    expect(titleBandRoomPct(PW, cost)).toBeCloseTo(room, 12);
    // A longer name shrinks until its advances fill the room exactly; the
    // span's max-width keeps the headroom on top, so neither renderer's
    // ellipsis cuts it.
    const name = "Nicol Bolas, the Arisen Dragon-God";
    const fit = fitTitleBand(PW, name, "{2}{U}{B}{R}")!;
    expect(fit.text).toBe(name);
    expect(fit.sizePct).toBeLessThan(TITLE_SIZE_PCT);
    expect(width(PW, name, fit.sizePct, 1)).toBeCloseTo(titleBandRoomPct(PW, "{2}{U}{B}{R}"), 12);
    expect(fit.widthPct).toBeCloseTo(titleBandRoomPct(PW, "{2}{U}{B}{R}") * TITLE_FIT_HEADROOM, 12);
  });

  it("never gives a name more room than its band, where the bake lays it out (one pip, pips far right)", () => {
    // The layout-v32 review's blocker: a one-pip cost left a name more room
    // than the bake's band did, and Satori cut it with its own "…" while the
    // preview drew it whole. The room is capped at the band (less half a px:
    // the bake rounds a full-size name up), and a measured bake band draws
    // no filler span to take a gap from it.
    const farRight = { ...PW, costRect: { ...PW.costRect!, leftPct: 60 } };
    const band = PW.title.rect.widthPct / 100;
    for (const p of [PW, farRight]) {
      for (const name of ["Ajani, Betrayer of the First Light", "Teferi, the Harbinger of Stone II", "Sorin, Master of Time and Tides,"]) {
        for (const cost of ["{B}", "{4}", "{X}"]) {
          const fit = fitTitleBand(p, name, cost)!;
          expect(titleBandRoomPct(p, cost)).toBeLessThanOrEqual(band - HALF_PX_PCT + 1e-12);
          expect(fit.text).toBe(name);
          for (const W of [750, 1500]) {
            const px = measuredLinePx(fit.sizePct, TITLE_SIZE_PCT, W);
            // The name's box in whole px fits the band's px.
            expect(displayTextWidthEm(name, metricsOf(p)) * px, `${name} ${cost} ${W}`).toBeLessThanOrEqual(band * W);
          }
        }
      }
    }
  });

  it("stops at the floor and cuts with a whole '…' past it (a 14-symbol cost)", () => {
    const fit = fitTitleBand(PW, "Skeptic, the Endlessly Wandering Walker of Worlds", "{W}".repeat(14))!;
    expect(fit.sizePct).toBe(FLOOR);
    expect(fit.text.endsWith("…")).toBe(true);
    // Measured at the floor's whole px in the bake.
    expect(width(PW, fit.text, FLOOR + HALF_PX_PCT, 1)).toBeLessThanOrEqual(titleBandRoomPct(PW, "{W}".repeat(14)) + 1e-12);
  });
});

describe("fitTitleBand — the adventure panel", () => {
  const adv = getFrameProfile("adventure").adventure!;
  const panel = {
    title: { ...adv.title, sizePct: ADVENTURE_PANEL_PCT, fit: "measured" as const },
    costSizePct: ADVENTURE_PANEL_COST_PCT,
  };

  it("fits a printed adventure name before its inline cost instead of cutting it (Heartflame Slash)", () => {
    for (const [name, cost] of [
      ["Heartflame Slash", "{2}{R}"],
      ["Locthwain Scorn", "{1}{B}"],
      ["Fertile Footsteps", "{2}{G}"],
      ["Stomp", "{1}{R}"],
    ] as const) {
      const fit = fitTitleBand(panel, name, cost)!;
      expect(fit.text, name).toBe(name);
      expect(fit.sizePct).toBeGreaterThan(FLOOR);
      expect(width(panel as FrameProfile, name, fit.sizePct)).toBeLessThanOrEqual(fit.widthPct + 1e-12);
    }
    expect(fitTitleBand(panel, "Stomp", "{1}{R}")!.sizePct).toBe(ADVENTURE_PANEL_PCT);
  });

  it("is what the shipped panel carries (layout v32)", () => {
    expect(adv.title.fit).toBe("measured");
    expect(adv.title.sizePct).toBe(ADVENTURE_PANEL_PCT);
    expect(adv.costSizePct).toBe(ADVENTURE_PANEL_COST_PCT);
    expect(fitTitleBand({ title: adv.title, costSizePct: adv.costSizePct }, "Heartflame Slash", "{2}{R}")).toEqual(
      fitTitleBand(panel, "Heartflame Slash", "{2}{R}"),
    );
  });

  it("leaves a panel without the flag on its old sizes (no fit)", () => {
    expect(
      fitTitleBand({ title: { ...adv.title, fit: undefined }, costSizePct: adv.costSizePct }, "Heartflame Slash", "{2}{R}"),
    ).toBeNull();
  });
});

describe("fitTitleBand — the floor follows the card's orientation", () => {
  it("floors a landscape card at 5 pt of ITS width, not the portrait 5 pt (≈ 7 pt there)", () => {
    const name = "W".repeat(80);
    expect(fitTitleBand(M15, name, "{1}")!.sizePct).toBe(FLOOR);
    const landscape = fitTitleBand(M15, name, "{1}", "landscape")!;
    expect(landscape.sizePct).toBe(ptToPct(RULES_TEXT.hardFloorPt, "landscape"));
    expect(pctToPt(landscape.sizePct, "landscape")).toBeCloseTo(5, 10);
    // …also beside a cost that leaves it only MIN_NAME_EM: the landscape
    // floor, not the portrait one, sizes that minimum room.
    const huge = "{W}".repeat(21);
    const cramped = fitTitleBand(M15, "Skeptic, the Endless", huge, "landscape")!;
    const lf = ptToPct(RULES_TEXT.hardFloorPt, "landscape");
    expect(cramped.sizePct).toBe(lf);
    expect(cramped.widthPct).toBeCloseTo(MIN_NAME_EM * (lf + HALF_PX_PCT), 12);
    // A slot set below the floor keeps its own size — the old fit clamped it up.
    const small = { ...M15, title: { ...M15.title, sizePct: 0.02 } };
    expect(fitTitleBand(small, "Fire", "{1}{R}", "portrait")!.sizePct).toBe(0.02);
  });
});
