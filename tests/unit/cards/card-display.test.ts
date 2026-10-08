import { describe, expect, it } from "vitest";
import {
  buildTypeLine,
  displayLine,
  hasTokenTypeWord,
  parseChapters,
  printsPowerToughness,
  showsPowerToughness,
  FOOTER_PREFIX,
  footerArtistLine,
  slotLine,
  withSupertypeWord,
  withoutSupertypeWord,
} from "@/lib/cards/card-display";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { parseTypeLine } from "@/lib/scryfall/import-mapper";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { parseSubtypes } from "@/lib/creator/card-fields";

describe("parseChapters", () => {
  it("parses one chapter per Roman-numeral line", () => {
    expect(
      parseChapters("I — Draw a card.\nII — Scry 2.\nIII — Gain 3 life."),
    ).toEqual([
      { marker: "I", text: "Draw a card." },
      { marker: "II", text: "Scry 2." },
      { marker: "III", text: "Gain 3 life." },
    ]);
  });

  it("keeps grouped markers and normalizes their spacing", () => {
    expect(parseChapters("I, II — Draw a card.\nIII — Discard.")).toEqual([
      { marker: "I,II", text: "Draw a card." },
      { marker: "III", text: "Discard." },
    ]);
  });

  it("accepts colon and hyphen separators, lowercase numerals", () => {
    expect(parseChapters("i: Add {G}.\nii - Untap a land.")).toEqual([
      { marker: "I", text: "Add {G}." },
      { marker: "II", text: "Untap a land." },
    ]);
  });

  it("appends marker-less lines to the previous chapter", () => {
    expect(
      parseChapters("I — Create a token\nwith vigilance.\nII — Draw."),
    ).toEqual([
      { marker: "I", text: "Create a token with vigilance." },
      { marker: "II", text: "Draw." },
    ]);
  });

  it("does not treat a sentence starting with 'I' as a chapter", () => {
    expect(parseChapters("Improvise. Whenever you cast a spell, scry 1.")).toEqual(
      [],
    );
  });

  it("returns [] for empty or missing text", () => {
    expect(parseChapters("")).toEqual([]);
    expect(parseChapters(null)).toEqual([]);
    expect(parseChapters(undefined)).toEqual([]);
  });
});

describe("showsPowerToughness", () => {
  it("a creature shows P/T regardless of subtypes", () => {
    expect(showsPowerToughness("creature")).toBe(true);
    expect(showsPowerToughness("creature", [], null)).toBe(true);
  });

  it("a token shows P/T only when its supertype says Creature (TODO 3b.15)", () => {
    expect(showsPowerToughness("token", [], "Creature")).toBe(true);
    expect(showsPowerToughness("token", ["Construct"], "Legendary Artifact Creature")).toBe(true);
    expect(showsPowerToughness("token", ["Glimmer"], "enchantment creature")).toBe(true);
    // A Treasure, a Shard, a Copy — and a word-less token — have none.
    expect(showsPowerToughness("token", ["Treasure"], "Artifact")).toBe(false);
    expect(showsPowerToughness("token", ["Shard"], "Enchantment")).toBe(false);
    expect(showsPowerToughness("token", [], null)).toBe(false);
    expect(showsPowerToughness("token", [])).toBe(false);
    // A whole word: "Creatures" is not the type.
    expect(showsPowerToughness("token", [], "Creatures")).toBe(false);
    // A token Vehicle prints its crewed stats like any Vehicle.
    expect(showsPowerToughness("token", ["Vehicle"], "Artifact")).toBe(true);
  });

  it("Vehicle/Spacecraft subtypes show P/T on non-creatures", () => {
    // Vehicles print crewed stats, Spacecraft stationed stats; both render
    // a P/T box on the real card even though they're artifacts.
    expect(showsPowerToughness("artifact", ["Vehicle"])).toBe(true);
    expect(showsPowerToughness("artifact", ["Spacecraft"])).toBe(true);
    // Case/whitespace tolerant for hand-typed subtypes.
    expect(showsPowerToughness("artifact", [" vehicle "])).toBe(true);
  });

  it("other artifacts still hide P/T", () => {
    expect(showsPowerToughness("artifact")).toBe(false);
    expect(showsPowerToughness("artifact", ["Equipment"])).toBe(false);
    expect(showsPowerToughness("enchantment", [])).toBe(false);
  });
});

