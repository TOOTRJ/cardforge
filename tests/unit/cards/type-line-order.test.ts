import { describe, expect, it } from "vitest";
import {
  buildTypeLine,
  printsPowerToughness,
  showsPowerToughness,
  typeLineWords,
} from "@/lib/cards/card-display";
import { fitTypeLineBand, measuredLinePx, slotLineEm } from "@/lib/cards/render-tiers";
import { setSymbolSize, setSymbolSource } from "@/lib/cards/set-symbol-size";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { mapScryfallToFormPatch, parseTypeLine } from "@/lib/scryfall/import-mapper";
import { parseSubtypes } from "@/lib/creator/card-fields";
import { statVisibility } from "@/lib/creator/steps";
import { autofixCard, lintCardDesign, type LintableCard } from "@/lib/ai/mtg-rules";
import { FRAME_TEMPLATE_VALUES, type CardType } from "@/types/card";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import prints from "./fixtures/type-line-prints.json";
import importPrintings from "../scryfall/fixtures/import-printings.json";

// ---------------------------------------------------------------------------
// TODO 1.20 — the type line in its printed order.
//
// THE DATA MODEL: a face is `card_type` (one of eleven values) + `supertype`
// (free text: every OTHER word left of the dash, in the order it was typed or
// imported) + `subtypes`. The importer picks the card type by frame
// precedence (token > land > creature > … TODO 1.3) and keeps the remaining
// type words in `supertype`, so the card type's place among them is not
// stored: buildTypeLine puts it back (typeLineWords).
//
// THE ORDER (held to Scryfall below): Basic, Legendary, Ongoing, Snow, World,
// Host / Elite, Kindred / Tribal, Enchantment, Artifact, Land, Planeswalker,
// Creature. Instant, Sorcery and Battle are not ranked — as a card type they
// print last; a word the order does not know stays where it was typed and
// nothing moves across it.
// ---------------------------------------------------------------------------

/** [card_type, supertype, the words left of the dash, a printing that reads
 *  so (or null: no printing combines them — the line follows the order)]. */
type Row = readonly [CardType, string, string, string | null];

