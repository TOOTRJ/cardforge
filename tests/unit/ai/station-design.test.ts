import { describe, expect, it } from "vitest";
import printed from "./fixtures/station-printed.json";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";
import emblemPrintings from "../scryfall/fixtures/emblem-printings.json";
import {
  STATION_DESIGN_EXAMPLE,
  STATION_DESIGN_RULES,
  emptyStationTiers,
  expectedStationLine,
  mergeStationFill,
  repairStationText,
  sameStationShape,
  stationDesignProblems,
  stationFillNote,
  stationGapUnfilledMessage,
  stationGapsLeftEmpty,
  stationPtChoiceAfterFill,
  stationSaveFields,
  stationWordOf,
} from "@/lib/ai/station-design";
import { autofixCard, lintCardDesign, type LintableCard } from "@/lib/ai/mtg-rules";
import { parseStationText, platedTierIndex } from "@/lib/cards/station";
import { stationReminder } from "@/lib/creator/station-rows";
import { subtypeDressOf } from "@/lib/creator/card-kinds";
import { faceContentSchema } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// TODO 4.27a, PR 3 — Spacecraft and Planets in the AI engine, the pure half.
//
// `fixtures/station-printed.json` is every card Scryfall lists under
// `keyword:station` (one row per card, 2026-10-14): what the designer's
// prompt, the lint and the autofix are written from. The first block pins
// the grammar the PR body quotes, so the numbers there are the fixture's.
// ---------------------------------------------------------------------------

type Printed = (typeof printed)[number];
const isPlanet = (card: Printed) => card.type_line.includes("Planet");
const isPaper = (card: Printed) => !card.set.startsWith("y");

/** A printing as the designer would have to write it. */
function asDesigned(card: Printed): LintableCard {
  return {
    title: card.name,
    cost: card.mana_cost || "—",
    card_type: isPlanet(card) ? "land" : "artifact",
    supertype: card.type_line.startsWith("Legendary") ? "Legendary" : null,
    subtypes: [isPlanet(card) ? "Planet" : "Spacecraft"],
    color_identity: ["colorless"],
    rules_text: card.oracle_text,
    power: card.power,
    toughness: card.toughness,
    loyalty: null,
    defense: null,
  };
}

const count = <T,>(items: T[], test: (item: T) => boolean) => items.filter(test).length;