describe("printsPowerToughness", () => {
  it("prints a P/T the type shows, when it has one", () => {
    expect(printsPowerToughness({ cardType: "creature", power: "2", toughness: "2" })).toBe(true);
    expect(printsPowerToughness({ cardType: "creature", power: "", toughness: "" })).toBe(false);
    expect(printsPowerToughness({ cardType: "token", supertype: "Creature", power: "1", toughness: "1" })).toBe(true);
    expect(printsPowerToughness({ cardType: "instant", power: "1", toughness: "1" })).toBe(false);
  });

  it("never prints one on a token that names another type (a Treasure with a stray 2/2)", () => {
    expect(printsPowerToughness({ cardType: "token", supertype: "Artifact", power: "2", toughness: "2" })).toBe(false);
    expect(printsPowerToughness({ cardType: "token", supertype: "Enchantment", power: "1", toughness: "1" })).toBe(false);
  });

  it("keeps printing a stored token's P/T when it has no type word (before the picker every token was a creature)", () => {
    expect(printsPowerToughness({ cardType: "token", supertype: null, power: "1", toughness: "1" })).toBe(true);
    expect(printsPowerToughness({ cardType: "token", supertype: "Legendary", power: "5", toughness: "5" })).toBe(true);
    expect(printsPowerToughness({ cardType: "token", subtypes: ["Boar"], power: "0", toughness: "3" })).toBe(true);
    // A Copy (no word, no P/T) prints none.
    expect(printsPowerToughness({ cardType: "token", supertype: null, power: null, toughness: null })).toBe(false);
  });
});

describe("withSupertypeWord / withoutSupertypeWord", () => {
  it("adds a word in printed order and keeps every other word", () => {
    expect(withSupertypeWord("", "Creature")).toBe("Creature");
    expect(withSupertypeWord(null, "Artifact")).toBe("Artifact");
    expect(withSupertypeWord("Creature", "Artifact")).toBe("Artifact Creature");
    expect(withSupertypeWord("Artifact Creature", "Enchantment")).toBe("Enchantment Artifact Creature");
    expect(withSupertypeWord("Artifact Creature", "Legendary")).toBe("Legendary Artifact Creature");
    expect(withSupertypeWord("Legendary", "Artifact")).toBe("Legendary Artifact");
    expect(withSupertypeWord("Legendary Creature", "Snow")).toBe("Legendary Snow Creature");
    expect(withSupertypeWord("Land", "Creature")).toBe("Land Creature");
    expect(withSupertypeWord("Land", "Artifact")).toBe("Artifact Land");
    expect(withSupertypeWord("Basic", "Creature")).toBe("Basic Creature");
    // A word the order doesn't know goes last; one already there stays.
    expect(withSupertypeWord("Creature", "Emblem")).toBe("Creature Emblem");
    expect(withSupertypeWord("Legendary  artifact", "Artifact")).toBe("Legendary artifact");
  });

  it("removes only its own word", () => {
    expect(withoutSupertypeWord("Legendary Artifact Creature", "Artifact")).toBe("Legendary Creature");
    expect(withoutSupertypeWord("Enchantment Artifact Creature", "creature")).toBe("Enchantment Artifact");
    expect(withoutSupertypeWord("Creature", "Creature")).toBe("");
    expect(withoutSupertypeWord("Land Creature", "Artifact")).toBe("Land Creature");
    expect(withoutSupertypeWord(null, "Creature")).toBe("");
  });

  it("hasTokenTypeWord reads Creature, Artifact and Enchantment only", () => {
    expect(hasTokenTypeWord("Legendary Creature")).toBe(true);
    expect(hasTokenTypeWord("artifact")).toBe(true);
    expect(hasTokenTypeWord("Enchantment")).toBe(true);
    expect(hasTokenTypeWord("Legendary")).toBe(false);
    expect(hasTokenTypeWord("Basic")).toBe(false);
    expect(hasTokenTypeWord("")).toBe(false);
    expect(hasTokenTypeWord(null)).toBe(false);
  });
});