/** Every card type × every type word it can carry in `supertype`. */
const TYPE_WORD_TABLE: readonly Row[] = [
  // creature — every type word prints before it.
  ["creature", "", "Creature", "Llanowar Elves"],
  ["creature", "Artifact", "Artifact Creature", "Golden Guardian RIX #179"],
  ["creature", "Enchantment", "Enchantment Creature", "Summon: Alexander FIN #13"],
  ["creature", "Enchantment Artifact", "Enchantment Artifact Creature", "Golem TEOC #13 (a token)"],
  ["creature", "Land", "Land Creature", "Dryad Arbor (as a creature)"],
  ["creature", "Kindred", "Kindred Creature", null],
  ["creature", "Planeswalker", "Planeswalker Creature", null],
  ["creature", "Creature", "Creature Creature", null], // the word twice, as typed
  // artifact
  ["artifact", "", "Artifact", "Sol Ring"],
  ["artifact", "Creature", "Artifact Creature", "Golden Guardian RIX #179"],
  ["artifact", "Enchantment", "Enchantment Artifact", "Spear of Heliod THS #33"],
  ["artifact", "Land", "Artifact Land", "Darksteel Citadel C21 #285"],
  ["artifact", "Kindred", "Kindred Artifact", "Cloak and Dagger MOR #141"],
  ["artifact", "Tribal", "Tribal Artifact", "Cloak and Dagger MOR #141 (as printed in 2008)"],
  ["artifact", "Planeswalker", "Artifact Planeswalker", null],
  // enchantment
  ["enchantment", "", "Enchantment", "Grasping Shadows LCI #108"],
  ["enchantment", "Creature", "Enchantment Creature", "Summon: Bahamut FIN #1 (the saga kind)"],
  ["enchantment", "Artifact", "Enchantment Artifact", "Bident of Thassa THS #42"],
  ["enchantment", "Land", "Enchantment Land", "Urza's Saga MH2 #259 (the saga kind)"],
  ["enchantment", "Artifact Creature", "Enchantment Artifact Creature", "Golem TEOC #13 (a token)"],
  ["enchantment", "Kindred", "Kindred Enchantment", "Favor of the Mighty LRW #14"],
  ["enchantment", "World", "World Enchantment", "Field of Dreams LEG #55"],
  ["enchantment", "Planeswalker", "Enchantment Planeswalker", null],
  // land
  ["land", "", "Land", "Gold-Forge Garrison RIX #179"],
  ["land", "Creature", "Land Creature", "Dryad Arbor DSC #273"],
  ["land", "Artifact", "Artifact Land", "Darksteel Citadel C21 #285"],
  ["land", "Enchantment", "Enchantment Land", "Urza's Saga MH2 #259"],
  ["land", "Basic", "Basic Land", "Forest"],
  ["land", "Basic Snow", "Basic Snow Land", "Snow-Covered Plains KHM #276"],
  ["land", "Legendary Artifact", "Legendary Artifact Land", null],
  ["land", "Kindred", "Kindred Land", null],
  ["land", "Planeswalker", "Land Planeswalker", null],
  // planeswalker
  ["planeswalker", "Legendary", "Legendary Planeswalker", "Gideon, Battle-Forged ORI #23"],
  ["planeswalker", "Creature", "Planeswalker Creature", null],
  ["planeswalker", "Artifact", "Artifact Planeswalker", null],
  ["planeswalker", "Enchantment", "Enchantment Planeswalker", null],
  ["planeswalker", "Land", "Land Planeswalker", null],
  // instant / sorcery / battle / the legacy "spell": the card type prints last.
  ["instant", "", "Instant", "Lightning Bolt"],
  ["instant", "Kindred", "Kindred Instant", "Shields of Velis Vel LRW #39"],
  ["instant", "Tribal", "Tribal Instant", "Shields of Velis Vel LRW #39 (as printed in 2007)"],
  ["instant", "Creature", "Creature Instant", null],
  ["sorcery", "Kindred", "Kindred Sorcery", "Summon the School LRW #42"],
  ["sorcery", "Legendary", "Legendary Sorcery", "Urza's Ruinous Blast DOM #39"],
  ["battle", "", "Battle", "Invasion of Ravnica MOM #1"],
  ["battle", "Artifact", "Artifact Battle", null],
  ["spell", "Legendary", "Legendary Spell", null],
  // token — "Token" first (TODO 3b.15), then its words in the same order.
  ["token", "", "Token", "Copy TFDN #26"],
  ["token", "Creature", "Token Creature", "Temmet, Vizier of Naktamun TAKH #12"],
  ["token", "Artifact", "Token Artifact", "Treasure F17 #10"],
  ["token", "Enchantment", "Token Enchantment", "Mask TC18 #4"],
  ["token", "Artifact Creature", "Token Artifact Creature", "Tuktuk the Returned T2XM #28"],
  ["token", "Creature Artifact", "Token Artifact Creature", "Tuktuk the Returned T2XM #28"],
  ["token", "Enchantment Creature", "Token Enchantment Creature", "Soldier TBNG #3"],
  ["token", "Enchantment Artifact Creature", "Token Enchantment Artifact Creature", "Golem TEOC #13"],
  ["token", "Land", "Token Land", "Everywhere TDSK #16"],
  ["token", "Land Creature", "Token Land Creature", "Forest Dryad TM3C #19"],
  ["token", "Legendary Creature", "Token Legendary Creature", "Ashaya, the Awoken World TORI #7"],
  ["token", "Legendary Artifact Creature", "Token Legendary Artifact Creature", "Mechtitan TNEO #14"],
  ["token", "Snow Artifact", "Token Snow Artifact", "Icy Manalith TKHM #17"],
  ["token", "Basic", "Token Basic", null],
  // emblem — "Emblem" alone (CR 114: no supertypes), whatever the row says.
  ["emblem", "", "Emblem", "Kaito emblem"],
  ["emblem", "Legendary Creature", "Emblem", null],
];