describe("the printed grammar (Scryfall, keyword:station — 35 cards)", () => {
  const cards = printed.map((card) => ({ card, text: parseStationText(card.oracle_text, card.power !== null) }));

  it("30 Spacecraft and 5 Planets; 32 in paper, 3 Arena-only", () => {
    expect(printed).toHaveLength(35);
    expect(count(printed, isPlanet)).toBe(5);
    expect(count(printed, (card) => card.type_line.includes("Artifact — Spacecraft"))).toBe(30);
    expect(count(printed, isPaper)).toBe(32);
    // Never an "Artifact Creature": a Spacecraft becomes one.
    expect(count(printed, (card) => card.type_line.includes("Creature"))).toBe(0);
  });

  it("one tier on 27 cards, two on 8 (all Spacecraft), three on none; numbers 1+ … 20+, rising", () => {
    expect(count(cards, ({ text }) => text.tiers.length === 1)).toBe(27);
    expect(count(cards, ({ text }) => text.tiers.length === 2)).toBe(8);
    expect(count(cards, ({ card, text }) => text.tiers.length === 2 && isPlanet(card))).toBe(0);
    const numbers = cards.flatMap(({ text }) => text.tiers.map((tier) => tier.threshold));
    expect(Math.min(...numbers)).toBe(1);
    expect(Math.max(...numbers)).toBe(20);
    for (const { text } of cards) for (const [i, tier] of text.tiers.entries()) if (i > 0) expect(tier.threshold).toBeGreaterThan(text.tiers[i - 1]!.threshold);
    // Two tiers: the first 1+ … 3+ on 7 of 8, the last 8+ or more.
    const two = cards.filter(({ text }) => text.tiers.length === 2).map(({ text }) => text.tiers.map((tier) => tier.threshold));
    expect(count(two, ([first]) => first! <= 3)).toBe(7);
    expect(two.every(([, last]) => last! >= 8)).toBe(true);
    // A lone Spacecraft tier: 3+ … 20+, most often 7+ and 8+; every Planet 12+.
    const lone = cards.filter(({ card, text }) => text.tiers.length === 1 && !isPlanet(card)).map(({ text }) => text.tiers[0]!.threshold);
    expect([Math.min(...lone), Math.max(...lone)]).toEqual([3, 20]);
    expect([count(lone, (n) => n === 7), count(lone, (n) => n === 8)]).toEqual([6, 5]);
    expect(cards.filter(({ card }) => isPlanet(card)).every(({ text }) => text.tiers[0]!.threshold === 12)).toBe(true);
  });

  it("the Station line is the last line of the top band, word for word — its N the last tier's", () => {
    let withSentence = 0;
    for (const { card, text } of cards) {
      const lines = text.intro.split("\n");
      const last = lines[lines.length - 1]!;
      expect(last.startsWith("Station"), card.name).toBe(true);
      expect(count(lines, (line) => line.startsWith("Station")), card.name).toBe(1);
      if (!isPaper(card)) {
        expect(last, card.name).toBe("Station");
        continue;
      }
      const hasPt = card.power !== null;
      const lastTier = text.tiers[text.tiers.length - 1]!.threshold;
      expect(last, card.name).toBe(stationReminder(isPlanet(card) ? "Planet" : "Spacecraft", hasPt ? lastTier : null));
      if (hasPt) withSentence += 1;
    }
    // 26 paper Spacecraft with a P/T; The Eternity Elevator and the Planets end at "…as a sorcery.)".
    expect(withSentence).toBe(26);
    expect(count(printed, (card) => isPaper(card) && !isPlanet(card) && card.power === null)).toBe(1);
  });

  it("the P/T is on the last tier, which starts with Flying on 28 of 29; no Planet has one", () => {
    const ships = cards.filter(({ card }) => card.power !== null);
    expect(ships).toHaveLength(29);
    expect(count(cards, ({ card }) => isPlanet(card) && card.power !== null)).toBe(0);
    for (const { text } of ships) expect(platedTierIndex(text.intro, text.tiers)).toBe(text.tiers.length - 1);
    expect(count(ships, ({ text }) => /^Flying\b/.test(text.tiers[text.tiers.length - 1]!.text))).toBe(28);
  });

  it("before the Station line: nothing on 10 Spacecraft, one line on 19, two on 1; two on every Planet", () => {
    const before = (card: Printed) => parseStationText(card.oracle_text).intro.split("\n").length - 1;
    const ships = printed.filter((card) => !isPlanet(card));
    expect([0, 1, 2].map((n) => count(ships, (card) => before(card) === n))).toEqual([10, 19, 1]);
    expect(printed.filter(isPlanet).every((card) => before(card) === 2)).toBe(true);
  });

  it("texts run 144–423 characters, a tier 6–183: far inside the row limit", () => {
    const lengths = printed.map((card) => card.oracle_text.length);
    expect([Math.min(...lengths), Math.max(...lengths)]).toEqual([144, 423]);
    const tiers = cards.flatMap(({ text }) => text.tiers.map((tier) => tier.text.length));
    expect([Math.min(...tiers), Math.max(...tiers)]).toEqual([6, 183]);
  });
});

describe("the designer's prompt says what print does", () => {
  it("quotes the Station line word for word, for both words", () => {
    expect(STATION_DESIGN_RULES).toContain(
      "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at N+.)",
    );
    expect(STATION_DESIGN_RULES).toContain('"on this Planet"');
    expect(STATION_DESIGN_RULES).toContain('"N+ | text"');
  });

  it("its example is a card the lint passes", () => {
    const example = JSON.parse(STATION_DESIGN_EXAMPLE) as LintableCard;
    expect(stationWordOf(example)).toBe("Spacecraft");
    expect(lintCardDesign(example).errors).toEqual([]);
    expect(parseStationText(example.rules_text, true).tiers.map((tier) => [tier.threshold, tier.pt])).toEqual([
      [2, false],
      [9, true],
    ]);
  });
});