describe("buildTypeLine — tokens print \"Token\" first (TODO 3b.15)", () => {
  it("prints Token, then the words, then the subtypes", () => {
    expect(buildTypeLine({ cardType: "token", supertype: "Creature", subtypes: ["Soldier"] })).toBe("Token Creature — Soldier");
    expect(buildTypeLine({ cardType: "token", supertype: "Artifact", subtypes: ["Treasure"] })).toBe("Token Artifact — Treasure");
    expect(buildTypeLine({ cardType: "token", supertype: "Enchantment Creature", subtypes: ["Glimmer"] })).toBe(
      "Token Enchantment Creature — Glimmer",
    );
    expect(buildTypeLine({ cardType: "token", supertype: "Legendary Creature", subtypes: ["Wolf"] })).toBe(
      "Token Legendary Creature — Wolf",
    );
    // The stored basics typed on the token frame (22 public, 2026-09-29).
    expect(buildTypeLine({ cardType: "token", supertype: "Basic", subtypes: ["Wastes"] })).toBe("Token Basic — Wastes");
    // A Copy: no word, no subtype — a bare "Token".
    expect(buildTypeLine({ cardType: "token", supertype: null, subtypes: [] })).toBe("Token");
    expect(buildTypeLine({ cardType: "token", supertype: "  ", subtypes: [] })).toBe("Token");
    // A stored token from before the picker, not yet given its word.
    expect(buildTypeLine({ cardType: "token", supertype: null, subtypes: ["Boar"] })).toBe("Token — Boar");
  });

  it("leaves every other card type's line as it was", () => {
    expect(buildTypeLine({ cardType: "creature", supertype: "Legendary", subtypes: ["Elf"] })).toBe("Legendary Creature — Elf");
    expect(buildTypeLine({ cardType: "creature", supertype: "Artifact", subtypes: ["Golem"] })).toBe("Artifact Creature — Golem");
    expect(buildTypeLine({ cardType: "land", supertype: "Basic", subtypes: [] })).toBe("Basic Land");
    expect(buildTypeLine({ cardType: "instant" })).toBe("Instant");
    expect(buildTypeLine({})).toBe("Type");
  });

  // 1.23's token fixtures (Scryfall 2026-09-28/29, the front face's
  // type_line): imported the way the creator imports them (parseTypeLine →
  // card_type token, the other words in supertype), each prints its own
  // line back. TFDN #26, the Copy, prints a bare "Token".
  const FIXTURES: Array<[string, string]> = [
    ["TDOM #3 Soldier", "Token Creature — Soldier"],
    ["TDOM #2 Knight", "Token Creature — Knight"],
    ["TXLN #7 Treasure", "Token Artifact — Treasure"],
    ["TM20 #2 Soldier", "Token Creature — Soldier"],
    ["T2XM #4 Cat", "Token Creature — Cat"],
    ["TFDN #27 Cat", "Token Creature — Cat"],
    ["TLCI #17 Map", "Token Artifact — Map"],
    ["TBLB #5 Warren Warleader", "Token Creature — Rabbit Knight"],
    ["TFDN #23 Treasure", "Token Artifact — Treasure"],
    ["TDSK #7 Toy", "Token Artifact Creature — Toy"],
    ["TDSK #4 Glimmer", "Token Enchantment Creature — Glimmer"],
    ["TKHM #1 Shard", "Token Enchantment — Shard"],
    ["TFDN #26 Copy", "Token"],
    ["TMKM #13 Voja Fenstalker", "Token Legendary Creature — Wolf"],
    ["TMKM #10 Detective", "Token Creature — Detective"],
    ["TMOM #16 Incubator (front)", "Token Artifact — Incubator"],
    ["TWOE #15 Monster (front Role)", "Token Enchantment — Aura Role"],
    ["TFRA #5 Jace", "Token Planeswalker — Jace"],
    ["TLRW #3 Kithkin Soldier", "Token Creature — Kithkin Soldier"],
    ["TNEO #14 Mechtitan", "Token Legendary Artifact Creature — Construct"],
    ["TEOC #13 Golem", "Token Enchantment Artifact Creature — Golem"],
    ["TDSK #16 Everywhere", "Token Land"],
    ["TBRO #3 Forest Dryad", "Token Land Creature — Forest Dryad"],
  ];
  for (const [printing, line] of FIXTURES) {
    it(`${printing} prints "${line}"`, () => {
      const parsed = parseTypeLine(line);
      expect(parsed.card_type).toBe("token");
      const subtypes = parseSubtypes(parsed.subtypes_text ?? "");
      expect(
        buildTypeLine({
          supertype: parsed.supertype ?? null,
          cardType: parsed.card_type,
          subtypes,
        }),
      ).toBe(line);
      // …and shows a P/T exactly when the line says Creature: the Copy, a
      // Treasure, a Shard and the token planeswalker show none.
      const creature = /\bCreature\b/.test(line.split("—")[0]);
      expect(showsPowerToughness(parsed.card_type, subtypes, parsed.supertype ?? null)).toBe(creature);
    });
  }
});