/** Supertypes and longer lines, on the card types that print them. */
const SUPERTYPE_TABLE: readonly Row[] = [
  ["creature", "Legendary", "Legendary Creature", "Ojer Taq, Deepest Foundation LCI #26"],
  ["creature", "Legendary Enchantment", "Legendary Enchantment Creature", "Heliod, God of the Sun THS #17"],
  ["creature", "Legendary Artifact", "Legendary Artifact Creature", "Reaper King SHM #260"],
  ["creature", "Legendary Snow", "Legendary Snow Creature", "Myntasha, Honored One PH19 #5"],
  ["creature", "Snow Artifact", "Snow Artifact Creature", "Phyrexian Ironfoot CSP #139"],
  ["creature", "Host", "Host Creature", "Shaggy Camel UST #22"],
  ["creature", "Host Artifact", "Host Artifact Creature", "Angelic Rocket UST #139"],
  ["creature", "Elite", "Elite Creature", "Ravenous Brute Head TFTH #2"],
  ["artifact", "Legendary", "Legendary Artifact", "Azor's Gateway RIX #176"],
  ["artifact", "Legendary Snow", "Legendary Snow Artifact", "Kaldring, the Rimestaff KHM #179"],
  ["artifact", "Snow", "Snow Artifact", "Arcum's Astrolabe MH1 #220"],
  ["artifact", "Legendary Kindred", "Legendary Kindred Artifact", "The Wizardly Barge (playtest)"],
  ["enchantment", "Legendary", "Legendary Enchantment", "Legion's Landing XLN #22"],
  ["enchantment", "Legendary Artifact", "Legendary Enchantment Artifact", "Bident of Thassa THS #42"],
  ["enchantment", "Legendary Snow", "Legendary Snow Enchantment", "Marit Lage's Slumber MH1 #56"],
  ["land", "Legendary", "Legendary Land", "Adanto, the First Fort XLN #22"],
  ["land", "Legendary Snow", "Legendary Snow Land", "Dark Depths DMR #244"],
  // Typed out of order: the known words are put in order…
  ["creature", "Artifact Legendary", "Legendary Artifact Creature", "Reaper King SHM #260"],
  ["creature", "Snow Legendary", "Legendary Snow Creature", "Myntasha, Honored One PH19 #5"],
  ["land", "Creature Legendary", "Legendary Land Creature", null],
  ["land", "Snow Basic", "Basic Snow Land", "Snow-Covered Plains KHM #276"],
  // …in any case, each word as it was typed…
  ["creature", "legendary", "legendary Creature", null],
  ["land", "creature", "Land creature", null],
  // …and a word the order does not know stays put, with nothing moved
  // across it: the card type is added after it, as before.
  ["creature", "Legendary Comedic", "Legendary Comedic Creature", null],
  ["artifact", "Land -", "Land - Artifact", null],
  ["creature", "Instant", "Instant Creature", "Visitor from Planet Q CMB2 #33 (playtest)"],
  ["enchantment", "Comedic Land", "Comedic Enchantment Land", null],
  ["land", "Creature Ancient", "Creature Ancient Land", null],
  ["token", "Artifact Shiny Creature Artifact", "Token Artifact Shiny Artifact Creature", null],
];

describe("the type line in its printed order (TODO 1.20)", () => {
  it.each([...TYPE_WORD_TABLE, ...SUPERTYPE_TABLE])("%s + %j prints %j", (cardType, supertype, left) => {
    expect(typeLineWords({ cardType, supertype }).join(" ")).toBe(left);
    expect(buildTypeLine({ cardType, supertype })).toBe(left);
    const withSubtypes = buildTypeLine({ cardType, supertype, subtypes: ["Forest", "Dryad"] });
    expect(withSubtypes).toBe(`${left} — Forest Dryad`);
  });

  it("covers every card type", () => {
    const seen = new Set([...TYPE_WORD_TABLE, ...SUPERTYPE_TABLE].map(([cardType]) => cardType));
    expect([...seen].sort()).toEqual(
      ["artifact", "battle", "creature", "emblem", "enchantment", "instant", "land", "planeswalker", "sorcery", "spell", "token"].sort(),
    );
  });

  it("keeps a line with no card type, an empty one and the subtypes as before", () => {
    expect(buildTypeLine({})).toBe("Type");
    expect(buildTypeLine({ supertype: "Legendary" })).toBe("Legendary");
    expect(buildTypeLine({ subtypes: ["Aura"] })).toBe("Aura");
    expect(buildTypeLine({ cardType: "creature", supertype: "  Legendary   Artifact ", subtypes: ["Golem", ""] })).toBe(
      "Legendary Artifact Creature — Golem",
    );
    // An emblem's optional subtype (TODO 6.23).
    expect(buildTypeLine({ cardType: "emblem", subtypes: ["Kaito"] })).toBe("Emblem — Kaito");
  });
});

