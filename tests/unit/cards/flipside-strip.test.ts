import { describe, expect, it } from "vitest";
import { flipsideLineRuns, flipsideStrip } from "@/lib/cards/flipside-strip";
import { otherFaceOf } from "@/lib/cards/faces";
import { metricsFor, runWidthPx } from "@/lib/cards/rules-layout";
import { MDFC_FLIPSIDE_BACK, MDFC_FLIPSIDE_FRONT, getFrameProfile } from "@/lib/cards/template-layout";
import { MDFC_STRIP_LINE_PX, MDFC_STRIP_WORD_PX, RULES_TEXT } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// TODO 5.1b — the modal strip's texts (lib/cards/flipside-strip.ts): the
// OTHER face's last type word and its cost / mana line as ONE unwrapped
// inline-pip run at the rules layout's own metrics — what both renderers
// draw, on every scan case of the design (Land, Sorcery, Instant,
// Equipment, Artifact, God, Warrior, Druid, Monk, Tibalt) and the land's
// mana line.
// ---------------------------------------------------------------------------

const CASES: Array<[string, Parameters<typeof otherFaceOf>[0], string, string | null]> = [
  ["ZNR #12 Emeria's Call's back (a land)", { cardType: "land", rulesText: "As Emeria, Shattered Skyclave enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {W}." }, "Land", "{T}: Add {W}."],
  ["ZNR #12's front (a sorcery)", { cardType: "sorcery", cost: "{4}{W}{W}{W}" }, "Sorcery", "{4}{W}{W}{W}"],
  ["MH3 #241 Sink into Stupor (an instant)", { cardType: "instant", cost: "{2}{U}" }, "Instant", "{2}{U}"],
  ["KHM #15 Sword of the Realms (Equipment)", { cardType: "artifact", supertype: "Legendary", subtypes: ["Equipment"], cost: "{1}{W}" }, "Equipment", "{1}{W}"],
  ["KHM #179 Kaldring (an artifact, no subtype)", { cardType: "artifact", supertype: "Legendary Snow", subtypes: [], cost: "{3}{G}" }, "Artifact", "{3}{G}"],
  ["KHM #15 Halvar (God)", { cardType: "creature", supertype: "Legendary", subtypes: ["God"], cost: "{2}{W}{W}" }, "God", "{2}{W}{W}"],
  ["ZNR #134 Akoum Warrior (Warrior)", { cardType: "creature", subtypes: ["Minotaur", "Warrior"], cost: "{5}{R}" }, "Warrior", "{5}{R}"],
  ["STX #147 Augmenter Pugilist (Druid)", { cardType: "creature", subtypes: ["Troll", "Druid"], cost: "{1}{G}{G}" }, "Druid", "{1}{G}{G}"],
  ["MH3 #246 Pinnacle Monk (Monk)", { cardType: "creature", subtypes: ["Djinn", "Monk"], cost: "{3}{R}" }, "Monk", "{3}{R}"],
  ["KHM #114 Tibalt, Cosmic Impostor (Tibalt)", { cardType: "planeswalker", supertype: "Legendary", subtypes: ["Tibalt"], cost: "{5}{B}{R}" }, "Tibalt", "{5}{B}{R}"],
  ["a hybrid land's mana line (MH3 #252's back)", { cardType: "land", rulesText: "{T}: Add {B} or {R}." }, "Land", "{T}: Add {B} or {R}."],
];