describe("which cards are station cards", () => {
  it("the frames' own gate: an artifact that says Spacecraft, a land that says Planet", () => {
    expect(subtypeDressOf("m15station")).toBe("Spacecraft");
    expect(subtypeDressOf("m15stationland")).toBe("Planet");
    expect(stationWordOf({ card_type: "artifact", subtypes: ["Spacecraft"] })).toBe("Spacecraft");
    expect(stationWordOf({ card_type: "artifact", subtypes: ["Vehicle", "spacecraft "] })).toBe("Spacecraft");
    expect(stationWordOf({ card_type: "land", subtypes: ["Planet"] })).toBe("Planet");
    for (const other of [
      { card_type: "artifact", subtypes: ["Vehicle"] },
      { card_type: "artifact", subtypes: ["Planet"] },
      { card_type: "land", subtypes: ["Spacecraft"] },
      { card_type: "creature", subtypes: ["Spacecraft"] },
      { card_type: "token", subtypes: ["Spacecraft"] },
      { card_type: "artifact", subtypes: [] },
    ]) {
      expect(stationWordOf(other), JSON.stringify(other)).toBeNull();
    }
  });
});

describe("the lint holds a designed Spacecraft / Planet to the printed shape", () => {
  it("every paper printing passes; the three Arena-only ones only lack the reminder", () => {
    for (const card of printed) {
      const problems = stationDesignProblems(asDesigned(card));
      if (isPaper(card)) expect(problems, card.name).toEqual([]);
      else expect(problems, card.name).toEqual([expect.stringContaining("must be the Station line, word for word")]);
    }
  });

  const ship = (rules_text: string, over: Partial<LintableCard> = {}): LintableCard => ({
    title: "Hollow Hull",
    cost: "{3}",
    card_type: "artifact",
    supertype: null,
    subtypes: ["Spacecraft"],
    color_identity: ["colorless"],
    rules_text,
    power: "3",
    toughness: "5",
    loyalty: null,
    defense: null,
    ...over,
  });
  const line = (n: number | null, word: "Spacecraft" | "Planet" = "Spacecraft") => stationReminder(word, n);
  const rulesErrors = (card: LintableCard) =>
    lintCardDesign(card)
      .errors.filter((issue) => issue.field === "rules_text")
      .map((issue) => issue.message);

  it("no tier is an ERROR: the card's P/T would not be drawn", () => {
    expect(rulesErrors(ship("Flying\nWhen this Spacecraft enters, draw a card."))).toEqual([expect.stringContaining('add one to three lines "N+ | text"')]);
    expect(rulesErrors(ship(""))).toHaveLength(1);
  });

  it("four tiers, numbers that do not rise, an empty tier", () => {
    expect(rulesErrors(ship(`${line(9)}\n1+ | A.\n3+ | B.\n6+ | C.\n9+ | Flying`))).toEqual([expect.stringContaining("at most 3 tiers")]);
    expect(rulesErrors(ship(`${line(4)}\n8+ | Vigilance\n4+ | Flying`))).toEqual([expect.stringContaining("4+ comes after 8+")]);
    expect(rulesErrors(ship(`${line(8)}\n2+ |\n8+ | Flying`))).toEqual([expect.stringContaining("Tier 2+ has no text")]);
  });

  it("the Station line: missing, reworded, not last, naming no tier, or a Planet's on a Spacecraft", () => {
    const wanted = expect.stringContaining(`word for word: "${line(8)}"`);
    expect(rulesErrors(ship("8+ | Flying"))).toEqual([wanted]);
    expect(rulesErrors(ship("Station\n8+ | Flying"))).toEqual([wanted]);
    expect(rulesErrors(ship(`${line(null)}\n8+ | Flying`))).toEqual([wanted]);
    expect(rulesErrors(ship(`${line(6)}\n8+ | Flying`))).toEqual([wanted]);
    expect(rulesErrors(ship(`${line(8, "Planet")}\n8+ | Flying`))).toEqual([wanted]);
    expect(rulesErrors(ship(`${line(8)}\nWhen this Spacecraft enters, draw a card.\n8+ | Flying`))).toEqual([wanted]);
    expect(rulesErrors(ship(`Station (Tap a creature: put counters on this.)\n8+ | Flying`))).toEqual([wanted]);
    // As print sets it — a curly apostrophe is the same line.
    expect(rulesErrors(ship(`When this Spacecraft enters, draw a card.\n${line(8).replace("'", "’")}\n8+ | Flying`))).toEqual([]);
    // The P/T may sit on ANY tier the line names (owner round 54, decision 6).
    expect(rulesErrors(ship(`${line(2)}\n2+ | Flying\n8+ | Trample`))).toEqual([]);
  });

  it("a Planet: tiers, no creature sentence, no power / toughness", () => {
    const planet = (rules_text: string, over: Partial<LintableCard> = {}) =>
      ship(rules_text, { card_type: "land", subtypes: ["Planet"], cost: "—", power: null, toughness: null, color_identity: ["green"], ...over });
    const good = `This land enters tapped.\n{T}: Add {G}.\n${line(null, "Planet")}\n12+ | {G}, {T}: Add {G}{G}.`;
    expect(lintCardDesign(planet(good)).errors).toEqual([]);
    expect(rulesErrors(planet(good.replace("sorcery.)", "sorcery. It's an artifact creature at 12+.)")))).toEqual([
      expect.stringContaining(`"${line(null, "Planet")}"`),
    ]);
    expect(rulesErrors(planet("{T}: Add {G}."))).toEqual([expect.stringContaining("A Planet prints its abilities in tiers")]);
    // The stats rule that was already there: a land has no P/T.
    expect(lintCardDesign(planet(good, { power: "1", toughness: "1" })).errors.map((issue) => issue.field)).toContain("power");
  });

  it("a band over the row limit", () => {
    const long = "Draw a card. ".repeat(60).trim();
    expect(rulesErrors(ship(`${line(8)}\n8+ | ${long}`))).toEqual([expect.stringContaining("Tier 8+ is over 600 characters")]);
  });

  it("says NOTHING about any other card — whatever its text", () => {
    const tierText = `${line(8)}\n2+ | Draw a card.\n8+ | Flying`;
    for (const card of [
      ship(tierText, { subtypes: ["Vehicle"] }),
      ship(tierText, { subtypes: [] }),
      ship(tierText, { card_type: "creature", subtypes: ["Spacecraft"] }),
      ship("3+ | odd text", { card_type: "enchantment", subtypes: [], power: null, toughness: null }),
    ]) {
      expect(stationDesignProblems(card)).toEqual([]);
      expect(repairStationText(card)).toBe(card.rules_text);
    }
    // …and over a corpus of real rules texts, as a creature and as a plain
    // artifact: no finding, and the autofix leaves every character alone.
    type Row = { oracle_text?: string | null; card_faces?: { oracle_text?: string | null }[] | null };
    const corpus = [...Object.values(signaturePrintings as unknown as Record<string, Row>), ...Object.values(emblemPrintings as unknown as Record<string, Row>)]
      .flatMap((row) => [row.oracle_text, ...(row.card_faces ?? []).map((face) => face.oracle_text)])
      .filter((text): text is string => Boolean(text));
    expect(corpus.length).toBeGreaterThan(20);
    for (const text of corpus) {
      for (const identity of [{ card_type: "creature" as const, subtypes: ["Human"] }, { card_type: "artifact" as const, subtypes: ["Equipment"] }]) {
        const card = ship(text, identity);
        expect(stationDesignProblems(card)).toEqual([]);
        expect(repairStationText(card)).toBe(text);
      }
    }
  });
});