// ---------------------------------------------------------------------------
// Scryfall — one printing per distinct line left of the dash, captured
// 2026-10-08 (fixtures/type-line-prints.json; 25 searches over the two-type
// and supertype combinations, tokens included). The same day, a search for
// each pair of ranked words in the REVERSE of the order above
// (`t:/Creature ([A-Za-z]+ )*Land/` …) found two printings in all: UNF #189
// "Artifact Enchantment — Saga" and the playtest card "Legendary Instant
// Artifact Enchantment". Both are listed below as lines the data model cannot
// hold apart from Bident of Thassa's "Enchantment Artifact".
// ---------------------------------------------------------------------------

/** Printed lines an import cannot print back, and what it prints instead. */
const NOT_REPRESENTABLE: Readonly<Record<string, string>> = {
  // "Scheme" is not a card type PipGlyph has; the importer drops the word.
  "Ongoing Scheme": "Ongoing",
  // An enchantment with "Artifact" in supertype is Bident of Thassa's
  // "Enchantment Artifact" (five THS / BNG / JOU weapons) — the same row as
  // these two acorn / playtest cards, which print the words the other way.
  "Artifact Enchantment — Saga": "Enchantment Artifact — Saga",
  "Legendary Instant Artifact Enchantment": "Legendary Instant Enchantment Artifact",
};

describe("an import prints the printing's own line (Scryfall type_line)", () => {
  it("has a useful sample", () => {
    expect(prints.lines.length).toBeGreaterThanOrEqual(40);
  });

  it.each(prints.lines.map((line) => [line.type_line, `${line.name} ${line.set.toUpperCase()} #${line.number}`] as const))(
    "%s (%s)",
    (typeLine) => {
      const parsed = parseTypeLine(typeLine);
      const line = buildTypeLine({
        supertype: parsed.supertype,
        cardType: parsed.card_type,
        subtypes: parseSubtypes(parsed.subtypes_text ?? ""),
      });
      expect(line).toBe(NOT_REPRESENTABLE[typeLine] ?? typeLine);
    },
  );

  it("lists only real exceptions", () => {
    const sampled = new Set(prints.lines.map((line) => line.type_line));
    for (const typeLine of Object.keys(NOT_REPRESENTABLE)) expect(sampled.has(typeLine), typeLine).toBe(true);
  });

  it("prints a P/T on every sampled line that says Creature and has one — and on no other but a Vehicle", () => {
    for (const print of prints.lines) {
      const parsed = parseTypeLine(print.type_line);
      const subtypes = parseSubtypes(parsed.subtypes_text ?? "");
      const prints_ = printsPowerToughness({
        cardType: parsed.card_type,
        supertype: parsed.supertype,
        subtypes,
        power: print.power,
        toughness: print.toughness,
      });
      const saysCreature = / Creature\b|^Creature\b/.test(print.left);
      const vehicle = subtypes.includes("Vehicle");
      expect(prints_, print.type_line).toBe(Boolean(print.power) && (saysCreature || vehicle));
    }
  });

  // The five printings TODO 1.20 names, through the whole mapper (the saga
  // kind keeps "enchantment" as the card type of Urza's Saga and the Summon).
  const printing = (key: keyof typeof importPrintings): ScryfallCard => scryfallCardSchema.parse(importPrintings[key]);
  it.each([
    ["dsc-273", "Land Creature — Forest Dryad"],
    ["mh2-259", "Enchantment Land — Urza's Saga"],
    ["fin-1", "Enchantment Creature — Saga Dragon"],
    ["ths-42", "Legendary Enchantment Artifact"],
    ["tmsh-27", "Token Artifact — Treasure"],
  ] as const)("%s imports as %j", (key, printed) => {
    const card = printing(key);
    expect(card.type_line).toBe(printed);
    const patch = mapScryfallToFormPatch(card);
    expect(
      buildTypeLine({
        supertype: patch.supertype,
        cardType: patch.card_type,
        subtypes: parseSubtypes(patch.subtypes_text ?? ""),
      }),
    ).toBe(printed);
  });
});