describe("flipsideStrip", () => {
  it.each(CASES)("%s: the word and the line", (_label, face, word, line) => {
    const strip = flipsideStrip(MDFC_FLIPSIDE_FRONT, otherFaceOf(face), "hd");
    expect(strip?.word).toBe(word);
    if (line === null) {
      expect(strip?.line).toBeNull();
      return;
    }
    expect(strip?.line).not.toBeNull();
    // One line: every item of the text in its runs, the pips as pips.
    const items = strip!.line!.runs.flat();
    const pips = items.filter((i) => i.t === "m").map((i) => (i as { suffix: string }).suffix);
    // The tokeniser's suffixes: mana-font's class names ({T} is `tap`).
    expect(pips).toEqual([...line.matchAll(/\{([^}]+)\}/g)].map((m) => (m[1] === "T" ? "tap" : m[1].toLowerCase().replace("/", ""))));
    const words = items.filter((i) => i.t === "w").map((i) => (i as { v: string }).v).join(" ");
    expect(words).toBe(line.replace(/\{[^}]+\}/g, "").replace(/\s+/g, " ").trim());
  });

  it("lays the line out at MDFC_STRIP_LINE_PX with the rules layout's own metrics, at both targets — its width the runs' widths a word gap apart", () => {
    const other = otherFaceOf({ cardType: "land", rulesText: "{T}: Add {W}." });
    for (const target of ["hd", "default"] as const) {
      const strip = flipsideStrip(MDFC_FLIPSIDE_FRONT, other, target)!;
      const m = metricsFor(MDFC_STRIP_LINE_PX, RULES_TEXT.lineHeight, target);
      expect(strip.line!.metrics).toEqual(m);
      expect(strip.line!.widthPx).toBe(strip.line!.runs.reduce((w, run, i) => w + (i > 0 ? m.wordGapPx : 0) + runWidthPx(run, m), 0));
      // "{T}: Add {W}." — the prints' line runs ≈ 240 px at HD (409–650).
      if (target === "hd") expect(strip.line!.widthPx).toBeGreaterThan(200);
      if (target === "hd") expect(strip.line!.widthPx).toBeLessThan(290);
    }
    expect(flipsideStrip(MDFC_FLIPSIDE_FRONT, other, "default")!.line!.metrics.fontPx).toBe(MDFC_STRIP_LINE_PX / 2);
  });

  it("never wraps: a long line is ONE line of runs", () => {
    const runs = flipsideLineRuns("{T}: Add {W}, {U}, {B}, {R}, {G} or one mana of any color to your mana pool.");
    expect(runs.length).toBeGreaterThan(8);
    // {T} and the five colours: six pips on one line.
    expect(runs.flat().filter((i) => i.t === "m")).toHaveLength(6);
  });

  it("nothing to draw: no slots (a non-modal body), no other face, or a face with neither a type line nor a line", () => {
    expect(flipsideStrip(null, otherFaceOf({ cardType: "land", rulesText: "{T}: Add {W}." }), "hd")).toBeNull();
    expect(flipsideStrip(getFrameProfile("m15dfcfront").flipside, otherFaceOf({ cardType: "land" }), "hd")).toBeNull();
    expect(flipsideStrip(MDFC_FLIPSIDE_FRONT, null, "hd")).toBeNull();
    expect(flipsideStrip(MDFC_FLIPSIDE_FRONT, otherFaceOf({}), "hd")).toBeNull();
    // A word alone (a back with no cost and no mana line: an unfinished
    // back) draws the word.
    expect(flipsideStrip(MDFC_FLIPSIDE_FRONT, otherFaceOf({ cardType: "creature", subtypes: ["Human"] }), "hd")).toEqual({ word: "Human", line: null });
  });

  it("the profiles: both slots in CC's flipside box, the word in Beleren Bold from the left, the line in the rules font against the right; white on a front, dark on a back; the land pair the same", () => {
    const box = { leftPct: 6.8, topPct: 89.2, widthPct: 36.4, heightPct: 3.91 };
    for (const slots of [MDFC_FLIPSIDE_FRONT, MDFC_FLIPSIDE_BACK]) {
      expect(slots.word.rect).toEqual(box);
      expect(slots.line.rect).toEqual(box);
      expect(slots.word).toMatchObject({ font: "display", weight: 700, align: "start", sizePct: MDFC_STRIP_WORD_PX / 1500 });
      expect(slots.line).toMatchObject({ font: "body", align: "end", sizePct: MDFC_STRIP_LINE_PX / 1500 });
    }
    expect(MDFC_FLIPSIDE_FRONT.word.colorHex).toBe("#ffffff");
    expect(MDFC_FLIPSIDE_FRONT.line.colorHex).toBe("#ffffff");
    expect(MDFC_FLIPSIDE_BACK.word.colorHex).toBe("#17120c");
    expect(MDFC_FLIPSIDE_BACK.line.colorHex).toBe("#17120c");
    expect(getFrameProfile("m15mdfcfront").flipside).toBe(MDFC_FLIPSIDE_FRONT);
    expect(getFrameProfile("m15mdfclandfront").flipside).toBe(MDFC_FLIPSIDE_FRONT);
    expect(getFrameProfile("m15mdfcback").flipside).toBe(MDFC_FLIPSIDE_BACK);
    expect(getFrameProfile("m15mdfclandback").flipside).toBe(MDFC_FLIPSIDE_BACK);
    for (const t of ["m15", "m15dfcfront", "m15dfcback", "m15dfclandback"]) expect(getFrameProfile(t).flipside, t).toBeUndefined();
    // 49 / 54 HD px: CC's 0.0234 H / 0.0258 H.
    expect(MDFC_STRIP_WORD_PX).toBe(49);
    expect(MDFC_STRIP_LINE_PX).toBe(54);
  });
});