describe("the autofix puts a Spacecraft's text into the printed shape — and invents nothing", () => {
  const ship = (rules_text: string, over: Partial<LintableCard> = {}): LintableCard => ({
    title: "Hollow Hull",
    cost: "{3}",
    card_type: "artifact",
    supertype: null,
    subtypes: ["Spacecraft"],
    color_identity: ["colorless"],
    rules_text,
    power: "3",
    toughness: "5",
    loyalty: null,
    defense: null,
    ...over,
  });

  it("the three Arena-only printings come out with print's reminder and pass", () => {
    for (const card of printed.filter((c) => !isPaper(c))) {
      const fixed = autofixCard(asDesigned(card));
      expect(stationDesignProblems(fixed), card.name).toEqual([]);
      // Their tiers are untouched.
      expect(parseStationText(fixed.rules_text).tiers).toEqual(parseStationText(card.oracle_text).tiers);
    }
  });

  it("every paper printing is left byte for byte", () => {
    for (const card of printed.filter(isPaper)) expect(repairStationText(asDesigned(card)), card.name).toBe(card.oracle_text);
  });

  it("near-miss tier lines, a missing line, numbers out of order, a fourth tier, an empty tier", () => {
    const fixed = repairStationText(
      ship("When this Spacecraft enters, scry 2.\nStation\nSTATION 9+: Flying, vigilance\n2+ — Draw a card.\n5 + | \n12+ | Trample\n20+ | Haste"),
    );
    expect(fixed).toBe(
      [
        "When this Spacecraft enters, scry 2.",
        stationReminder("Spacecraft", 12),
        "2+ | Draw a card.",
        "9+ | Flying, vigilance",
        "12+ | Trample\nHaste",
      ].join("\n"),
    );
    expect(stationDesignProblems(ship(fixed))).toEqual([]);
    expect(faceContentSchema.safeParse({ v: 1, station: { intro: "x", tiers: parseStationText(fixed).tiers.map(({ threshold, text }) => ({ threshold, text })) } }).success).toBe(true);
  });

  it("keeps the tier a correct Station line names; a Planet gets its own line", () => {
    const named = `${stationReminder("Spacecraft", 2)}\n2+ | Flying\n8+ | Trample`;
    expect(repairStationText(ship(named))).toBe(named);
    const planet = ship("{T}: Add {G}.\n12+: {G}, {T}: Add {G}{G}.", { card_type: "land", subtypes: ["Planet"], power: null, toughness: null });
    expect(repairStationText(planet)).toBe(`{T}: Add {G}.\n${stationReminder("Planet", null)}\n12+ | {G}, {T}: Add {G}{G}.`);
  });

  it("no tier at all: the text is returned as it is (a machine does not invent a tier)", () => {
    const tierless = ship("Flying\nWhen this Spacecraft enters, draw a card.");
    expect(repairStationText(tierless)).toBe(tierless.rules_text);
    expect(autofixCard(tierless).rules_text).toBe(tierless.rules_text);
    // …so the lint still names it, and the frame pick keeps it off the
    // station frame (tests/unit/creator/station-frame-gate.test.ts).
    expect(stationDesignProblems(autofixCard(tierless))).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = repairStationText(ship("Station\n8+: Flying\n3+: Draw a card."));
    expect(repairStationText(ship(once))).toBe(once);
  });

  it("expectedStationLine: the creature sentence only with a P/T, the named tier, else the last", () => {
    const tiers = [
      { threshold: 2, text: "A", pt: false },
      { threshold: 9, text: "B", pt: false },
    ];
    expect(expectedStationLine("Spacecraft", true, { intro: "", tiers })).toBe(stationReminder("Spacecraft", 9));
    expect(expectedStationLine("Spacecraft", true, { intro: "It's an artifact creature at 2+.", tiers })).toBe(stationReminder("Spacecraft", 2));
    expect(expectedStationLine("Spacecraft", false, { intro: "", tiers })).toBe(stationReminder("Spacecraft", null));
    expect(expectedStationLine("Planet", true, { intro: "", tiers })).toBe(stationReminder("Planet", null));
  });
});