describe("P/T on a land that is also a creature (TODO 1.20)", () => {
  it("shows the P/T of any face whose type words say Creature — never an emblem's", () => {
    expect(showsPowerToughness("land", ["Forest", "Dryad"], "Creature")).toBe(true);
    expect(showsPowerToughness("land", [], "Legendary creature")).toBe(true);
    expect(showsPowerToughness("enchantment", ["Saga", "Dragon"], "Creature")).toBe(true);
    expect(showsPowerToughness("artifact", [], "Creature")).toBe(true);
    expect(showsPowerToughness("token", ["Goblin"], "Creature")).toBe(true);
    expect(showsPowerToughness("emblem", [], "Creature")).toBe(false);
    // …and of no other.
    expect(showsPowerToughness("land", ["Forest"], "Basic")).toBe(false);
    expect(showsPowerToughness("land", ["Forest"], null)).toBe(false);
    expect(showsPowerToughness("artifact", ["Equipment"], "Legendary")).toBe(false);
    expect(showsPowerToughness("enchantment", ["Aura"], "Creatures")).toBe(false);
    expect(showsPowerToughness("token", ["Treasure"], "Artifact")).toBe(false);
  });

  it("prints Dryad Arbor's 1/1 and nothing on a plain land", () => {
    const arbor = { cardType: "land" as const, supertype: "Creature", subtypes: ["Forest", "Dryad"] };
    expect(printsPowerToughness({ ...arbor, power: "1", toughness: "1" })).toBe(true);
    expect(printsPowerToughness({ ...arbor, power: null, toughness: null })).toBe(false);
    expect(printsPowerToughness({ cardType: "land", supertype: "Basic", subtypes: ["Forest"], power: "1", toughness: "1" })).toBe(false);
  });

  it("imports Dryad Arbor with its P/T, and the form shows the inputs", () => {
    const patch = mapScryfallToFormPatch(scryfallCardSchema.parse(importPrintings["dsc-273"]));
    expect(patch.card_type).toBe("land");
    expect(patch.supertype).toBe("Creature");
    expect([patch.power, patch.toughness]).toEqual(["1", "1"]);
    expect(statVisibility(patch.card_type, parseSubtypes(patch.subtypes_text ?? ""), patch.supertype).pt).toBe(true);
    expect(statVisibility("land", ["Forest"], "Basic").pt).toBe(false);
  });

  it("the AI's rules follow: a land creature needs a P/T, a plain land may not have one", () => {
    const base: LintableCard = {
      title: "Grove Walker",
      cost: "—",
      card_type: "land",
      supertype: null,
      subtypes: ["Forest", "Dryad"],
      color_identity: ["green"],
      rules_text: "{T}: Add {G}.",
      power: null,
      toughness: null,
      loyalty: null,
      defense: null,
    };
    const fields = (issues: ReturnType<typeof lintCardDesign>) => issues.errors.map((error) => error.field);
    expect(fields(lintCardDesign({ ...base, supertype: "Creature", power: null, toughness: null }))).toContain("power");
    expect(fields(lintCardDesign({ ...base, supertype: "Creature", power: "1", toughness: "1" }))).not.toContain("power");
    expect(fields(lintCardDesign({ ...base, supertype: null, power: "1", toughness: "1" }))).toContain("power");
    const fixed = autofixCard({ ...base, supertype: "Creature", power: "1", toughness: "1" });
    expect([fixed.power, fixed.toughness]).toEqual(["1", "1"]);
    const plain = autofixCard({ ...base, supertype: null, power: "1", toughness: "1" });
    expect([plain.power, plain.toughness]).toEqual([null, null]);
  });
});