describe("displayLine", () => {
  const NBSP = "\u00a0";

  it("joins every inner space run into one no-break space", () => {
    expect(displayLine("Jester's Mask")).toBe(`Jester's${NBSP}Mask`);
    expect(displayLine("Jace,  the\tMind-Sculptor")).toBe(`Jace,${NBSP}the${NBSP}Mind-Sculptor`);
    expect(displayLine(buildTypeLine({ supertype: "Legendary", cardType: "creature", subtypes: ["Human", "Knight"] }))).toBe(
      `Legendary${NBSP}Creature${NBSP}—${NBSP}Human${NBSP}Knight`,
    );
  });

  it("returns a line without inner spaces unchanged", () => {
    for (const text of ["Bogardan", "Instant", "Mind-Sculptor", "", " Lead ", "Trail "]) {
      expect(displayLine(text)).toBe(text);
    }
  });

  it("only rewrites display-font slots", () => {
    expect(slotLine("display", "Art: Nene Thomas")).toBe(`Art:${NBSP}Nene${NBSP}Thomas`);
    expect(slotLine("body", "Art: Nene Thomas")).toBe("Art: Nene Thomas");
    expect(slotLine(undefined, "Art: Nene Thomas")).toBe("Art: Nene Thomas");
  });
});

describe("footerArtistLine — the artist line both renderers print (TODO 4.8.0)", () => {
  it("is \"Art: \" + the credit as typed, \"Art: Unknown\" without one — the literal both renderers held", () => {
    expect(FOOTER_PREFIX).toBe("Art: ");
    expect(footerArtistLine(undefined, "Nene Thomas")).toBe("Art: Nene Thomas");
    expect(footerArtistLine({}, " Nene Thomas ")).toBe("Art:  Nene Thomas ");
    for (const none of [null, undefined, "", "   "]) expect(footerArtistLine({}, none)).toBe("Art: Unknown");
    // Every shipped footer: no prefix of its own — but the 1997 pair's, the
    // prints' "Illus. " (TODO 4.10a), and the 2003 pair's, which prints the
    // bare credit after a brush (TODO 4.10b).
    for (const template of FRAME_TEMPLATE_VALUES) {
      const footer = getFrameProfile(template).footer;
      const illus = template === "retro" || template === "retroland";
      const bare = template === "modern" || template === "modernland";
      expect(footerArtistLine(footer, "Ada"), template).toBe(illus ? "Illus. Ada" : bare ? "Ada" : "Art: Ada");
    }
  });

  it("takes a profile's own prefix (the 1993–2003 prints' \"Illus. \")", () => {
    expect(footerArtistLine({ prefix: "Illus. " }, "Douglas Shuler")).toBe("Illus. Douglas Shuler");
    expect(footerArtistLine({ prefix: "Illus. " }, null)).toBe("Illus. Unknown");
    expect(footerArtistLine({ prefix: "" }, "Douglas Shuler")).toBe("Douglas Shuler");
  });
});