describe("a fill of the rules text on a card that already has tiers", () => {
  const top = `When this Spacecraft enters, scry 2.\n${stationReminder("Spacecraft", 9)}`;
  const current = `${top}\n2+ | Whenever you cast an artifact spell,  scry 1.\n9+ | `;

  it("a tier left empty is the ONE line written; every other line is kept byte for byte", () => {
    expect(emptyStationTiers(current)).toEqual([1]);
    const designed = `Something else entirely.\n${stationReminder("Spacecraft", 9)}\n2+ | A rewritten first tier.\n9+ | Flying, vigilance\nWhenever this Spacecraft attacks, draw a card.`;
    const merged = mergeStationFill(current, designed);
    expect(merged).toBe(`${top}\n2+ | Whenever you cast an artifact spell,  scry 1.\n9+ | Flying, vigilance\nWhenever this Spacecraft attacks, draw a card.`);
    // The untouched lines, to the character (the doubled space included).
    expect(merged.split("\n").slice(0, 3)).toEqual(current.split("\n").slice(0, 3));
  });

  it("takes the tier with the same NUMBER, else the one at the same place; nothing designed leaves the gap", () => {
    expect(mergeStationFill("Station\n3+ | \n8+ | Flying", "Station\n8+ | Trample\n3+ | Draw a card.")).toBe("Station\n3+ | Draw a card.\n8+ | Flying");
    expect(mergeStationFill("Station\n3+ | \n8+ | Flying", "Station\n4+ | Draw two cards.\n10+ | Trample")).toBe("Station\n3+ | Draw two cards.\n8+ | Flying");
    expect(mergeStationFill("Station\n3+ | \n8+ | Flying", "No tiers here.")).toBe("Station\n3+ | \n8+ | Flying");
  });

  it("the gaps a merged fill still leaves empty: the fill is refused on any (owner 2026-10-14)", () => {
    // Nothing designed for the gap: the merge is the input, the gap is left.
    expect(stationGapsLeftEmpty("Station\n3+ | \n8+ | Flying", mergeStationFill("Station\n3+ | \n8+ | Flying", "No tiers here."))).toEqual([0]);
    // The model wrote the gap: none left.
    expect(stationGapsLeftEmpty("Station\n3+ | \n8+ | Flying", mergeStationFill("Station\n3+ | \n8+ | Flying", "Station\n3+ | Draw a card."))).toEqual([]);
    // Two gaps, one written: the other is still left (by its own index).
    const two = "Station\n3+ | \n8+ | ";
    // (3+ takes the one designed tier by place; 8+ has none of its own.)
    expect(stationGapsLeftEmpty(two, mergeStationFill(two, "Station\n9+ | Trample"))).toEqual([1]);
    expect(stationGapsLeftEmpty(two, mergeStationFill(two, "Station\n2+ | A.\n9+ | B."))).toEqual([]);
    // A text with no gap (or no tier) is never refused.
    expect(stationGapsLeftEmpty("Station\n3+ | A.\n8+ | Flying", "anything")).toEqual([]);
    expect(stationGapsLeftEmpty(null, "")).toEqual([]);
    expect(stationGapsLeftEmpty("Flying", "Flying")).toEqual([]);
    expect(stationGapUnfilledMessage(1)).toBe("The AI couldn't write that tier — nothing was charged. Try again or write it yourself.");
    expect(stationGapUnfilledMessage(2)).toMatch(/those tiers — nothing was charged/);
  });

  it("the detector's edges (independent check of #561): written is never refused, blank is", () => {
    const gap = "Station\n2+ | A.\n9+ | ";
    // Whitespace is not a text: refused.
    expect(stationGapsLeftEmpty(gap, "Station\n2+ | A.\n9+ |    ")).toEqual([1]);
    expect(stationGapsLeftEmpty(gap, "Station\n2+ | A.\n9+ | \t")).toEqual([1]);
    // Renumbered by the model: written by place, not refused.
    expect(stationGapsLeftEmpty(gap, mergeStationFill(gap, "Station\n2+ | A.\n8+ | Flying"))).toEqual([]);
    // Tiers out of order: the gap is found by its number.
    const unordered = "Station\n9+ | \n2+ | A.";
    expect(stationGapsLeftEmpty(unordered, mergeStationFill(unordered, "Station\n2+ | A.\n9+ | Flying"))).toEqual([]);
    expect(stationGapsLeftEmpty(unordered, mergeStationFill(unordered, "Station\n9+ | \n2+ | A."))).toEqual([0]);
    // CRLF (written, and left with a trailing break).
    const crlf = "Station\r\n2+ | A.\r\n9+ | \r\n";
    expect(stationGapsLeftEmpty(crlf, mergeStationFill(crlf, "Station\n2+ | A.\n9+ | Flying"))).toEqual([]);
    expect(stationGapsLeftEmpty(crlf, mergeStationFill(crlf, "Station\n2+ | A."))).toEqual([1]);
    // A "N+ |" line with a text on the next line is not a gap; a fourth
    // tier line is read as the third tier's text, not a gap either.
    expect(stationGapsLeftEmpty("Station\n2+ | A.\n9+ |\nFlying", "x")).toEqual([]);
    expect(stationGapsLeftEmpty("Station\n2+ | A.\n5+ | B.\n9+ | C.\n12+ |", "x")).toEqual([]);
  });

  it("F1 (#561's check): a gap is never filled by place with a COPY of a tier the text already has", () => {
    // The other tier alone comes back: the gap stays, and is refused.
    const one = "Station\n3+ | \n8+ | Flying";
    expect(mergeStationFill(one, "Station\n8+ | Flying")).toBe(one);
    expect(stationGapsLeftEmpty(one, mergeStationFill(one, "Station\n8+ | Flying"))).toEqual([0]);
    // Two gaps, only 8+ written: 8+ takes it by number, 3+ gets no copy.
    const two = "Station\n3+ | \n8+ | ";
    expect(mergeStationFill(two, "Station\n8+ | B.")).toBe("Station\n3+ | \n8+ | B.");
    expect(stationGapsLeftEmpty(two, mergeStationFill(two, "Station\n8+ | B."))).toEqual([0]);
    // By place from a NEW number is still a fill.
    expect(mergeStationFill(one, "Station\n4+ | Draw.\n8+ | Flying")).toBe("Station\n3+ | Draw.\n8+ | Flying");
  });

  it("a tier 'written' with punctuation alone or the Station reminder alone is a gap left; two tiers with one number are each checked", () => {
    const gap = "Station\n2+ | A.\n9+ | ";
    expect(stationGapsLeftEmpty(gap, "Station\n2+ | A.\n9+ | .")).toEqual([1]);
    expect(stationGapsLeftEmpty(gap, "Station\n2+ | A.\n9+ | — …")).toEqual([1]);
    expect(stationGapsLeftEmpty(gap, `Station\n2+ | A.\n9+ | ${stationReminder("Spacecraft", 9)}`)).toEqual([1]);
    expect(stationGapsLeftEmpty(gap, "Station\n2+ | A.\n9+ | {T}")).toEqual([]);
    expect(stationGapsLeftEmpty(gap, "Station\n2+ | A.\n9+ | 3")).toEqual([]);
    // Same number twice, the second a gap: the second is the one checked.
    const twin = "Station\n5+ | A.\n5+ | ";
    expect(stationGapsLeftEmpty(twin, "Station\n5+ | A.\n5+ | ")).toEqual([1]);
    expect(stationGapsLeftEmpty(twin, mergeStationFill(twin, "Station\n5+ | A.\n5+ | B."))).toEqual([]);
    expect(mergeStationFill(twin, "Station\n5+ | A.\n5+ | B.")).toBe("Station\n5+ | A.\n5+ | B.");
  });

  it("no gap: the designed text is the answer", () => {
    const full = `${top}\n2+ | A.\n9+ | Flying`;
    expect(emptyStationTiers(full)).toEqual([]);
    expect(mergeStationFill(full, "New text")).toBe("New text");
    expect(mergeStationFill("", "New text")).toBe("New text");
  });

  it("the prompt note: the gap by number, or the layout to keep; nothing for a text without tiers", () => {
    expect(stationFillNote(current)).toContain("Write ONLY the text of tier 9+");
    expect(stationFillNote(current)).toContain(current.trim());
    expect(stationFillNote(`${top}\n2+ | A.\n9+ | Flying`)).toContain("laid out in tiers (2+, 9+)");
    expect(stationFillNote("Flying")).toBe("");
    expect(stationFillNote(null)).toBe("");
  });

  it("the P/T choice follows its tier by number, and falls back to the text only when that tier is gone", () => {
    const before = "Station\n2+ | A.\n6+ | B.\n9+ | Flying";
    expect(stationPtChoiceAfterFill(before, 0, "Station\n2+ | New.\n6+ | B.\n9+ | Flying")).toBe(0);
    expect(stationPtChoiceAfterFill(before, 1, "Station\n6+ | B.\n9+ | Flying")).toBe(0);
    expect(stationPtChoiceAfterFill(before, 1, "Station\n3+ | X.\n9+ | Flying")).toBeNull();
    expect(stationPtChoiceAfterFill(before, null, "Station\n2+ | New.")).toBeNull();
    expect(stationPtChoiceAfterFill(before, -1, before)).toBe(-1);
    expect(stationPtChoiceAfterFill("Flying", 2, before)).toBeNull();
  });
});