// ---------------------------------------------------------------------------
// The fit. Every line of the tables above (the words left of the dash) and
// every sampled PRINTED line with its own subtypes, on every template:
//   • a measured band (the M15-era family, the era frames, the landscape
//     pair) sets the WHOLE line — never the "…" — and at the whole px both
//     bakes draw it at (750 and HD; 1050 and 2100 on a landscape frame) its
//     measured width (slotLineEm, an upper bound for both renderers) ends
//     inside the room before the set symbol;
//   • a band on the old estimate never cuts a line, and keeps a real size;
//   • the printed order costs no line its size: the same words in the order
//     v49 printed them (supertype, then the card type) fit at the same size
//     to within the kerning between two words.
// The one band too narrow for the longest lines is a split card's half (a
// real split card is an instant or a sorcery): TOO_LONG_FOR_A_SPLIT_HALF
// lists what it cuts, and no other template may cut anything.
// ---------------------------------------------------------------------------

/** The lines a split card's 42 %-wide half cuts with a "…" at the 5 pt
 *  floor — none of them a line a split card prints. */
const TOO_LONG_FOR_A_SPLIT_HALF: readonly string[] = [
  "Enchantment Creature — Saga Construct",
  "Legendary Artifact Creature — Scarecrow",
  "Legendary Artifact Land — Vehicle Island",
  "Legendary Enchantment Creature — God",
  "Legendary Instant Enchantment Artifact",
  "Legendary Kindred Artifact — Wizard Vehicle",
  "Snow Artifact Creature — Phyrexian Construct",
  "Token Artifact Creature — Goblin Golem",
  "Token Creature — Zombie Human Cleric",
  "Token Enchantment Artifact Creature — Golem",
  "Token Enchantment Creature — Soldier",
  "Token Legendary Artifact — Equipment",
  "Token Legendary Artifact Creature — Construct",
  "Token Legendary Creature — Elemental",
];

describe("every line fits its type band on every template, at both bakes", () => {
  const tableLines = [...TYPE_WORD_TABLE, ...SUPERTYPE_TABLE].map(([cardType, supertype]) => ({
    text: buildTypeLine({ cardType, supertype }),
    // v49's order: the supertype as typed, then the card type ("Token" first).
    old: (cardType === "token"
      ? ["Token", supertype]
      : cardType === "emblem"
        ? ["Emblem"]
        : [supertype, cardType.charAt(0).toUpperCase() + cardType.slice(1)]
    )
      .filter(Boolean)
      .join(" "),
  }));
  const printedLines = prints.lines.map((line) => {
    const text = NOT_REPRESENTABLE[line.type_line] ?? line.type_line;
    return { text, old: text };
  });
  const lines = [...new Map([...tableLines, ...printedLines].map((line) => [line.text, line])).values()];

  it("samples long lines", () => {
    expect(lines.length).toBeGreaterThan(100);
    expect(Math.max(...lines.map((line) => line.text.length))).toBeGreaterThanOrEqual(44);
  });

  it.each(FRAME_TEMPLATE_VALUES.map((template) => [template] as const))("%s", (template) => {
    const layout = getFrameProfile(template);
    const orientation = layout.orientation === "landscape" ? "landscape" : "portrait";
    const symbol = setSymbolSize(layout, setSymbolSource(null, null));
    const fitOf = (text: string) =>
      fitTypeLineBand({
        layout,
        text,
        symbolWidthPct: symbol.drawnWidthPct,
        symbolInkLeftPct: symbol.inkLeftPct,
        orientation,
      });
    const cut: string[] = [];
    for (const { text, old } of lines) {
      const fit = fitOf(text);
      expect(fit.sizePct, `${template}: ${text}`).toBeGreaterThan(0);
      // The order costs nothing: one inter-word kern either way (≤ 1 %).
      expect(fit.sizePct / fitOf(old).sizePct, `${template}: ${text} vs ${old}`).toBeGreaterThan(0.99);
      expect(fit.sizePct / fitOf(old).sizePct, `${template}: ${text} vs ${old}`).toBeLessThan(1.01);
      if (fit.text !== text) {
        cut.push(text);
        continue;
      }
      if (layout.type.fit !== "measured") continue;
      for (const width of orientation === "landscape" ? [1050, 2100] : [750, 1500]) {
        const px = measuredLinePx(fit.sizePct, layout.type.sizePct, width, orientation);
        expect(slotLineEm(text, layout.type) * px, `${template} at ${width}: ${text}`).toBeLessThanOrEqual(
          fit.widthPct! * width,
        );
      }
    }
    expect(cut, template).toEqual(template === "split" ? TOO_LONG_FOR_A_SPLIT_HALF : []);
  });
});