describe("what an AI job's save writes on a station frame", () => {
  const text = `${stationReminder("Spacecraft", 9)}\n2+ | Scry 1.\n9+ | Flying`;

  it("the canonical text beside its rows, the P/T on the tier the text plates", () => {
    const out = stationSaveFields({ template: "m15station", rulesText: `  ${text}\n`, hasPt: true });
    expect(out).toEqual({
      rules_text: text,
      face_content: { v: 1, station: { intro: stationReminder("Spacecraft", 9), tiers: [{ threshold: 2, text: "Scry 1." }, { threshold: 9, text: "Flying", pt: true }] } },
    });
    expect(faceContentSchema.safeParse(out!.face_content).success).toBe(true);
  });

  it("the maker's tier on a remix of their own card; no plate without a P/T (a Planet)", () => {
    expect(stationSaveFields({ template: "m15station", rulesText: text, hasPt: true, ptTier: 0 })!.face_content.station!.tiers).toEqual([
      { threshold: 2, text: "Scry 1.", pt: true },
      { threshold: 9, text: "Flying" },
    ]);
    // A choice the text has no tier for: as the text says.
    expect(stationSaveFields({ template: "m15station", rulesText: text, hasPt: true, ptTier: 5 })!.face_content.station!.tiers[1]).toMatchObject({ pt: true });
    const planet = stationSaveFields({ template: "m15stationland", rulesText: `${stationReminder("Planet", null)}\n12+ | {T}: Add {G}{G}.`, hasPt: false });
    expect(planet!.face_content.station!.tiers).toEqual([{ threshold: 12, text: "{T}: Add {G}{G}." }]);
  });

  it("NULL — nothing added to the payload — off the frame, without a tier, and for rows the server would not store", () => {
    for (const template of ["m15artifact", "m15vehicle", "m15", "m15land", undefined, null]) {
      expect(stationSaveFields({ template, rulesText: text, hasPt: true }), String(template)).toBeNull();
    }
    expect(stationSaveFields({ template: "m15station", rulesText: "Flying", hasPt: true })).toBeNull();
    expect(stationSaveFields({ template: "m15station", rulesText: "", hasPt: true })).toBeNull();
    expect(stationSaveFields({ template: "m15station", rulesText: "Station\n8+ | A.\n3+ | B.", hasPt: true })).toBeNull();
    expect(stationSaveFields({ template: "m15station", rulesText: `Station\n8+ | ${"x".repeat(601)}`, hasPt: true })).toBeNull();
    expect(stationSaveFields({ template: "m15station", rulesText: "Station\n8+ |", hasPt: true })).toBeNull();
  });

  it("every printed card saves as rows with the plate where print has it", () => {
    for (const card of printed) {
      const template = isPlanet(card) ? "m15stationland" : "m15station";
      const out = stationSaveFields({ template, rulesText: card.oracle_text, hasPt: card.power !== null });
      expect(out, card.name).not.toBeNull();
      expect(out!.rules_text, card.name).toBe(card.oracle_text);
      const tiers = out!.face_content.station!.tiers;
      expect(tiers.findIndex((tier) => tier.pt), card.name).toBe(card.power !== null ? tiers.length - 1 : -1);
    }
  });

  it("sameStationShape: as many tiers with the same numbers", () => {
    expect(sameStationShape(text, text.replace("Scry 1.", "Scry 2."))).toBe(true);
    expect(sameStationShape(text, text.replace("9+ | Flying", "Flying"))).toBe(false);
    expect(sameStationShape(text, text.replace("2+ |", "3+ |"))).toBe(false);
    expect(sameStationShape("Flying", "Trample")).toBe(true);
  });
});
